use crate::{
    activity::log_activity,
    attachments::Kind,
    auth::{ensure_member, AuthUser},
    error::{AppError, AppResult},
    models::VaultEntry,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/homes/{home_id}/vault",
            get(list_entries).post(create_entry),
        )
        .route(
            "/vault/{entry_id}",
            patch(update_entry).delete(delete_entry),
        )
}

const COLS: &str = "id, home_id, category, label, value, is_secret, pinned, created_by, updated_at";
const CATEGORIES: &[&str] = &["utilities", "contacts", "access", "documents", "other"];

#[derive(Deserialize)]
struct CreateEntry {
    category: String,
    label: String,
    value: String,
    #[serde(default)]
    is_secret: bool,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
}

#[derive(Deserialize, Default)]
struct UpdateEntry {
    category: Option<String>,
    label: Option<String>,
    value: Option<String>,
    is_secret: Option<bool>,
    pinned: Option<bool>,
    /// Full replacement of the entry's documents when present.
    attachment_ids: Option<Vec<Uuid>>,
}

fn check_category(c: &str) -> AppResult<()> {
    if CATEGORIES.contains(&c) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!(
            "category must be one of {CATEGORIES:?}"
        )))
    }
}

async fn entry_home(pool: &sqlx::PgPool, uid: Uuid, entry_id: Uuid) -> AppResult<Uuid> {
    let (home_id,): (Uuid,) = sqlx::query_as("select home_id from vault_entries where id = $1")
        .bind(entry_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_member(pool, uid, home_id).await?;
    Ok(home_id)
}

/// Validates and dedupes the ids a client sent, before anything is written.
async fn checked_documents(s: &AppState, home_id: Uuid, ids: &[Uuid]) -> AppResult<Vec<Uuid>> {
    let mut out: Vec<Uuid> = Vec::with_capacity(ids.len());
    for id in ids {
        if out.contains(id) {
            continue;
        }
        crate::attachments::load_for_owner(&s.pool, *id, home_id, Kind::VaultDocument).await?;
        out.push(*id);
    }
    Ok(out)
}

/// Replaces an entry's documents in order inside one transaction; documents dropped from the list are deleted.
async fn set_documents(s: &AppState, entry_id: Uuid, ids: &[Uuid]) -> AppResult<()> {
    let mut tx = s.pool.begin().await?;
    let old: Vec<(Uuid,)> =
        sqlx::query_as("select attachment_id from vault_entry_attachments where entry_id = $1")
            .bind(entry_id)
            .fetch_all(&mut *tx)
            .await?;
    let dropped: Vec<Uuid> = old
        .iter()
        .map(|r| r.0)
        .filter(|id| !ids.contains(id))
        .collect();
    sqlx::query("delete from vault_entry_attachments where entry_id = $1")
        .bind(entry_id)
        .execute(&mut *tx)
        .await?;
    for (i, id) in ids.iter().enumerate() {
        sqlx::query(
            "insert into vault_entry_attachments (entry_id, attachment_id, position) values ($1, $2, $3)",
        )
        .bind(entry_id)
        .bind(id)
        .bind(i as i32)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    crate::routes::attachments::delete_many(s, &dropped).await
}

/// Embeds presigned document URLs in position order; a no-op when storage is off.
async fn decorate(s: &AppState, mut rows: Vec<VaultEntry>) -> AppResult<Vec<VaultEntry>> {
    let entry_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let links: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select entry_id, attachment_id from vault_entry_attachments where entry_id = any($1) order by position",
    )
    .bind(&entry_ids)
    .fetch_all(&s.pool)
    .await?;
    let ids: Vec<Uuid> = links.iter().map(|l| l.1).collect();
    let outs = crate::attachments::outs_for(&s.pool, s.storage.as_deref(), &ids).await?;
    for r in &mut rows {
        r.attachments = links
            .iter()
            .filter(|l| l.0 == r.id)
            .filter_map(|l| outs.get(&l.1).cloned())
            .collect();
    }
    Ok(rows)
}

async fn decorate_one(s: &AppState, row: VaultEntry) -> AppResult<VaultEntry> {
    Ok(decorate(s, vec![row]).await?.remove(0))
}

async fn list_entries(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
) -> AppResult<Json<Vec<VaultEntry>>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let rows: Vec<VaultEntry> = sqlx::query_as(&format!(
        "select {COLS} from vault_entries where home_id = $1 order by pinned desc, category, label"
    ))
    .bind(home_id)
    .fetch_all(&s.pool)
    .await?;
    Ok(Json(decorate(&s, rows).await?))
}

async fn create_entry(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
    Json(b): Json<CreateEntry>,
) -> AppResult<Json<VaultEntry>> {
    ensure_member(&s.pool, uid, home_id).await?;
    check_category(&b.category)?;
    let label = b.label.trim();
    if label.is_empty() || b.value.trim().is_empty() {
        return Err(AppError::BadRequest("label and value required".into()));
    }
    let docs = checked_documents(&s, home_id, &b.attachment_ids).await?;
    let row: VaultEntry = sqlx::query_as(&format!(
        "insert into vault_entries (id, home_id, category, label, value, is_secret, pinned, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning {COLS}"
    ))
    .bind(Uuid::now_v7())
    .bind(home_id)
    .bind(&b.category)
    .bind(label)
    .bind(b.value.trim())
    .bind(b.is_secret)
    .bind(b.pinned)
    .bind(uid)
    .fetch_one(&s.pool)
    .await?;
    set_documents(&s, row.id, &docs).await?;
    let row = decorate_one(&s, row).await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "vault_created".into(),
        payload: serde_json::to_value(&row).unwrap_or_default(),
    });

    log_activity(
        &s,
        home_id,
        uid,
        "created",
        "vault",
        &format!("Created vault entry \"{}\"", row.label),
    )
    .await;

    Ok(Json(row))
}

async fn update_entry(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(entry_id): Path<Uuid>,
    Json(b): Json<UpdateEntry>,
) -> AppResult<Json<VaultEntry>> {
    let home_id = entry_home(&s.pool, uid, entry_id).await?;
    if let Some(c) = &b.category {
        check_category(c)?;
    }
    let docs = match &b.attachment_ids {
        Some(ids) => Some(checked_documents(&s, home_id, ids).await?),
        None => None,
    };
    let row: VaultEntry = sqlx::query_as(&format!(
        "update vault_entries set
            category   = coalesce($2, category),
            label      = coalesce($3, label),
            value      = coalesce($4, value),
            is_secret  = coalesce($5, is_secret),
            pinned     = coalesce($6, pinned),
            updated_at = now()
          where id = $1 returning {COLS}"
    ))
    .bind(entry_id)
    .bind(b.category)
    .bind(b.label.as_deref().map(str::trim))
    .bind(b.value.as_deref().map(str::trim))
    .bind(b.is_secret)
    .bind(b.pinned)
    .fetch_one(&s.pool)
    .await?;
    if let Some(ids) = &docs {
        set_documents(&s, entry_id, ids).await?;
    }
    let row = decorate_one(&s, row).await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "vault_updated".into(),
        payload: serde_json::to_value(&row).unwrap_or_default(),
    });

    log_activity(
        &s,
        home_id,
        uid,
        "updated",
        "vault",
        &format!("Updated vault entry \"{}\"", row.label),
    )
    .await;

    Ok(Json(row))
}

async fn delete_entry(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(entry_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let home_id = entry_home(&s.pool, uid, entry_id).await?;

    let existing: Option<(String,)> =
        sqlx::query_as("select label from vault_entries where id = $1")
            .bind(entry_id)
            .fetch_optional(&s.pool)
            .await?;

    let docs: Vec<(Uuid,)> =
        sqlx::query_as("select attachment_id from vault_entry_attachments where entry_id = $1")
            .bind(entry_id)
            .fetch_all(&s.pool)
            .await?;
    crate::routes::attachments::delete_many(&s, &docs.iter().map(|d| d.0).collect::<Vec<_>>())
        .await?;
    sqlx::query("delete from vault_entries where id = $1")
        .bind(entry_id)
        .execute(&s.pool)
        .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "vault_deleted".into(),
        payload: serde_json::json!({ "id": entry_id }),
    });

    let desc = match existing {
        Some((lbl,)) => format!("Deleted vault entry \"{}\"", lbl),
        None => "Deleted vault entry".to_string(),
    };
    log_activity(&s, home_id, uid, "deleted", "vault", &desc).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}
