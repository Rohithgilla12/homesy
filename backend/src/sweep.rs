use crate::attachments::ATTACHMENT_COLS;
use crate::models::Attachment;
use crate::state::AppState;
use std::time::Duration;

/// Removes uploads that were started but never completed, with their objects (which may not exist).
pub async fn delete_stale_pending(
    state: &AppState,
    older_than: chrono::Duration,
) -> anyhow::Result<usize> {
    let cutoff = chrono::Utc::now() - older_than;
    let rows: Vec<Attachment> = sqlx::query_as(&format!(
        "select {ATTACHMENT_COLS} from attachments where status = 'pending' and created_at < $1"
    ))
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;
    for a in &rows {
        if let Some(storage) = state.storage.as_deref() {
            if let Err(e) = storage
                .delete(&crate::storage::object_key(a.home_id, a.id))
                .await
            {
                tracing::warn!(error = %e, id = %a.id, "sweep: object delete failed");
            }
        }
        sqlx::query("delete from attachments where id = $1")
            .bind(a.id)
            .execute(&state.pool)
            .await?;
    }
    Ok(rows.len())
}

/// Removes `ready` attachments nothing references any more (a receipt uploaded for a sheet that was dismissed,
/// a document dropped during an edit), once they are older than `older_than`.
pub async fn delete_unreferenced_ready(
    state: &AppState,
    older_than: chrono::Duration,
) -> anyhow::Result<usize> {
    let cutoff = chrono::Utc::now() - older_than;
    let rows: Vec<Attachment> = sqlx::query_as(&format!(
        "select {ATTACHMENT_COLS} from attachments a
          where a.status = 'ready' and a.created_at < $1
            and not exists (select 1 from household_bills b where b.receipt_id = a.id)
            and not exists (select 1 from vault_entry_attachments v where v.attachment_id = a.id)
            and not exists (select 1 from users u where u.avatar_id = a.id)
            and not exists (select 1 from homes h where h.cover_id = a.id)"
    ))
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;
    for a in &rows {
        if let Some(storage) = state.storage.as_deref() {
            if let Err(e) = storage
                .delete(&crate::storage::object_key(a.home_id, a.id))
                .await
            {
                tracing::warn!(error = %e, id = %a.id, "sweep: object delete failed");
                continue;
            }
        }
        sqlx::query("delete from attachments where id = $1")
            .bind(a.id)
            .execute(&state.pool)
            .await?;
    }
    Ok(rows.len())
}

/// Runs both sweeps at startup and every 6 hours for the life of the process.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            match delete_stale_pending(&state, chrono::Duration::days(1)).await {
                Ok(n) if n > 0 => tracing::info!(n, "sweep: removed stale pending attachments"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "sweep failed"),
            }
            match delete_unreferenced_ready(&state, chrono::Duration::days(1)).await {
                Ok(n) if n > 0 => tracing::info!(n, "sweep: removed unreferenced attachments"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "sweep failed"),
            }
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
}
