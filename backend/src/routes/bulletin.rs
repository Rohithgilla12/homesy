use crate::{
    activity::log_activity,
    auth::{ensure_member, AuthUser},
    error::{AppError, AppResult},
    models::BulletinNotice,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/homes/{id}/bulletin",
            get(list_notices).post(create_notice),
        )
        .route("/bulletin/{id}", axum::routing::delete(delete_notice))
}

const BULLETIN_COLS: &str = "id, home_id, title, content, priority, created_by, created_at";

#[derive(Deserialize)]
pub struct CreateBulletinNotice {
    pub title: String,
    pub content: String,
    pub priority: Option<String>,
}

async fn notice_home(pool: &sqlx::PgPool, uid: Uuid, notice_id: Uuid) -> AppResult<Uuid> {
    let (home_id,): (Uuid,) = sqlx::query_as("select home_id from bulletin_notices where id = $1")
        .bind(notice_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_member(pool, uid, home_id).await?;
    Ok(home_id)
}

async fn list_notices(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
) -> AppResult<Json<Vec<BulletinNotice>>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let notices: Vec<BulletinNotice> = sqlx::query_as(&format!(
        "select {BULLETIN_COLS} from bulletin_notices where home_id = $1 order by created_at desc"
    ))
    .bind(home_id)
    .fetch_all(&s.pool)
    .await?;
    Ok(Json(notices))
}

async fn create_notice(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
    Json(b): Json<CreateBulletinNotice>,
) -> AppResult<Json<BulletinNotice>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let title = b.title.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("title required".into()));
    }
    let content = b.content.trim();
    if content.is_empty() {
        return Err(AppError::BadRequest("content required".into()));
    }
    let priority = b.priority.as_deref().unwrap_or("normal").to_lowercase();
    if priority != "normal" && priority != "urgent" {
        return Err(AppError::BadRequest(
            "priority must be normal or urgent".into(),
        ));
    }

    let notice: BulletinNotice = sqlx::query_as(&format!(
        "insert into bulletin_notices (id, home_id, title, content, priority, created_by)
         values ($1, $2, $3, $4, $5, $6)
         returning {BULLETIN_COLS}"
    ))
    .bind(Uuid::now_v7())
    .bind(home_id)
    .bind(title)
    .bind(content)
    .bind(&priority)
    .bind(uid)
    .fetch_one(&s.pool)
    .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "bulletin_created".into(),
        payload: serde_json::to_value(&notice).unwrap_or_default(),
    });

    log_activity(
        &s,
        home_id,
        uid,
        "created",
        "notice",
        &format!("Posted notice \"{}\"", notice.title),
    )
    .await;

    Ok(Json(notice))
}

async fn delete_notice(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(notice_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let home_id = notice_home(&s.pool, uid, notice_id).await?;

    let existing: Option<(String,)> =
        sqlx::query_as("select title from bulletin_notices where id = $1")
            .bind(notice_id)
            .fetch_optional(&s.pool)
            .await?;

    sqlx::query("delete from bulletin_notices where id = $1")
        .bind(notice_id)
        .execute(&s.pool)
        .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "bulletin_deleted".into(),
        payload: serde_json::json!({ "id": notice_id }),
    });

    let desc = match existing {
        Some((t,)) => format!("Deleted notice \"{}\"", t),
        None => "Deleted notice".to_string(),
    };
    log_activity(&s, home_id, uid, "deleted", "notice", &desc).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}
