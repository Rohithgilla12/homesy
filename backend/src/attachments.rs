use crate::error::{AppError, AppResult};
use crate::models::{Attachment, AttachmentOut};
use crate::storage::{Storage, GET_TTL};
use chrono::Utc;
use serde::Deserialize;
use std::collections::HashMap;
use uuid::Uuid;

pub const ATTACHMENT_COLS: &str =
    "id, home_id, uploaded_by, kind, content_type, size_bytes, status, created_at";
const MAX_IMAGE: i64 = 10 * 1024 * 1024;
const MAX_PDF: i64 = 20 * 1024 * 1024;
const IMAGE_TYPES: &[&str] = &["image/jpeg", "image/png", "image/webp", "image/heic"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    NotePhoto,
    BillReceipt,
    VaultDocument,
    Avatar,
    HomeCover,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::NotePhoto => "note_photo",
            Kind::BillReceipt => "bill_receipt",
            Kind::VaultDocument => "vault_document",
            Kind::Avatar => "avatar",
            Kind::HomeCover => "home_cover",
        }
    }

    pub fn parse(s: &str) -> Option<Kind> {
        Some(match s {
            "note_photo" => Kind::NotePhoto,
            "bill_receipt" => Kind::BillReceipt,
            "vault_document" => Kind::VaultDocument,
            "avatar" => Kind::Avatar,
            "home_cover" => Kind::HomeCover,
            _ => return None,
        })
    }

    fn allows_pdf(self) -> bool {
        matches!(self, Kind::BillReceipt | Kind::VaultDocument)
    }
}

pub fn validate_upload(kind: Kind, content_type: &str, size_bytes: i64) -> AppResult<()> {
    if size_bytes <= 0 {
        return Err(AppError::BadRequest("size_bytes must be positive".into()));
    }
    if IMAGE_TYPES.contains(&content_type) {
        if size_bytes > MAX_IMAGE {
            return Err(AppError::BadRequest(
                "images must be 10 MiB or smaller".into(),
            ));
        }
        return Ok(());
    }
    if content_type == "application/pdf" {
        if !kind.allows_pdf() {
            return Err(AppError::BadRequest(format!(
                "{} must be an image",
                kind.as_str()
            )));
        }
        if size_bytes > MAX_PDF {
            return Err(AppError::BadRequest(
                "PDFs must be 20 MiB or smaller".into(),
            ));
        }
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "unsupported content type {content_type}"
    )))
}

/// Serde helper so a PATCH can distinguish "absent" (keep) from `null` (clear).
pub fn double_option<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<Uuid>>, D::Error> {
    Option::<Uuid>::deserialize(d).map(Some)
}

pub async fn to_out(storage: &Storage, a: &Attachment) -> anyhow::Result<AttachmentOut> {
    let url = storage
        .presign_get(&crate::storage::object_key(a.home_id, a.id))
        .await?;
    Ok(AttachmentOut {
        id: a.id,
        kind: a.kind.clone(),
        content_type: a.content_type.clone(),
        size_bytes: a.size_bytes,
        url,
        url_expires_at: Utc::now() + chrono::Duration::from_std(GET_TTL)?,
    })
}

/// A `ready` attachment by id: 404 when unknown, 409 while the upload has not completed.
pub async fn load_ready(pool: &sqlx::PgPool, id: Uuid) -> AppResult<Attachment> {
    let a: Attachment = sqlx::query_as(&format!(
        "select {ATTACHMENT_COLS} from attachments where id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if a.status != "ready" {
        return Err(AppError::Conflict("attachment upload not completed".into()));
    }
    Ok(a)
}

/// Checks a `ready` attachment may be attached to an owner in `home_id` with the given kind.
pub async fn load_for_owner(
    pool: &sqlx::PgPool,
    id: Uuid,
    home_id: Uuid,
    kind: Kind,
) -> AppResult<Attachment> {
    let a = load_ready(pool, id).await?;
    if a.home_id != home_id {
        return Err(AppError::BadRequest(
            "attachment belongs to another home".into(),
        ));
    }
    if a.kind != kind.as_str() {
        return Err(AppError::BadRequest(format!(
            "attachment is not a {}",
            kind.as_str()
        )));
    }
    Ok(a)
}

/// Presigns in bulk for list responses; disabled storage or no ids yield an empty map.
pub async fn outs_for(
    pool: &sqlx::PgPool,
    storage: Option<&Storage>,
    ids: &[Uuid],
) -> AppResult<HashMap<Uuid, AttachmentOut>> {
    let mut map = HashMap::new();
    let Some(storage) = storage else {
        return Ok(map);
    };
    if ids.is_empty() {
        return Ok(map);
    }
    let rows: Vec<Attachment> = sqlx::query_as(&format!(
        "select {ATTACHMENT_COLS} from attachments where id = any($1) and status = 'ready'"
    ))
    .bind(ids)
    .fetch_all(pool)
    .await?;
    for a in &rows {
        map.insert(a.id, to_out(storage, a).await?);
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_up_to_10_mib_are_fine_for_every_kind() {
        for k in [
            Kind::NotePhoto,
            Kind::BillReceipt,
            Kind::VaultDocument,
            Kind::Avatar,
            Kind::HomeCover,
        ] {
            assert!(validate_upload(k, "image/jpeg", 10 * 1024 * 1024).is_ok());
        }
    }

    #[test]
    fn pdfs_only_for_receipts_and_documents_up_to_20_mib() {
        assert!(validate_upload(Kind::BillReceipt, "application/pdf", 20 * 1024 * 1024).is_ok());
        assert!(validate_upload(Kind::VaultDocument, "application/pdf", 1).is_ok());
        assert!(validate_upload(Kind::Avatar, "application/pdf", 1).is_err());
        assert!(
            validate_upload(Kind::BillReceipt, "application/pdf", 20 * 1024 * 1024 + 1).is_err()
        );
    }

    #[test]
    fn unknown_types_and_oversize_images_are_rejected() {
        assert!(validate_upload(Kind::NotePhoto, "image/gif", 10).is_err());
        assert!(validate_upload(Kind::NotePhoto, "image/png", 10 * 1024 * 1024 + 1).is_err());
        assert!(validate_upload(Kind::NotePhoto, "image/png", 0).is_err());
    }

    #[test]
    fn kind_round_trips() {
        assert_eq!(Kind::parse("bill_receipt"), Some(Kind::BillReceipt));
        assert_eq!(Kind::BillReceipt.as_str(), "bill_receipt");
        assert_eq!(Kind::parse("selfie"), None);
    }
}
