use crate::attachments::{validate_upload, Kind, ATTACHMENT_COLS};
use crate::auth::{ensure_member, AuthUser};
use crate::error::{AppError, AppResult};
use crate::models::{Attachment, AttachmentOut};
use crate::state::AppState;
use crate::storage::{object_key, PUT_TTL};
use axum::{
    extract::{Path, State},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/config", get(config))
        .route("/homes/{home_id}/attachments", post(create))
        .route("/attachments/{id}/complete", post(complete))
        .route("/attachments/{id}", delete(remove))
}

/// Capabilities the app reads once per session, so it can hide upload affordances when storage is off.
async fn config(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "attachments": s.storage.is_some() }))
}

fn storage(s: &AppState) -> AppResult<&crate::storage::Storage> {
    s.storage
        .as_deref()
        .ok_or_else(|| AppError::Disabled("attachments disabled".into()))
}

#[derive(Deserialize)]
struct CreateAttachment {
    kind: String,
    content_type: String,
    size_bytes: i64,
}

async fn create(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
    Json(b): Json<CreateAttachment>,
) -> AppResult<Json<serde_json::Value>> {
    let storage = storage(&s)?;
    ensure_member(&s.pool, uid, home_id).await?;
    let kind = Kind::parse(&b.kind).ok_or_else(|| AppError::BadRequest("unknown kind".into()))?;
    validate_upload(kind, &b.content_type, b.size_bytes)?;
    let id = Uuid::now_v7();
    sqlx::query(
        "insert into attachments (id, home_id, uploaded_by, kind, content_type, size_bytes, status)
         values ($1, $2, $3, $4, $5, $6, 'pending')",
    )
    .bind(id)
    .bind(home_id)
    .bind(uid)
    .bind(kind.as_str())
    .bind(&b.content_type)
    .bind(b.size_bytes)
    .execute(&s.pool)
    .await?;
    let upload_url = storage
        .presign_put(&object_key(home_id, id), &b.content_type, b.size_bytes)
        .await?;
    Ok(Json(serde_json::json!({
        "id": id,
        "upload_url": upload_url,
        "expires_at": Utc::now() + chrono::Duration::from_std(PUT_TTL).unwrap_or_default(),
    })))
}

async fn load_own(pool: &sqlx::PgPool, uid: Uuid, id: Uuid) -> AppResult<Attachment> {
    let a: Attachment = sqlx::query_as(&format!(
        "select {ATTACHMENT_COLS} from attachments where id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    ensure_member(pool, uid, a.home_id).await?;
    Ok(a)
}

async fn complete(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<AttachmentOut>> {
    let storage = storage(&s)?;
    let a = load_own(&s.pool, uid, id).await?;
    if a.uploaded_by != uid {
        return Err(AppError::Forbidden);
    }
    let key = object_key(a.home_id, a.id);
    let Some(size) = storage.head_size(&key).await? else {
        return Err(AppError::Conflict("object not uploaded yet".into()));
    };
    if size != a.size_bytes {
        storage.delete(&key).await?;
        sqlx::query("delete from attachments where id = $1")
            .bind(id)
            .execute(&s.pool)
            .await?;
        return Err(AppError::BadRequest("uploaded size does not match".into()));
    }
    let a: Attachment = sqlx::query_as(&format!(
        "update attachments set status = 'ready' where id = $1 returning {ATTACHMENT_COLS}"
    ))
    .bind(id)
    .fetch_one(&s.pool)
    .await?;
    Ok(Json(crate::attachments::to_out(storage, &a).await?))
}

async fn remove(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    storage(&s)?;
    let a = load_own(&s.pool, uid, id).await?;
    if a.uploaded_by != uid {
        let (role,): (String,) =
            sqlx::query_as("select role from home_members where home_id = $1 and user_id = $2")
                .bind(a.home_id)
                .bind(uid)
                .fetch_one(&s.pool)
                .await?;
        if role != "owner" {
            return Err(AppError::Forbidden);
        }
    }
    delete_object_and_row(&s, &a).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Shared by owners' delete paths (bills, vault entries, notes): object first, then the row.
pub async fn delete_object_and_row(s: &AppState, a: &Attachment) -> AppResult<()> {
    if let Some(storage) = s.storage.as_deref() {
        storage.delete(&object_key(a.home_id, a.id)).await?;
    }
    sqlx::query("delete from attachments where id = $1")
        .bind(a.id)
        .execute(&s.pool)
        .await?;
    Ok(())
}

/// Deletes every attachment in `ids` that still exists; used by owner deletes.
pub async fn delete_many(s: &AppState, ids: &[Uuid]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let rows: Vec<Attachment> = sqlx::query_as(&format!(
        "select {ATTACHMENT_COLS} from attachments where id = any($1)"
    ))
    .bind(ids)
    .fetch_all(&s.pool)
    .await?;
    for a in &rows {
        delete_object_and_row(s, a).await?;
    }
    Ok(())
}
