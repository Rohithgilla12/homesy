use crate::{
    activity::log_activity,
    auth::{ensure_member, AuthUser},
    error::{AppError, AppResult},
    models::{List, ListItem},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/homes/{home_id}/lists", get(list_lists).post(create_list))
        .route("/lists/{list_id}/items", get(list_items).post(create_item))
        .route("/lists/{id}/clear-completed", post(clear_completed))
        .route("/items/{item_id}", patch(update_item).delete(delete_item))
}

const LIST_KINDS: &[&str] = &["grocery", "laundry", "todo", "custom"];

const ITEM_COLS: &str = "id, list_id, title, qty, note, done, done_by, done_at, created_by, created_at";

#[derive(Deserialize)]
struct CreateList {
    kind: String,
    name: String,
}

#[derive(Deserialize)]
struct CreateItem {
    title: String,
    qty: Option<String>,
    note: Option<String>,
}

#[derive(Deserialize, Default)]
struct UpdateItem {
    title: Option<String>,
    qty: Option<String>,
    note: Option<String>,
    done: Option<bool>,
}

/// Resolves the home a list belongs to and asserts membership in one go.
async fn list_home(pool: &sqlx::PgPool, uid: Uuid, list_id: Uuid) -> AppResult<Uuid> {
    let (home_id,): (Uuid,) = sqlx::query_as("select home_id from lists where id = $1")
        .bind(list_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_member(pool, uid, home_id).await?;
    Ok(home_id)
}

async fn item_home(pool: &sqlx::PgPool, uid: Uuid, item_id: Uuid) -> AppResult<Uuid> {
    let (home_id,): (Uuid,) = sqlx::query_as(
        "select l.home_id from list_items i join lists l on l.id = i.list_id where i.id = $1",
    )
    .bind(item_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    ensure_member(pool, uid, home_id).await?;
    Ok(home_id)
}

async fn list_lists(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
) -> AppResult<Json<Vec<List>>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let lists: Vec<List> = sqlx::query_as(
        "select l.id, l.home_id, l.kind, l.name, l.created_at,
                (select count(*) from list_items i where i.list_id = l.id and not i.done) as open_count
           from lists l
          where l.home_id = $1
          order by l.created_at",
    )
    .bind(home_id)
    .fetch_all(&s.pool)
    .await?;
    Ok(Json(lists))
}

async fn create_list(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
    Json(b): Json<CreateList>,
) -> AppResult<Json<List>> {
    ensure_member(&s.pool, uid, home_id).await?;
    if !LIST_KINDS.contains(&b.kind.as_str()) {
        return Err(AppError::BadRequest(format!("kind must be one of {LIST_KINDS:?}")));
    }
    let name = b.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }
    let list: List = sqlx::query_as(
        "insert into lists (id, home_id, kind, name) values ($1, $2, $3, $4)
         returning id, home_id, kind, name, created_at, 0::bigint as open_count",
    )
    .bind(Uuid::now_v7())
    .bind(home_id)
    .bind(&b.kind)
    .bind(name)
    .fetch_one(&s.pool)
    .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "list_created".into(),
        payload: serde_json::to_value(&list).unwrap_or_default(),
    });

    log_activity(
        &s,
        home_id,
        uid,
        "created",
        "list",
        &format!("Created list \"{}\"", list.name),
    ).await;

    Ok(Json(list))
}

async fn list_items(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(list_id): Path<Uuid>,
) -> AppResult<Json<Vec<ListItem>>> {
    list_home(&s.pool, uid, list_id).await?;
    let items: Vec<ListItem> = sqlx::query_as(&format!(
        "select {ITEM_COLS} from list_items where list_id = $1 order by done, created_at desc"
    ))
    .bind(list_id)
    .fetch_all(&s.pool)
    .await?;
    Ok(Json(items))
}

async fn create_item(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(list_id): Path<Uuid>,
    Json(b): Json<CreateItem>,
) -> AppResult<Json<ListItem>> {
    let home_id = list_home(&s.pool, uid, list_id).await?;
    let title = b.title.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("title required".into()));
    }
    let item: ListItem = sqlx::query_as(&format!(
        "insert into list_items (id, list_id, title, qty, note, created_by)
         values ($1, $2, $3, $4, $5, $6) returning {ITEM_COLS}"
    ))
    .bind(Uuid::now_v7())
    .bind(list_id)
    .bind(title)
    .bind(b.qty.as_deref().map(str::trim).filter(|q| !q.is_empty()))
    .bind(b.note.as_deref().map(str::trim).filter(|n| !n.is_empty()))
    .bind(uid)
    .fetch_one(&s.pool)
    .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "item_created".into(),
        payload: serde_json::to_value(&item).unwrap_or_default(),
    });

    log_activity(
        &s,
        home_id,
        uid,
        "created",
        "item",
        &format!("Added item \"{}\"", item.title),
    ).await;

    Ok(Json(item))
}

async fn update_item(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(item_id): Path<Uuid>,
    Json(b): Json<UpdateItem>,
) -> AppResult<Json<ListItem>> {
    let home_id = item_home(&s.pool, uid, item_id).await?;

    // Check old status if done is being toggled
    let old_done: Option<(bool,)> = if b.done.is_some() {
        sqlx::query_as("select done from list_items where id = $1")
            .bind(item_id)
            .fetch_optional(&s.pool)
            .await?
    } else {
        None
    };

    // done/done_by/done_at move together.
    let (done_by, done_at) = match b.done {
        Some(true) => (Some(uid), Some(Utc::now())),
        _ => (None, None),
    };

    let item: ListItem = sqlx::query_as(&format!(
        "update list_items set
            title   = coalesce($2, title),
            qty     = case when $3::text is null then qty  else nullif($3, '') end,
            note    = case when $4::text is null then note else nullif($4, '') end,
            done    = coalesce($5, done),
            done_by = case when $5 is null then done_by else $6 end,
            done_at = case when $5 is null then done_at else $7 end
        where id = $1 returning {ITEM_COLS}"
    ))
    .bind(item_id)
    .bind(b.title.as_deref().map(str::trim))
    .bind(b.qty)
    .bind(b.note)
    .bind(b.done)
    .bind(done_by)
    .bind(done_at)
    .fetch_one(&s.pool)
    .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "item_updated".into(),
        payload: serde_json::to_value(&item).unwrap_or_default(),
    });

    if let Some(was_done) = old_done {
        if !was_done.0 && item.done {
            log_activity(
                &s,
                home_id,
                uid,
                "completed",
                "item",
                &format!("Completed item \"{}\"", item.title),
            ).await;
        }
    }

    Ok(Json(item))
}

async fn delete_item(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(item_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let home_id = item_home(&s.pool, uid, item_id).await?;

    let existing_title: Option<(String,)> = sqlx::query_as("select title from list_items where id = $1")
        .bind(item_id)
        .fetch_optional(&s.pool)
        .await?;

    sqlx::query("delete from list_items where id = $1").bind(item_id).execute(&s.pool).await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "item_deleted".into(),
        payload: serde_json::json!({ "id": item_id }),
    });

    let desc = match existing_title {
        Some((title,)) => format!("Deleted item \"{}\"", title),
        None => "Deleted item".to_string(),
    };
    log_activity(
        &s,
        home_id,
        uid,
        "deleted",
        "item",
        &desc,
    ).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn clear_completed(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(list_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let home_id = list_home(&s.pool, uid, list_id).await?;

    let res = sqlx::query("delete from list_items where list_id = $1 and done = true")
        .bind(list_id)
        .execute(&s.pool)
        .await?;

    let count = res.rows_affected();

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "items_cleared".into(),
        payload: serde_json::json!({ "list_id": list_id, "count": count }),
    });

    log_activity(
        &s,
        home_id,
        uid,
        "cleared_completed",
        "list",
        &format!("Cleared {} completed item(s)", count),
    ).await;

    Ok(Json(serde_json::json!({ "deleted": count })))
}

