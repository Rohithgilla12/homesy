use crate::{
    activity::log_activity,
    attachments::Kind,
    auth::{ensure_member, AuthUser},
    error::{AppError, AppResult},
    models::{Activity, Home, Member},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/homes", get(list_homes).post(create_home))
        .route("/homes/join", post(join_home))
        .route("/homes/{id}", get(get_home).patch(update_home))
        .route("/homes/{id}/leave", post(leave_home))
        .route("/homes/{id}/activity", get(get_home_activity))
        .route("/homes/{id}/events", get(home_events))
}

#[derive(Deserialize)]
struct CreateHome {
    name: String,
    emoji: Option<String>,
}

#[derive(Deserialize)]
struct JoinHome {
    code: String,
}

#[derive(Serialize)]
struct HomeDetail {
    #[serde(flatten)]
    home: Home,
    members: Vec<Member>,
}

const HOME_COLS: &str = "id, name, emoji, invite_code, created_by, created_at, cover_id";

/// Ambiguity-free, shouting-friendly code: no 0/O/1/I.
pub(crate) fn gen_invite_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

async fn list_homes(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
) -> AppResult<Json<Vec<Home>>> {
    let homes: Vec<Home> = sqlx::query_as(
        "select h.id, h.name, h.emoji, h.invite_code, h.created_by, h.created_at, h.cover_id
           from homes h
           join home_members m on m.home_id = h.id
          where m.user_id = $1
          order by m.joined_at",
    )
    .bind(uid)
    .fetch_all(&s.pool)
    .await?;
    Ok(Json(decorate_homes(&s, homes).await?))
}

async fn create_home(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(b): Json<CreateHome>,
) -> AppResult<Json<Home>> {
    let name = b.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }
    let emoji = b.emoji.unwrap_or_else(|| "🏠".to_string());

    let mut tx = s.pool.begin().await?;
    let home_id = Uuid::now_v7();

    // Retry on the (astronomically unlikely) invite-code collision.
    let home: Home = loop {
        let code = gen_invite_code();
        let res: Result<Home, sqlx::Error> = sqlx::query_as(&format!(
            "insert into homes (id, name, emoji, invite_code, created_by)
             values ($1, $2, $3, $4, $5) returning {HOME_COLS}"
        ))
        .bind(home_id)
        .bind(name)
        .bind(&emoji)
        .bind(&code)
        .bind(uid)
        .fetch_one(&mut *tx)
        .await;
        match res {
            Ok(h) => break h,
            Err(sqlx::Error::Database(d)) if d.is_unique_violation() => continue,
            Err(e) => return Err(e.into()),
        }
    };

    sqlx::query("insert into home_members (home_id, user_id, role) values ($1, $2, 'owner')")
        .bind(home_id)
        .bind(uid)
        .execute(&mut *tx)
        .await?;

    // Every home starts with the three canonical lists.
    for (kind, name) in [
        ("grocery", "Groceries"),
        ("laundry", "Laundry"),
        ("todo", "To-do"),
    ] {
        sqlx::query("insert into lists (id, home_id, kind, name) values ($1, $2, $3, $4)")
            .bind(Uuid::now_v7())
            .bind(home_id)
            .bind(kind)
            .bind(name)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(Json(decorate_home(&s, home).await?))
}

async fn join_home(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(b): Json<JoinHome>,
) -> AppResult<Json<Home>> {
    let code = b.code.trim().to_uppercase();
    let home: Home = sqlx::query_as(&format!(
        "select {HOME_COLS} from homes where invite_code = $1"
    ))
    .bind(&code)
    .fetch_optional(&s.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let home_id = home.id;
    sqlx::query(
        "insert into home_members (home_id, user_id, role) values ($1, $2, 'member')
         on conflict do nothing",
    )
    .bind(home_id)
    .bind(uid)
    .execute(&s.pool)
    .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "member_joined".into(),
        payload: serde_json::json!({ "user_id": uid }),
    });

    log_activity(&s, home_id, uid, "joined", "member", "Joined the home").await;

    Ok(Json(decorate_home(&s, home).await?))
}

async fn get_home(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
) -> AppResult<Json<HomeDetail>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let home: Home = sqlx::query_as(&format!("select {HOME_COLS} from homes where id = $1"))
        .bind(home_id)
        .fetch_one(&s.pool)
        .await?;
    let members: Vec<Member> = sqlx::query_as(
        "select m.user_id, u.display_name, u.email, m.role, m.joined_at, u.avatar_id
           from home_members m join users u on u.id = m.user_id
          where m.home_id = $1 order by m.joined_at",
    )
    .bind(home_id)
    .fetch_all(&s.pool)
    .await?;
    let home = decorate_home(&s, home).await?;
    let members = decorate_members(&s, members).await?;
    Ok(Json(HomeDetail { home, members }))
}

/// Embeds presigned cover URLs; a no-op when storage is off.
async fn decorate_homes(s: &AppState, mut homes: Vec<Home>) -> AppResult<Vec<Home>> {
    let ids: Vec<Uuid> = homes.iter().filter_map(|h| h.cover_id).collect();
    let outs = crate::attachments::outs_for(&s.pool, s.storage.as_deref(), &ids).await?;
    for h in &mut homes {
        h.cover = h.cover_id.and_then(|id| outs.get(&id).cloned());
    }
    Ok(homes)
}

async fn decorate_home(s: &AppState, home: Home) -> AppResult<Home> {
    Ok(decorate_homes(s, vec![home]).await?.remove(0))
}

async fn decorate_members(s: &AppState, mut members: Vec<Member>) -> AppResult<Vec<Member>> {
    let ids: Vec<Uuid> = members.iter().filter_map(|m| m.avatar_id).collect();
    let outs = crate::attachments::outs_for(&s.pool, s.storage.as_deref(), &ids).await?;
    for m in &mut members {
        m.avatar = m.avatar_id.and_then(|id| outs.get(&id).cloned());
    }
    Ok(members)
}

#[derive(Deserialize)]
struct UpdateHome {
    name: Option<String>,
    emoji: Option<String>,
    /// Absent keeps the cover, `null` clears it, an id replaces it.
    #[serde(default, deserialize_with = "crate::attachments::double_option")]
    cover_id: Option<Option<Uuid>>,
}

/// Owners only: rename, re-emoji or change the cover photo.
async fn update_home(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
    Json(b): Json<UpdateHome>,
) -> AppResult<Json<Home>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let (role,): (String,) =
        sqlx::query_as("select role from home_members where home_id = $1 and user_id = $2")
            .bind(home_id)
            .bind(uid)
            .fetch_one(&s.pool)
            .await?;
    if role != "owner" {
        return Err(AppError::Forbidden);
    }
    let current: Home = sqlx::query_as(&format!("select {HOME_COLS} from homes where id = $1"))
        .bind(home_id)
        .fetch_one(&s.pool)
        .await?;
    let name = match b.name {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => current.name.clone(),
    };
    let emoji = b
        .emoji
        .filter(|e| !e.trim().is_empty())
        .unwrap_or(current.emoji.clone());
    let cover_id = match b.cover_id {
        Some(Some(id)) => {
            crate::attachments::load_for_owner(&s.pool, id, home_id, Kind::HomeCover).await?;
            Some(id)
        }
        Some(None) => None,
        None => current.cover_id,
    };
    let home: Home = sqlx::query_as(&format!(
        "update homes set name = $1, emoji = $2, cover_id = $3 where id = $4 returning {HOME_COLS}"
    ))
    .bind(&name)
    .bind(&emoji)
    .bind(cover_id)
    .bind(home_id)
    .fetch_one(&s.pool)
    .await?;
    if let Some(old) = current.cover_id.filter(|old| Some(*old) != cover_id) {
        crate::routes::attachments::delete_many(&s, &[old]).await?;
    }
    let home = decorate_home(&s, home).await?;
    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "home_updated".into(),
        payload: serde_json::to_value(&home).unwrap_or_default(),
    });
    Ok(Json(home))
}

async fn leave_home(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let owners: (i64,) =
        sqlx::query_as("select count(*) from home_members where home_id = $1 and role = 'owner'")
            .bind(home_id)
            .fetch_one(&s.pool)
            .await?;
    let me_owner: Option<(i32,)> = sqlx::query_as(
        "select 1 from home_members where home_id = $1 and user_id = $2 and role = 'owner'",
    )
    .bind(home_id)
    .bind(uid)
    .fetch_optional(&s.pool)
    .await?;
    if me_owner.is_some() && owners.0 <= 1 {
        return Err(AppError::BadRequest(
            "transfer ownership before leaving".into(),
        ));
    }
    sqlx::query("delete from home_members where home_id = $1 and user_id = $2")
        .bind(home_id)
        .bind(uid)
        .execute(&s.pool)
        .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "member_left".into(),
        payload: serde_json::json!({ "user_id": uid }),
    });

    log_activity(&s, home_id, uid, "left", "member", "Left the home").await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ActivityQuery {
    limit: Option<i64>,
}

async fn get_home_activity(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
    Query(q): Query<ActivityQuery>,
) -> AppResult<Json<Vec<Activity>>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let activities: Vec<Activity> = sqlx::query_as(
        "select id, home_id, actor_id, action, resource_type, description, created_at
           from activities
          where home_id = $1
          order by created_at desc
          limit $2",
    )
    .bind(home_id)
    .bind(limit)
    .fetch_all(&s.pool)
    .await?;

    Ok(Json(activities))
}

async fn home_events(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
) -> AppResult<
    axum::response::Sse<
        impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>,
    >,
> {
    ensure_member(&s.pool, uid, home_id).await?;

    let rx = s.events_tx.subscribe();
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx);

    use futures::StreamExt;
    let filtered_stream = stream.filter_map(move |res| {
        let event = match res {
            Ok(evt) if evt.home_id == home_id => Some(evt),
            _ => None,
        };
        async move {
            event.and_then(|e| {
                let mut data_obj = match e.payload {
                    serde_json::Value::Object(map) => map,
                    other => {
                        let mut m = serde_json::Map::new();
                        m.insert("data".to_string(), other);
                        m
                    }
                };
                data_obj.insert(
                    "resource".to_string(),
                    serde_json::Value::String(e.event_type.clone()),
                );
                data_obj.insert(
                    "type".to_string(),
                    serde_json::Value::String(e.event_type.clone()),
                );
                let data = serde_json::to_string(&data_obj).ok()?;
                Some(Ok(axum::response::sse::Event::default()
                    .event(e.event_type)
                    .data(data)))
            })
        }
    });

    Ok(axum::response::Sse::new(filtered_stream).keep_alive(
        axum::response::sse::KeepAlive::new().interval(std::time::Duration::from_secs(15)),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gen_invite_code_format() {
        const VALID_CHARS: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        for _ in 0..100 {
            let code = gen_invite_code();
            assert_eq!(code.len(), 6, "invite code must be 6 characters long");
            for ch in code.chars() {
                assert!(
                    VALID_CHARS.contains(ch),
                    "code contains invalid char '{ch}', must exclude 0/O/1/I"
                );
            }
            assert!(!code.contains('0'));
            assert!(!code.contains('O'));
            assert!(!code.contains('1'));
            assert!(!code.contains('I'));
        }
    }
}
