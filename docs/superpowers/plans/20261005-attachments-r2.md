# Attachments on R2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic attachments layer: photos and PDFs stored in a private Cloudflare R2 bucket via presigned URLs, attachable to bills (receipt), vault entries (documents), users (avatar) and homes (cover photo), with upload and viewing primitives in the app.

**Architecture:** The Rust API owns an `attachments` table and an S3 client (aws-sdk-s3 pointed at R2). Creating an attachment returns a presigned PUT URL; the phone uploads straight to R2 and calls `complete`, which verifies the object with `HEAD`. Every response that carries an attachment embeds a presigned GET URL (10 min). When no R2 credentials are configured the endpoints answer 503 and `GET /config` reports `attachments: false`, so dev and CI need no bucket except the integration tests, which run against MinIO.

**Tech Stack:** Axum 0.8, SQLx 0.8, aws-sdk-s3 1.x (presigning), MinIO in CI; Expo SDK 57 with expo-image-picker, expo-document-picker, expo-image-manipulator, expo-file-system (legacy upload API), TanStack Query 5.

**Spec:** `docs/superpowers/specs/20261005-attachments-r2-design.md`

## Global Constraints

- Migrations are expand-only; new file `backend/migrations/0004_attachments.sql`; never edit an applied migration.
- Every attachment handler resolves the owning home and calls `ensure_member`; avatars check `uploaded_by == caller`.
- Allowed content types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`; PDFs only for `bill_receipt` and `vault_document`; 10 MiB images, 20 MiB PDFs.
- Presigned PUT expires in 15 minutes, presigned GET in 10 minutes. Bucket is private; object key is `{home_id}/{attachment_id}`.
- Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; optional `S3_ENDPOINT` overrides the R2 endpoint (MinIO in tests). All unset → storage disabled, 503 `{"error":"attachments disabled"}`.
- Mobile: screens import only from `@/ui`; no hex literals or `fontFamily`; every icon-only control has a `label`; Reduce Motion → fade or snap. No `// ====` banner comments anywhere.
- Public repo: no credentials in code, tests or docs; `.env` values only in `~/homesy/.env` on the box and GitHub secrets.
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Vb9MJzUL62sFv1rtdQE5Ym`.
- Backend gates per task: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`. Mobile gates: `npm test -- --ci`, `npx tsc --noEmit`, `npx expo export --platform ios --output-dir dist/ios`.

## Review Focus

1. **A member of home A attaches a `ready` attachment that belongs to home B** (ids are guessable only by the uploader, but the API must still refuse). Expected: 400 `attachment belongs to another home`. Pinned in Task 4 (`test_bill_receipt_rejects_foreign_attachment`).
2. **`complete` called before the bytes are uploaded.** Expected: 409 and the row stays `pending`; a later `complete` after the upload succeeds. Pinned in Task 3.
3. **A presigned GET expires while the bill list is on screen.** Expected: the thumbnail reloads after one failed image load by refetching the owning query, with no error toast. Pinned in Task 9's `AttachmentThumb` test (`onError` triggers `refresh` once).
4. **HEIC photo from an iPhone.** Expected: converted to JPEG at 2048 px before upload; the declared `content_type` is `image/jpeg` and the PUT signature matches. Pinned in Task 8's `prepareImage` test.
5. **Storage not configured.** Expected: upload buttons hidden, nothing calls the attachment endpoints, existing screens unchanged. Pinned in Task 8 (`useFeatures` test) and Task 3 (503 test).

---

### Task 1: Storage client and configuration

**Files:**
- Create: `backend/src/storage.rs`
- Modify: `backend/Cargo.toml`, `backend/src/lib.rs`, `backend/src/config.rs`, `backend/src/state.rs`, `backend/.env.example`

**Interfaces:**
- Produces: `storage::Storage` with `pub fn from_env() -> Option<Storage>`, `pub fn object_key(home_id: Uuid, attachment_id: Uuid) -> String`, `pub async fn presign_put(&self, key: &str, content_type: &str, size: i64) -> anyhow::Result<String>`, `pub async fn presign_get(&self, key: &str) -> anyhow::Result<String>`, `pub async fn head_size(&self, key: &str) -> anyhow::Result<Option<i64>>`, `pub async fn delete(&self, key: &str) -> anyhow::Result<()>`; `AppState.storage: Option<Arc<Storage>>` and `AppState::with_storage(self, Option<Storage>) -> Self`.

- [ ] **Step 1: Add dependencies**

In `backend/Cargo.toml` under `[dependencies]` add:

```toml
aws-config = { version = "1", features = ["behavior-version-latest"] }
aws-sdk-s3 = "1"
aws-credential-types = "1"
```

Run: `cd backend && cargo fetch`
Expected: resolves without error.

- [ ] **Step 2: Write the failing unit tests**

Create `backend/src/storage.rs` with only the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_storage() -> Storage {
        Storage::new(
            "http://localhost:9000".into(),
            "test".into(),
            "testsecret".into(),
            "homesy-test".into(),
        )
    }

    #[test]
    fn object_key_is_home_then_attachment() {
        let h = Uuid::now_v7();
        let a = Uuid::now_v7();
        assert_eq!(object_key(h, a), format!("{h}/{a}"));
    }

    #[tokio::test]
    async fn presigned_put_targets_the_bucket_and_key_and_expires_in_15_minutes() {
        let url = test_storage().presign_put("h/a", "image/jpeg", 123).await.unwrap();
        assert!(url.starts_with("http://localhost:9000/homesy-test/h/a?"), "{url}");
        assert!(url.contains("X-Amz-Expires=900"), "{url}");
    }

    #[tokio::test]
    async fn presigned_get_expires_in_10_minutes() {
        let url = test_storage().presign_get("h/a").await.unwrap();
        assert!(url.starts_with("http://localhost:9000/homesy-test/h/a?"), "{url}");
        assert!(url.contains("X-Amz-Expires=600"), "{url}");
    }

    #[test]
    fn from_env_is_none_when_unset() {
        for k in ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "S3_ENDPOINT"] {
            std::env::remove_var(k);
        }
        assert!(Storage::from_env().is_none());
    }
}
```

Add `pub mod storage;` to `backend/src/lib.rs`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd backend && cargo test --lib storage`
Expected: compile error, `Storage` and `object_key` not found.

- [ ] **Step 4: Implement the storage client**

Above the test module in `backend/src/storage.rs`:

```rust
use aws_credential_types::Credentials;
use aws_sdk_s3::{config::Region, presigning::PresigningConfig, Client, Config};
use std::time::Duration;
use uuid::Uuid;

pub const PUT_TTL: Duration = Duration::from_secs(15 * 60);
pub const GET_TTL: Duration = Duration::from_secs(10 * 60);

/// S3 client for the private attachments bucket. R2 speaks S3 with path-style addressing and region `auto`.
#[derive(Clone)]
pub struct Storage {
    client: Client,
    bucket: String,
}

pub fn object_key(home_id: Uuid, attachment_id: Uuid) -> String {
    format!("{home_id}/{attachment_id}")
}

impl Storage {
    pub fn new(endpoint: String, access_key: String, secret_key: String, bucket: String) -> Self {
        let creds = Credentials::new(access_key, secret_key, None, None, "env");
        let config = Config::builder()
            .behavior_version_latest()
            .region(Region::new("auto"))
            .endpoint_url(endpoint)
            .credentials_provider(creds)
            .force_path_style(true)
            .build();
        Self { client: Client::from_conf(config), bucket }
    }

    /// `None` when any R2 variable is missing, which disables attachments without failing startup.
    pub fn from_env() -> Option<Self> {
        let account = std::env::var("R2_ACCOUNT_ID").ok();
        let endpoint = std::env::var("S3_ENDPOINT")
            .ok()
            .or_else(|| account.as_ref().map(|a| format!("https://{a}.r2.cloudflarestorage.com")))?;
        let access_key = std::env::var("R2_ACCESS_KEY_ID").ok()?;
        let secret_key = std::env::var("R2_SECRET_ACCESS_KEY").ok()?;
        let bucket = std::env::var("R2_BUCKET").ok()?;
        Some(Self::new(endpoint, access_key, secret_key, bucket))
    }

    pub async fn presign_put(&self, key: &str, content_type: &str, size: i64) -> anyhow::Result<String> {
        let req = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .content_length(size)
            .presigned(PresigningConfig::expires_in(PUT_TTL)?)
            .await?;
        Ok(req.uri().to_string())
    }

    pub async fn presign_get(&self, key: &str) -> anyhow::Result<String> {
        let req = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .presigned(PresigningConfig::expires_in(GET_TTL)?)
            .await?;
        Ok(req.uri().to_string())
    }

    /// Size of the stored object, or `None` when it does not exist yet.
    pub async fn head_size(&self, key: &str) -> anyhow::Result<Option<i64>> {
        match self.client.head_object().bucket(&self.bucket).key(key).send().await {
            Ok(out) => Ok(out.content_length()),
            Err(e) if e.as_service_error().map(|s| s.is_not_found()).unwrap_or(false) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.client.delete_object().bucket(&self.bucket).key(key).send().await?;
        Ok(())
    }
}
```

In `backend/src/state.rs` add the field and builder:

```rust
use crate::storage::Storage;
// in the struct:
    pub storage: Option<Arc<Storage>>,
// in new(): storage: None,
// new method:
    pub fn with_storage(mut self, storage: Option<Storage>) -> Self {
        self.storage = storage.map(Arc::new);
        self
    }
```

In `backend/src/main.rs` replace the state line with:

```rust
    let storage = homesy_api::storage::Storage::from_env();
    if storage.is_none() {
        tracing::warn!("R2 variables not set: attachments disabled");
    }
    let state = state::AppState::new(pool, cfg.jwt_secret.clone()).with_storage(storage);
```

Append to `backend/.env.example`:

```
# Attachments (optional). Create the bucket and an R2 API token in the Cloudflare dashboard; keep values in 1Password.
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=homesy-attachments
# S3_ENDPOINT=http://localhost:9000   # only for MinIO in tests
```

- [ ] **Step 5: Run the tests and gates**

Run: `cd backend && cargo test --lib storage && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: 4 passed; no clippy warnings.

- [ ] **Step 6: Commit**

```bash
git add backend/Cargo.toml backend/Cargo.lock backend/src/storage.rs backend/src/lib.rs backend/src/state.rs backend/src/main.rs backend/.env.example
git commit -m "Storage client for the R2 attachments bucket (presigned URLs, optional via env)"
```

---

### Task 2: Schema, model and validation

**Files:**
- Create: `backend/migrations/0004_attachments.sql`, `backend/src/attachments.rs`
- Modify: `backend/src/models.rs`, `backend/src/lib.rs`

**Interfaces:**
- Produces: `models::Attachment` (FromRow), `models::AttachmentOut { id, kind, content_type, size_bytes, url, url_expires_at }` (Serialize), `attachments::Kind` enum with `as_str()`/`parse()`, `attachments::validate_upload(kind: Kind, content_type: &str, size_bytes: i64) -> Result<(), AppError>`, `attachments::to_out(storage: &Storage, a: &Attachment) -> anyhow::Result<AttachmentOut>`, `attachments::load_ready(pool, id) -> AppResult<Attachment>` (404 if missing, 409 if pending).

- [ ] **Step 1: Write the migration**

`backend/migrations/0004_attachments.sql`:

```sql
-- 0004_attachments.sql
-- Generic attachments stored in R2; owners reference them by id (expand-only).

create table attachments (
  id            uuid primary key,
  home_id       uuid not null references homes(id) on delete cascade,
  uploaded_by   uuid not null references users(id) on delete cascade,
  kind          varchar(32) not null,
  content_type  varchar(100) not null,
  size_bytes    bigint not null,
  status        varchar(16) not null default 'pending',
  created_at    timestamptz not null default now()
);
create index attachments_home_idx on attachments(home_id, status, created_at);

alter table household_bills add column receipt_id uuid references attachments(id) on delete set null;
alter table users add column avatar_id uuid references attachments(id) on delete set null;
alter table homes add column cover_id uuid references attachments(id) on delete set null;

create table vault_entry_attachments (
  entry_id      uuid not null references vault_entries(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  position      int not null default 0,
  primary key (entry_id, attachment_id)
);
```

- [ ] **Step 2: Write the failing validation tests**

Create `backend/src/attachments.rs` with the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_up_to_10_mib_are_fine_for_every_kind() {
        for k in [Kind::NotePhoto, Kind::BillReceipt, Kind::VaultDocument, Kind::Avatar, Kind::HomeCover] {
            assert!(validate_upload(k, "image/jpeg", 10 * 1024 * 1024).is_ok());
        }
    }

    #[test]
    fn pdfs_only_for_receipts_and_documents_up_to_20_mib() {
        assert!(validate_upload(Kind::BillReceipt, "application/pdf", 20 * 1024 * 1024).is_ok());
        assert!(validate_upload(Kind::VaultDocument, "application/pdf", 1).is_ok());
        assert!(validate_upload(Kind::Avatar, "application/pdf", 1).is_err());
        assert!(validate_upload(Kind::BillReceipt, "application/pdf", 20 * 1024 * 1024 + 1).is_err());
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
```

Add `pub mod attachments;` to `lib.rs`.

- [ ] **Step 3: Run to see them fail**

Run: `cd backend && cargo test --lib attachments`
Expected: compile error, `Kind`/`validate_upload` not found.

- [ ] **Step 4: Implement model, kind and validation**

Append to `backend/src/models.rs`:

```rust
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Attachment {
    pub id: Uuid,
    pub home_id: Uuid,
    pub uploaded_by: Uuid,
    pub kind: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

/// What clients see: the row plus a short-lived presigned GET.
#[derive(Debug, Clone, Serialize)]
pub struct AttachmentOut {
    pub id: Uuid,
    pub kind: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub url: String,
    pub url_expires_at: DateTime<Utc>,
}
```

Top of `backend/src/attachments.rs`:

```rust
use crate::error::{AppError, AppResult};
use crate::models::{Attachment, AttachmentOut};
use crate::storage::{Storage, GET_TTL};
use chrono::Utc;
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
            return Err(AppError::BadRequest("images must be 10 MiB or smaller".into()));
        }
        return Ok(());
    }
    if content_type == "application/pdf" {
        if !kind.allows_pdf() {
            return Err(AppError::BadRequest(format!("{} must be an image", kind.as_str())));
        }
        if size_bytes > MAX_PDF {
            return Err(AppError::BadRequest("PDFs must be 20 MiB or smaller".into()));
        }
        return Ok(());
    }
    Err(AppError::BadRequest(format!("unsupported content type {content_type}")))
}

pub fn to_out(storage: &Storage, a: &Attachment) -> impl std::future::Future<Output = anyhow::Result<AttachmentOut>> + '_ {
    let key = crate::storage::object_key(a.home_id, a.id);
    let a = a.clone();
    async move {
        let url = storage.presign_get(&key).await?;
        Ok(AttachmentOut {
            id: a.id,
            kind: a.kind,
            content_type: a.content_type,
            size_bytes: a.size_bytes,
            url,
            url_expires_at: Utc::now() + chrono::Duration::from_std(GET_TTL)?,
        })
    }
}

/// A `ready` attachment by id: 404 when unknown, 409 while the upload has not completed.
pub async fn load_ready(pool: &sqlx::PgPool, id: Uuid) -> AppResult<Attachment> {
    let a: Attachment = sqlx::query_as(&format!("select {ATTACHMENT_COLS} from attachments where id = $1"))
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
pub async fn load_for_owner(pool: &sqlx::PgPool, id: Uuid, home_id: Uuid, kind: Kind) -> AppResult<Attachment> {
    let a = load_ready(pool, id).await?;
    if a.home_id != home_id {
        return Err(AppError::BadRequest("attachment belongs to another home".into()));
    }
    if a.kind != kind.as_str() {
        return Err(AppError::BadRequest(format!("attachment is not a {}", kind.as_str())));
    }
    Ok(a)
}

/// Presigns in bulk for list responses; `None` ids and disabled storage yield `None`.
pub async fn outs_for(pool: &sqlx::PgPool, storage: Option<&Storage>, ids: &[Uuid]) -> AppResult<std::collections::HashMap<Uuid, AttachmentOut>> {
    let mut map = std::collections::HashMap::new();
    let Some(storage) = storage else { return Ok(map) };
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
```

- [ ] **Step 5: Run tests and gates**

Run: `cd backend && cargo test --lib attachments && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: 4 passed, clean.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/0004_attachments.sql backend/src/attachments.rs backend/src/models.rs backend/src/lib.rs
git commit -m "Attachments schema, model and upload validation"
```

---

### Task 3: Attachment routes and `GET /config`, with MinIO in CI

**Files:**
- Create: `backend/src/routes/attachments.rs`
- Modify: `backend/src/routes/mod.rs`, `backend/src/lib.rs`, `backend/tests/api_integration_test.rs`, `.github/workflows/api.yml`, `docker-compose.yml`

**Interfaces:**
- Consumes: Task 1 `Storage`, Task 2 `validate_upload`, `Kind`, `ATTACHMENT_COLS`, `to_out`.
- Produces: `POST /homes/{id}/attachments` → `{ id, upload_url, expires_at }`; `POST /attachments/{id}/complete` → `AttachmentOut`; `DELETE /attachments/{id}` → `{ ok: true }`; `GET /config` → `{ attachments: bool }`. Test helper `storage_for_tests() -> Option<Storage>` reading `S3_ENDPOINT`.

- [ ] **Step 1: Write the failing integration tests**

Append to `backend/tests/api_integration_test.rs` (reuse `setup_test_db`, `parse_json_response`; add a signup+home helper if the file lacks one):

```rust
fn storage_for_tests() -> Option<homesy_api::storage::Storage> {
    // CI runs MinIO; locally `docker compose up -d` starts it too. Without it these tests return early.
    let endpoint = std::env::var("S3_ENDPOINT").ok()?;
    Some(homesy_api::storage::Storage::new(endpoint, "homesy".into(), "homesyhomesy".into(), "homesy-test".into()))
}

async fn signup_and_home(app: &axum::Router) -> (String, String) {
    let email = format!("att_{}@example.com", Uuid::now_v7());
    let res = app.clone().oneshot(Request::builder().method("POST").uri("/auth/signup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"email": email, "password": "password123", "display_name": "Att"}).to_string())).unwrap()).await.unwrap();
    let token = parse_json_response(res.into_body()).await["token"].as_str().unwrap().to_string();
    let res = app.clone().oneshot(Request::builder().method("POST").uri("/homes")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"name": "Att Home"}).to_string())).unwrap()).await.unwrap();
    let home = parse_json_response(res.into_body()).await["id"].as_str().unwrap().to_string();
    (token, home)
}

#[tokio::test]
async fn attachments_are_disabled_without_storage() {
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state, None);
    let (token, home) = signup_and_home(&app).await;
    let res = app.clone().oneshot(Request::builder().uri("/config").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(parse_json_response(res.into_body()).await["attachments"], json!(false));
    let res = app.oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/attachments"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"kind":"bill_receipt","content_type":"image/jpeg","size_bytes":10}).to_string())).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn attachment_create_complete_read_delete() {
    let Some(storage) = storage_for_tests() else { return };
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;

    // create
    let res = app.clone().oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/attachments"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"kind":"bill_receipt","content_type":"image/png","size_bytes":4}).to_string())).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let created = parse_json_response(res.into_body()).await;
    let id = created["id"].as_str().unwrap().to_string();
    let upload_url = created["upload_url"].as_str().unwrap().to_string();

    // complete before upload → 409
    let res = app.clone().oneshot(Request::builder().method("POST").uri(format!("/attachments/{id}/complete"))
        .header(header::AUTHORIZATION, format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);

    // upload straight to storage with the presigned URL
    let client = reqwest::Client::new();
    let put = client.put(&upload_url).header("content-type", "image/png").body(vec![1u8, 2, 3, 4]).send().await.unwrap();
    assert!(put.status().is_success(), "{}", put.status());

    // complete → ready with a url
    let res = app.clone().oneshot(Request::builder().method("POST").uri(format!("/attachments/{id}/complete"))
        .header(header::AUTHORIZATION, format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let out = parse_json_response(res.into_body()).await;
    assert_eq!(out["size_bytes"], json!(4));
    let get = client.get(out["url"].as_str().unwrap()).send().await.unwrap();
    assert_eq!(get.bytes().await.unwrap().to_vec(), vec![1u8, 2, 3, 4]);

    // delete → object gone
    let res = app.clone().oneshot(Request::builder().method("DELETE").uri(format!("/attachments/{id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let get = client.get(out["url"].as_str().unwrap()).send().await.unwrap();
    assert_eq!(get.status(), 404);
}

#[tokio::test]
async fn attachment_rejects_bad_type_and_non_members() {
    let Some(storage) = storage_for_tests() else { return };
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;
    let (other_token, _other_home) = signup_and_home(&app).await;
    let bad = app.clone().oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/attachments"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"kind":"avatar","content_type":"application/pdf","size_bytes":10}).to_string())).unwrap()).await.unwrap();
    assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    let forbidden = app.oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/attachments"))
        .header(header::AUTHORIZATION, format!("Bearer {other_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"kind":"avatar","content_type":"image/png","size_bytes":10}).to_string())).unwrap()).await.unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
}
```

Add `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }` to `[dev-dependencies]`.

- [ ] **Step 2: Run to see them fail**

Run: `cd backend && cargo test --test api_integration_test attachments`
Expected: compile error (`with_storage` exists; `/config` and routes missing → the first test fails with 404 at `/config`).

- [ ] **Step 3: Implement the routes**

`backend/src/routes/attachments.rs`:

```rust
use crate::attachments::{validate_upload, Kind, ATTACHMENT_COLS};
use crate::auth::{ensure_member, AuthUser};
use crate::error::{AppError, AppResult};
use crate::models::{Attachment, AttachmentOut};
use crate::state::AppState;
use crate::storage::{object_key, PUT_TTL};
use axum::{extract::{Path, State}, routing::{get, post}, Json, Router};
use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/config", get(config))
        .route("/homes/{home_id}/attachments", post(create))
        .route("/attachments/{id}/complete", post(complete))
        .route("/attachments/{id}", axum::routing::delete(remove))
}

async fn config(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "attachments": s.storage.is_some() }))
}

fn storage(s: &AppState) -> AppResult<&crate::storage::Storage> {
    s.storage.as_deref().ok_or_else(|| AppError::Disabled("attachments disabled".into()))
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
    .bind(id).bind(home_id).bind(uid).bind(kind.as_str()).bind(&b.content_type).bind(b.size_bytes)
    .execute(&s.pool)
    .await?;
    let upload_url = storage.presign_put(&object_key(home_id, id), &b.content_type, b.size_bytes).await?;
    Ok(Json(serde_json::json!({
        "id": id,
        "upload_url": upload_url,
        "expires_at": Utc::now() + chrono::Duration::from_std(PUT_TTL).unwrap_or_default(),
    })))
}

async fn load_own(pool: &sqlx::PgPool, uid: Uuid, id: Uuid) -> AppResult<Attachment> {
    let a: Attachment = sqlx::query_as(&format!("select {ATTACHMENT_COLS} from attachments where id = $1"))
        .bind(id).fetch_optional(pool).await?.ok_or(AppError::NotFound)?;
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
        sqlx::query("delete from attachments where id = $1").bind(id).execute(&s.pool).await?;
        return Err(AppError::BadRequest("uploaded size does not match".into()));
    }
    let a: Attachment = sqlx::query_as(&format!(
        "update attachments set status = 'ready' where id = $1 returning {ATTACHMENT_COLS}"
    ))
    .bind(id).fetch_one(&s.pool).await?;
    Ok(Json(crate::attachments::to_out(storage, &a).await?))
}

async fn remove(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let storage = storage(&s)?;
    let a = load_own(&s.pool, uid, id).await?;
    if a.uploaded_by != uid {
        let (role,): (String,) = sqlx::query_as("select role from home_members where home_id = $1 and user_id = $2")
            .bind(a.home_id).bind(uid).fetch_one(&s.pool).await?;
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
    sqlx::query("delete from attachments where id = $1").bind(a.id).execute(&s.pool).await?;
    Ok(())
}

/// Deletes every attachment in `ids` that still exists; used by owner deletes.
pub async fn delete_many(s: &AppState, ids: &[Uuid]) -> AppResult<()> {
    let rows: Vec<Attachment> = sqlx::query_as(&format!("select {ATTACHMENT_COLS} from attachments where id = any($1)"))
        .bind(ids).fetch_all(&s.pool).await?;
    for a in &rows {
        delete_object_and_row(s, a).await?;
    }
    Ok(())
}
```

Add a `Disabled(String)` variant to `AppError` in `error.rs` mapping to `StatusCode::SERVICE_UNAVAILABLE` with the message. Register `pub mod attachments;` in `routes/mod.rs` and `.merge(routes::attachments::router())` in `create_app`.

- [ ] **Step 4: MinIO for tests**

Add to `docker-compose.yml` services:

```yaml
  minio:
    image: minio/minio:latest
    command: server /data
    environment:
      MINIO_ROOT_USER: homesy
      MINIO_ROOT_PASSWORD: homesyhomesy
    ports: ["9000:9000"]
    volumes: ["miniodata:/data"]
  minio-init:
    image: minio/mc:latest
    depends_on: [minio]
    entrypoint: ["/bin/sh", "-c", "sleep 2 && mc alias set local http://minio:9000 homesy homesyhomesy && mc mb -p local/homesy-test"]
```

and `miniodata:` under `volumes`. In `.github/workflows/api.yml` under `jobs.test.services` add:

```yaml
      minio:
        image: bitnami/minio:latest
        env:
          MINIO_ROOT_USER: homesy
          MINIO_ROOT_PASSWORD: homesyhomesy
          MINIO_DEFAULT_BUCKETS: homesy-test
        ports:
          - 9000:9000
```

and to the `cargo test` step env: `S3_ENDPOINT: http://localhost:9000`.

- [ ] **Step 5: Run the tests**

Run: `cd backend && docker compose up -d && S3_ENDPOINT=http://localhost:9000 cargo test --test api_integration_test attachment && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend docker-compose.yml .github/workflows/api.yml
git commit -m "Attachment routes: presigned create, complete with HEAD check, delete, GET /config; MinIO in tests"
```

---

### Task 4: Bill receipts

**Files:**
- Modify: `backend/src/routes/bills.rs`, `backend/src/models.rs`, `backend/tests/api_integration_test.rs`

**Interfaces:**
- Consumes: `attachments::load_for_owner`, `attachments::outs_for`, `routes::attachments::delete_many`.
- Produces: `HouseholdBill.receipt_id: Option<Uuid>` and `HouseholdBill.receipt: Option<AttachmentOut>` (serialized, `#[sqlx(skip)]`); `CreateBill.receipt_id`, `UpdateBill.receipt_id` (`Option<Option<Uuid>>` so `null` clears).

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn bill_receipt_attaches_and_rejects_foreign_attachment() {
    let Some(storage) = storage_for_tests() else { return };
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;
    let (other_token, other_home) = signup_and_home(&app).await;
    let mine = upload_ready(&app, &token, &home, "bill_receipt").await;
    let theirs = upload_ready(&app, &other_token, &other_home, "bill_receipt").await;

    let res = app.clone().oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/bills"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"title":"Gas","category":"gas","billing_period":"Oct","receipt_id": theirs}).to_string())).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let res = app.clone().oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/bills"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"title":"Gas","category":"gas","billing_period":"Oct","receipt_id": mine}).to_string())).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bill = parse_json_response(res.into_body()).await;
    assert_eq!(bill["receipt"]["id"].as_str().unwrap(), mine);
    assert!(bill["receipt"]["url"].as_str().unwrap().starts_with("http"));
}
```

Add the helper next to `signup_and_home`:

```rust
/// Creates, uploads 4 bytes and completes an attachment; returns its id.
async fn upload_ready(app: &axum::Router, token: &str, home: &str, kind: &str) -> String {
    let res = app.clone().oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/attachments"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"kind": kind, "content_type":"image/png","size_bytes":4}).to_string())).unwrap()).await.unwrap();
    let created = parse_json_response(res.into_body()).await;
    reqwest::Client::new().put(created["upload_url"].as_str().unwrap()).header("content-type", "image/png").body(vec![1u8, 2, 3, 4]).send().await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    app.clone().oneshot(Request::builder().method("POST").uri(format!("/attachments/{id}/complete"))
        .header(header::AUTHORIZATION, format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
    id
}
```

- [ ] **Step 2: Run to see it fail**

Run: `cd backend && S3_ENDPOINT=http://localhost:9000 cargo test --test api_integration_test bill_receipt`
Expected: FAIL: the first POST returns 200 (field ignored) instead of 400.

- [ ] **Step 3: Implement**

`models.rs` `HouseholdBill`: add `pub receipt_id: Option<Uuid>,` after `notes` and, after `created_by_name`, `#[sqlx(skip)] pub receipt: Option<AttachmentOut>,`. In `bills.rs`: add `b.receipt_id,` to `BILL_SELECT`; `CreateBill` gains `receipt_id: Option<Uuid>`; `UpdateBill` gains `#[serde(default, deserialize_with = "double_option")] receipt_id: Option<Option<Uuid>>` with:

```rust
fn double_option<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<Uuid>>, D::Error> {
    Option::<Uuid>::deserialize(d).map(Some)
}
```

In `create_bill`, before the insert:

```rust
    if let Some(rid) = b.receipt_id {
        crate::attachments::load_for_owner(&s.pool, rid, home_id, crate::attachments::Kind::BillReceipt).await?;
    }
```

and bind it as a new column in the insert (`receipt_id`). In `update_bill`:

```rust
    let new_receipt_id = match b.receipt_id {
        Some(Some(rid)) => {
            crate::attachments::load_for_owner(&s.pool, rid, home_id, crate::attachments::Kind::BillReceipt).await?;
            Some(rid)
        }
        Some(None) => None,
        None => existing.receipt_id,
    };
```

add `receipt_id = $9` to the update statement (renumber `where id`). Replace `fetch_bill_with_names`/`list_bills` returns with a `decorate(&s, bills)` step:

```rust
async fn decorate(s: &AppState, mut bills: Vec<HouseholdBill>) -> AppResult<Vec<HouseholdBill>> {
    let ids: Vec<Uuid> = bills.iter().filter_map(|b| b.receipt_id).collect();
    let outs = crate::attachments::outs_for(&s.pool, s.storage.as_deref(), &ids).await?;
    for b in &mut bills {
        b.receipt = b.receipt_id.and_then(|id| outs.get(&id).cloned());
    }
    Ok(bills)
}
```

Call it in `list_bills` and wrap single-bill returns with `decorate(&s, vec![bill]).await?.remove(0)`. In `delete_bill`, before deleting the row: `if let Some(rid) = existing_receipt_id { crate::routes::attachments::delete_many(&s, &[rid]).await?; }` (select `receipt_id` alongside `title`). If a previous receipt is replaced or cleared in `update_bill`, delete the old attachment the same way.

- [ ] **Step 4: Run tests and gates**

Run: `cd backend && S3_ENDPOINT=http://localhost:9000 cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: all pass including the existing bills tests.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Bills carry an optional receipt attachment"
```

---

### Task 5: Vault documents

**Files:**
- Modify: `backend/src/routes/vault.rs`, `backend/src/models.rs`, `backend/tests/api_integration_test.rs`

**Interfaces:**
- Produces: `VaultEntry.attachments: Vec<AttachmentOut>` (`#[sqlx(skip)]`), `CreateEntry.attachment_ids: Vec<Uuid>` (default empty), `UpdateEntry.attachment_ids: Option<Vec<Uuid>>` (full replacement).

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn vault_entry_documents_replace_and_cascade() {
    let Some(storage) = storage_for_tests() else { return };
    let (pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;
    let d1 = upload_ready(&app, &token, &home, "vault_document").await;
    let d2 = upload_ready(&app, &token, &home, "vault_document").await;
    let res = app.clone().oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/vault"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"category":"documents","label":"Lease","value":"Flat 4B","attachment_ids":[d1, d2]}).to_string())).unwrap()).await.unwrap();
    let entry = parse_json_response(res.into_body()).await;
    assert_eq!(entry["attachments"].as_array().unwrap().len(), 2);
    let entry_id = entry["id"].as_str().unwrap().to_string();

    let res = app.clone().oneshot(Request::builder().method("PATCH").uri(format!("/vault/{entry_id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"attachment_ids":[d2]}).to_string())).unwrap()).await.unwrap();
    let entry = parse_json_response(res.into_body()).await;
    assert_eq!(entry["attachments"][0]["id"].as_str().unwrap(), d2);
    let (n,): (i64,) = sqlx::query_as("select count(*) from attachments where id = $1").bind(Uuid::parse_str(&d1).unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(n, 0, "dropped document is deleted");

    app.clone().oneshot(Request::builder().method("DELETE").uri(format!("/vault/{entry_id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
    let (n,): (i64,) = sqlx::query_as("select count(*) from attachments where id = $1").bind(Uuid::parse_str(&d2).unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(n, 0, "entry delete removes its documents");
}
```

- [ ] **Step 2: Run to see it fail**

Run: `cd backend && S3_ENDPOINT=http://localhost:9000 cargo test --test api_integration_test vault_entry_documents`
Expected: FAIL on `entry["attachments"]` being null.

- [ ] **Step 3: Implement**

`models.rs` `VaultEntry`: add `#[sqlx(skip)] pub attachments: Vec<AttachmentOut>,`. In `vault.rs`:

```rust
async fn set_documents(s: &AppState, uid_home: Uuid, entry_id: Uuid, ids: &[Uuid]) -> AppResult<()> {
    for id in ids {
        crate::attachments::load_for_owner(&s.pool, *id, uid_home, crate::attachments::Kind::VaultDocument).await?;
    }
    let old: Vec<(Uuid,)> = sqlx::query_as("select attachment_id from vault_entry_attachments where entry_id = $1")
        .bind(entry_id).fetch_all(&s.pool).await?;
    let dropped: Vec<Uuid> = old.iter().map(|r| r.0).filter(|id| !ids.contains(id)).collect();
    sqlx::query("delete from vault_entry_attachments where entry_id = $1").bind(entry_id).execute(&s.pool).await?;
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("insert into vault_entry_attachments (entry_id, attachment_id, position) values ($1, $2, $3)")
            .bind(entry_id).bind(id).bind(i as i32).execute(&s.pool).await?;
    }
    crate::routes::attachments::delete_many(s, &dropped).await
}

async fn decorate(s: &AppState, mut rows: Vec<VaultEntry>) -> AppResult<Vec<VaultEntry>> {
    let entry_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let links: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select entry_id, attachment_id from vault_entry_attachments where entry_id = any($1) order by position",
    ).bind(&entry_ids).fetch_all(&s.pool).await?;
    let ids: Vec<Uuid> = links.iter().map(|l| l.1).collect();
    let outs = crate::attachments::outs_for(&s.pool, s.storage.as_deref(), &ids).await?;
    for r in &mut rows {
        r.attachments = links.iter().filter(|l| l.0 == r.id).filter_map(|l| outs.get(&l.1).cloned()).collect();
    }
    Ok(rows)
}
```

`CreateEntry` gains `#[serde(default)] attachment_ids: Vec<Uuid>`; after the insert call `set_documents(&s, home_id, row.id, &b.attachment_ids).await?` then `decorate`. `UpdateEntry` gains `attachment_ids: Option<Vec<Uuid>>`; when `Some`, call `set_documents`. `list_entries`, create, update return decorated rows. `delete_entry`: before deleting the row, collect its attachment ids and call `delete_many` (the join rows cascade).

- [ ] **Step 4: Run tests and gates**

Run: `cd backend && S3_ENDPOINT=http://localhost:9000 cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Vault entries carry ordered document attachments"
```

---

### Task 6: Avatars and home cover

**Files:**
- Modify: `backend/src/routes/auth.rs`, `backend/src/routes/homes.rs`, `backend/src/models.rs`, `backend/tests/api_integration_test.rs`

**Interfaces:**
- Produces: `PATCH /me` body `{ display_name?, avatar_id?: uuid|null }` → `User`; `PATCH /homes/{id}` body `{ name?, emoji?, cover_id?: uuid|null }` (owners only) → `Home`; `User.avatar_id`, `User.avatar: Option<AttachmentOut>`; `Member.avatar: Option<AttachmentOut>`; `Home.cover_id`, `Home.cover: Option<AttachmentOut>`. Events: `member_updated` `{ user_id }`, `home_updated` (Home).

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn avatar_and_cover_are_set_through_patch() {
    let Some(storage) = storage_for_tests() else { return };
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;
    let avatar = upload_ready(&app, &token, &home, "avatar").await;
    let cover = upload_ready(&app, &token, &home, "home_cover").await;

    let res = app.clone().oneshot(Request::builder().method("PATCH").uri("/me")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"avatar_id": avatar}).to_string())).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(parse_json_response(res.into_body()).await["avatar"]["id"].as_str().unwrap(), avatar);

    let res = app.clone().oneshot(Request::builder().method("PATCH").uri(format!("/homes/{home}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"cover_id": cover}).to_string())).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app.oneshot(Request::builder().uri(format!("/homes/{home}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
    let detail = parse_json_response(res.into_body()).await;
    assert_eq!(detail["cover"]["id"].as_str().unwrap(), cover);
    assert_eq!(detail["members"][0]["avatar"]["id"].as_str().unwrap(), avatar);
}
```

- [ ] **Step 2: Run to see it fail**

Run: `cd backend && S3_ENDPOINT=http://localhost:9000 cargo test --test api_integration_test avatar_and_cover`
Expected: FAIL with 404/405 on `PATCH /me`.

- [ ] **Step 3: Implement**

Models: `User` gains `pub avatar_id: Option<Uuid>` and `#[sqlx(skip)] pub avatar: Option<AttachmentOut>`; `Member` gains `pub avatar_id: Option<Uuid>` and `#[sqlx(skip)] pub avatar: Option<AttachmentOut>`; `Home` gains `pub cover_id: Option<Uuid>` and `#[sqlx(skip)] pub cover: Option<AttachmentOut>`. Update `USER_COLS` to include `avatar_id`, the member select in `homes.rs` to include `u.avatar_id`, and `HOME_COLS` (or the select) to include `cover_id`.

`auth.rs`: add `.route("/me", get(me).patch(update_me))` with

```rust
#[derive(Deserialize)]
struct UpdateMe {
    display_name: Option<String>,
    #[serde(default, deserialize_with = "crate::attachments::double_option")]
    avatar_id: Option<Option<Uuid>>,
}

async fn update_me(State(s): State<AppState>, AuthUser(uid): AuthUser, Json(b): Json<UpdateMe>) -> AppResult<Json<User>> {
    let current: User = sqlx::query_as(&format!("select {USER_COLS} from users where id = $1")).bind(uid).fetch_one(&s.pool).await?;
    let name = match b.display_name { Some(n) if !n.trim().is_empty() => n.trim().to_string(), _ => current.display_name.clone() };
    let avatar_id = match b.avatar_id {
        Some(Some(id)) => {
            let a = crate::attachments::load_ready(&s.pool, id).await?;
            if a.uploaded_by != uid || a.kind != "avatar" { return Err(AppError::BadRequest("not your avatar".into())); }
            Some(id)
        }
        Some(None) => None,
        None => current.avatar_id,
    };
    if current.avatar_id.is_some() && current.avatar_id != avatar_id {
        crate::routes::attachments::delete_many(&s, &[current.avatar_id.unwrap()]).await?;
    }
    let user: User = sqlx::query_as(&format!("update users set display_name = $1, avatar_id = $2 where id = $3 returning {USER_COLS}"))
        .bind(&name).bind(avatar_id).bind(uid).fetch_one(&s.pool).await?;
    let homes: Vec<(Uuid,)> = sqlx::query_as("select home_id from home_members where user_id = $1").bind(uid).fetch_all(&s.pool).await?;
    for (home_id,) in homes {
        s.broadcast(crate::models::HomeEvent { home_id, event_type: "member_updated".into(), payload: serde_json::json!({ "user_id": uid }) });
    }
    Ok(Json(decorate_user(&s, user).await?))
}
```

Move `double_option` from `bills.rs` into `attachments.rs` as `pub fn double_option`. Add `decorate_user` (presigns `avatar`) and use it in `me` too. In `homes.rs` add `PATCH /homes/{id}` (owner check via `home_members.role`), validating `cover_id` with `load_for_owner(.., Kind::HomeCover)`, deleting a replaced cover, broadcasting `home_updated`; decorate `cover` on `list_homes`, `get_home`, `create_home`, `join_home`, and members' `avatar` in `get_home` using `outs_for` on the collected ids.

- [ ] **Step 4: Run tests and gates**

Run: `cd backend && S3_ENDPOINT=http://localhost:9000 cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Avatars and home cover photos via PATCH /me and PATCH /homes/{id}"
```

---

### Task 7: Pending sweep

**Files:**
- Create: `backend/src/sweep.rs`
- Modify: `backend/src/lib.rs`, `backend/src/main.rs`, `backend/tests/api_integration_test.rs`

**Interfaces:**
- Produces: `sweep::delete_stale_pending(state: &AppState, older_than: chrono::Duration) -> anyhow::Result<usize>` and `sweep::spawn(state: AppState)` (runs at startup and every 6 hours).

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn stale_pending_attachments_are_swept() {
    let Some(storage) = storage_for_tests() else { return };
    let (pool, state) = setup_test_db().await;
    let state = state.with_storage(Some(storage));
    let app = create_app(state.clone(), None);
    let (token, home) = signup_and_home(&app).await;
    let res = app.clone().oneshot(Request::builder().method("POST").uri(format!("/homes/{home}/attachments"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"kind":"avatar","content_type":"image/png","size_bytes":4}).to_string())).unwrap()).await.unwrap();
    let id = Uuid::parse_str(parse_json_response(res.into_body()).await["id"].as_str().unwrap()).unwrap();
    sqlx::query("update attachments set created_at = now() - interval '2 days' where id = $1").bind(id).execute(&pool).await.unwrap();
    let n = homesy_api::sweep::delete_stale_pending(&state, chrono::Duration::days(1)).await.unwrap();
    assert!(n >= 1);
    let (left,): (i64,) = sqlx::query_as("select count(*) from attachments where id = $1").bind(id).fetch_one(&pool).await.unwrap();
    assert_eq!(left, 0);
}
```

- [ ] **Step 2: Run to see it fail**

Run: `cd backend && S3_ENDPOINT=http://localhost:9000 cargo test --test api_integration_test stale_pending`
Expected: compile error, `sweep` not found.

- [ ] **Step 3: Implement**

`backend/src/sweep.rs`:

```rust
use crate::attachments::ATTACHMENT_COLS;
use crate::models::Attachment;
use crate::state::AppState;
use std::time::Duration;

/// Removes uploads that were started but never completed, with their objects (which may not exist).
pub async fn delete_stale_pending(state: &AppState, older_than: chrono::Duration) -> anyhow::Result<usize> {
    let cutoff = chrono::Utc::now() - older_than;
    let rows: Vec<Attachment> = sqlx::query_as(&format!(
        "select {ATTACHMENT_COLS} from attachments where status = 'pending' and created_at < $1"
    ))
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;
    for a in &rows {
        if let Some(storage) = state.storage.as_deref() {
            if let Err(e) = storage.delete(&crate::storage::object_key(a.home_id, a.id)).await {
                tracing::warn!(error = %e, id = %a.id, "sweep: object delete failed");
            }
        }
        sqlx::query("delete from attachments where id = $1").bind(a.id).execute(&state.pool).await?;
    }
    Ok(rows.len())
}

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            match delete_stale_pending(&state, chrono::Duration::days(1)).await {
                Ok(n) if n > 0 => tracing::info!(n, "sweep: removed stale pending attachments"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "sweep failed"),
            }
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
}
```

Add `pub mod sweep;` to `lib.rs`; in `main.rs` after creating `state`: `homesy_api::sweep::spawn(state.clone());`.

- [ ] **Step 4: Run tests and gates**

Run: `cd backend && S3_ENDPOINT=http://localhost:9000 cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Sweep stale pending attachments at startup and every 6 hours"
```

---

### Task 8: Mobile upload helper, types and feature flag

**Files:**
- Create: `mobile/src/api/attachments.ts`, `mobile/src/api/__tests__/attachments.test.ts`, `mobile/src/store/features.ts`
- Modify: `mobile/package.json` (via `expo install`), `mobile/src/api/types.ts`, `mobile/src/api/client.ts`, `mobile/app/_layout.tsx`

**Interfaces:**
- Produces: `type Attachment = { id; kind: AttachmentKind; content_type; size_bytes; url; url_expires_at }`, `type AttachmentKind`, `prepareImage(uri, contentType) → { uri, contentType: 'image/jpeg' | 'image/png' | 'image/webp', sizeBytes }`, `uploadAttachment(homeId, kind, file: { uri, contentType, sizeBytes }, onProgress?) → Promise<Attachment>`, `api.config()`, `api.createAttachment`, `api.completeAttachment`, `api.deleteAttachment`, `api.updateMe`, `api.updateHome`; `useFeatures()` store `{ attachments: boolean, loaded: boolean, load(): Promise<void> }`.

- [ ] **Step 1: Install native deps**

Run: `cd mobile && ./node_modules/.bin/expo install expo-image-picker expo-document-picker expo-image-manipulator expo-file-system`
Expected: versions pinned to SDK 57; `expo-doctor` clean. Add to `app.json` plugins: `["expo-image-picker", { "photosPermission": "Homesy uses your photos for receipts, documents and notes." }]`.

- [ ] **Step 2: Write the failing unit tests**

`mobile/src/api/__tests__/attachments.test.ts`:

```ts
import { needsConversion, pickContentType, uploadKindAllows } from '../attachments';

describe('attachment helpers', () => {
  it('converts HEIC and oversized images, keeps small jpeg/png as is', () => {
    expect(needsConversion('image/heic', 800)).toBe(true);
    expect(needsConversion('image/jpeg', 4000)).toBe(true);
    expect(needsConversion('image/jpeg', 1200)).toBe(false);
    expect(needsConversion('image/png', 2048)).toBe(false);
  });
  it('derives a content type from the picker result', () => {
    expect(pickContentType('photo.HEIC', undefined)).toBe('image/heic');
    expect(pickContentType('x.pdf', 'application/pdf')).toBe('application/pdf');
    expect(pickContentType('x.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(pickContentType('x.bin', undefined)).toBeNull();
  });
  it('allows pdf only for receipts and documents', () => {
    expect(uploadKindAllows('bill_receipt', 'application/pdf')).toBe(true);
    expect(uploadKindAllows('avatar', 'application/pdf')).toBe(false);
    expect(uploadKindAllows('avatar', 'image/png')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd mobile && ./node_modules/.bin/jest src/api/__tests__/attachments.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`mobile/src/api/types.ts` additions:

```ts
export type AttachmentKind = 'note_photo' | 'bill_receipt' | 'vault_document' | 'avatar' | 'home_cover';
export type Attachment = {
  id: string; kind: AttachmentKind; content_type: string; size_bytes: number; url: string; url_expires_at: string;
};
```

and `receipt_id: string | null; receipt: Attachment | null;` on `HouseholdBill`, `attachments: Attachment[]` on `VaultEntry`, `avatar_id: string | null; avatar: Attachment | null` on `User` and `Member`, `cover_id: string | null; cover: Attachment | null` on `Home`.

`client.ts` additions inside `api`:

```ts
  config: () => request<{ attachments: boolean }>('/config'),
  createAttachment: (homeId: string, b: { kind: AttachmentKind; content_type: string; size_bytes: number }) =>
    request<{ id: string; upload_url: string; expires_at: string }>(`/homes/${homeId}/attachments`, { method: 'POST', body: json(b) }),
  completeAttachment: (id: string) => request<Attachment>(`/attachments/${id}/complete`, { method: 'POST' }),
  deleteAttachment: (id: string) => request<{ ok: true }>(`/attachments/${id}`, { method: 'DELETE' }),
  updateMe: (b: { display_name?: string; avatar_id?: string | null }) => request<User>('/me', { method: 'PATCH', body: json(b) }),
  updateHome: (id: string, b: { name?: string; emoji?: string; cover_id?: string | null }) => request<Home>(`/homes/${id}`, { method: 'PATCH', body: json(b) }),
```

and `receipt_id?: string | null` on `createBill`/`updateBill` bodies, `attachment_ids?: string[]` on `createVault`/`updateVault`.

`mobile/src/api/attachments.ts`:

```ts
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api } from './client';
import type { Attachment, AttachmentKind } from './types';

export const MAX_EDGE = 2048;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export type PickedFile = { uri: string; contentType: string; sizeBytes: number; width?: number; height?: number };

/** HEIC always converts (R2 serves it but Android cannot show it); large images are downsized. */
export function needsConversion(contentType: string, longEdge: number): boolean {
  return contentType === 'image/heic' || longEdge > MAX_EDGE;
}

export function pickContentType(name: string, mime: string | undefined): string | null {
  if (mime && (IMAGE_TYPES.includes(mime) || mime === 'application/pdf')) return mime;
  const ext = name.toLowerCase().split('.').pop();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, string>)[ext ?? ''] ?? null;
}

export function uploadKindAllows(kind: AttachmentKind, contentType: string): boolean {
  if (contentType === 'application/pdf') return kind === 'bill_receipt' || kind === 'vault_document';
  return IMAGE_TYPES.includes(contentType);
}

/** Resizes and re-encodes when needed so the declared content type matches the bytes. */
export async function prepareImage(file: PickedFile): Promise<PickedFile> {
  const longEdge = Math.max(file.width ?? 0, file.height ?? 0);
  if (!needsConversion(file.contentType, longEdge)) return file;
  const ctx = ImageManipulator.manipulate(file.uri);
  if (longEdge > MAX_EDGE) ctx.resize(file.width! >= file.height! ? { width: MAX_EDGE } : { height: MAX_EDGE });
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const info = await FileSystem.getInfoAsync(saved.uri, { size: true });
  return { uri: saved.uri, contentType: 'image/jpeg', sizeBytes: info.exists ? info.size ?? 0 : 0, width: saved.width, height: saved.height };
}

export async function uploadAttachment(homeId: string, kind: AttachmentKind, file: PickedFile, onProgress?: (fraction: number) => void): Promise<Attachment> {
  const ready = file.contentType.startsWith('image/') ? await prepareImage(file) : file;
  const slot = await api.createAttachment(homeId, { kind, content_type: ready.contentType, size_bytes: ready.sizeBytes });
  const task = FileSystem.createUploadTask(slot.upload_url, ready.uri, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': ready.contentType },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  }, (p) => onProgress?.(p.totalBytesExpectedToSend ? p.totalBytesSent / p.totalBytesExpectedToSend : 0));
  const res = await task.uploadAsync();
  if (!res || res.status < 200 || res.status >= 300) throw new Error(`Upload failed (${res?.status ?? 'no response'})`);
  return api.completeAttachment(slot.id);
}
```

`mobile/src/store/features.ts`:

```ts
import { create } from 'zustand';
import { api } from '@/api/client';

/** Server capabilities fetched once per session; attachments are hidden until the API says they're on. */
export const useFeatures = create<{ attachments: boolean; loaded: boolean; load: () => Promise<void> }>((set) => ({
  attachments: false,
  loaded: false,
  load: async () => {
    try { const c = await api.config(); set({ attachments: c.attachments, loaded: true }); } catch { set({ loaded: true }); }
  },
}));
```

In `app/_layout.tsx` call `useFeatures.getState().load()` inside the existing hydrate effect.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd mobile && ./node_modules/.bin/jest && ./node_modules/.bin/tsc --noEmit`
Expected: all pass (29 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/src/api mobile/src/store/features.ts mobile/app/_layout.tsx
git commit -m "Mobile attachment upload helper, types and the attachments feature flag"
```

---

### Task 9: `AttachmentThumb`, `AttachmentPicker` and the viewer

**Files:**
- Create: `mobile/src/ui/AttachmentThumb.tsx`, `mobile/src/ui/AttachmentPicker.tsx`, `mobile/src/ui/AttachmentViewer.tsx`, `mobile/src/ui/__tests__/AttachmentThumb.test.tsx`
- Modify: `mobile/src/ui/index.ts`, `mobile/src/ui/Icon.tsx` (add `photo`, `document`, `camera` from lucide: `Image`, `FileText`, `Camera`)

**Interfaces:**
- Produces: `<AttachmentThumb attachment size? onRemove? onExpired />` (image tile or PDF tile; tap opens `AttachmentViewer`; long-press offers Remove when `onRemove`), `<AttachmentPicker kind homeId onUploaded label? allowPdf? />` (dashed chip; runs picker → `uploadAttachment` with a progress ring; hidden when `useFeatures().attachments` is false), `<AttachmentViewer attachment visible onClose />` (full-screen `Modal`: `Image` with pinch via `expo-image`'s contentFit `contain`; PDFs open with `Linking.openURL(url)` and the viewer never shows).

- [ ] **Step 1: Write the failing test** (`react-test-renderer` is available through jest-expo)

```tsx
import { render, fireEvent } from '@testing-library/react-native';
import { AttachmentThumb } from '../AttachmentThumb';

const att = { id: 'a', kind: 'bill_receipt' as const, content_type: 'image/jpeg', size_bytes: 10, url: 'https://x/y', url_expires_at: '2026-10-05T00:00:00Z' };

it('asks for a refresh once when the image fails to load', () => {
  const onExpired = jest.fn();
  const { getByTestId } = render(<AttachmentThumb attachment={att} onExpired={onExpired} />);
  fireEvent(getByTestId('attachment-image'), 'error');
  fireEvent(getByTestId('attachment-image'), 'error');
  expect(onExpired).toHaveBeenCalledTimes(1);
});

it('renders a document tile for PDFs', () => {
  const { getByLabelText } = render(<AttachmentThumb attachment={{ ...att, content_type: 'application/pdf' }} />);
  expect(getByLabelText('PDF document, 10 bytes')).toBeTruthy();
});
```

Run: `cd mobile && ./node_modules/.bin/expo install @testing-library/react-native --dev` first if missing.

- [ ] **Step 2: Run to see it fail**

Run: `cd mobile && ./node_modules/.bin/jest src/ui/__tests__/AttachmentThumb.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the three components**

`AttachmentThumb.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import type { Attachment } from '@/api/types';
import { AttachmentViewer } from './AttachmentViewer';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { color, radius, space } from './tokens';

function sizeLabel(n: number) {
  return n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 72 pt tile. An image load error means the presigned URL expired: `onExpired` fires once so the owner refetches. */
export function AttachmentThumb({ attachment, size = 72, onRemove, onExpired }: {
  attachment: Attachment; size?: number; onRemove?: () => void; onExpired?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const refreshed = useRef(false);
  const isPdf = attachment.content_type === 'application/pdf';
  const openIt = () => (isPdf ? Linking.openURL(attachment.url) : setOpen(true));
  return (
    <>
      <Pressable
        onPress={openIt}
        onLongPress={onRemove}
        accessibilityLabel={isPdf ? `PDF document, ${sizeLabel(attachment.size_bytes)}` : `Photo, ${sizeLabel(attachment.size_bytes)}`}
        accessibilityHint={onRemove ? 'Long press to remove' : undefined}
        style={[s.tile, { width: size, height: size }]}
      >
        {isPdf ? (
          <View style={s.doc}><Icon name="document" tint={color.ink2} /><Text variant="caption" tone="muted">PDF</Text></View>
        ) : (
          <Image
            testID="attachment-image"
            source={{ uri: attachment.url }}
            style={StyleSheet.absoluteFill}
            onError={() => { if (!refreshed.current) { refreshed.current = true; onExpired?.(); } }}
          />
        )}
      </Pressable>
      {!isPdf ? <AttachmentViewer attachment={attachment} visible={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const s = StyleSheet.create({
  tile: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: color.surfaceSunk, borderWidth: 1, borderColor: color.line },
  doc: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(1) },
});
```

`AttachmentViewer.tsx`: a transparent `Modal` over `color.ink` at 96% opacity, the image `contentFit="contain"` filling the screen, a close `IconButton` (`close`, label "Close photo") at the top-right under the safe-area inset, fade in/out 180 ms (snap under Reduce Motion), `onRequestClose={onClose}`.

`AttachmentPicker.tsx`: props `{ homeId, kind, onUploaded(att), allowPdf?, label? }`. Renders nothing when `useFeatures((f) => f.attachments)` is false. A dashed-border `Pressable` chip "Add photo" (or "Add photo or PDF") with icon `camera`; on press shows an `Alert` action sheet: "Take photo" (`launchCameraAsync`), "Choose photo" (`launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })`), and when `allowPdf` "Choose PDF" (`getDocumentAsync({ type: 'application/pdf' })`). Builds a `PickedFile` with `pickContentType`, rejects with `Alert` when `uploadKindAllows` fails or the size exceeds the spec limits, then calls `uploadAttachment` with progress shown as a `Text` "Uploading 42%" inside the chip and the chip disabled. Errors use `friendlyError(e, 'generic')`.

Export all three from `src/ui/index.ts`; add the three icons to `Icon.tsx`.

- [ ] **Step 4: Run tests and gates**

Run: `cd mobile && ./node_modules/.bin/jest && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/expo export --platform ios --output-dir dist/ios > /dev/null`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/ui mobile/package.json mobile/package-lock.json
git commit -m "AttachmentThumb, AttachmentPicker and AttachmentViewer primitives"
```

---

### Task 10: Hook points: bills, vault, avatar, cover

**Files:**
- Modify: `mobile/app/(app)/(tabs)/bills.tsx`, `mobile/app/(app)/(tabs)/vault.tsx`, `mobile/app/(app)/(tabs)/home.tsx`, `mobile/src/ui/Avatar.tsx`, `mobile/src/ui/AppHeader.tsx`

**Interfaces:**
- Consumes: Task 9 primitives, Task 8 `api.updateMe`/`api.updateHome`, `useFeatures`.

- [ ] **Step 1: Bills.** In the add sheet, after Notes: `<AttachmentPicker homeId={homeId!} kind="bill_receipt" allowPdf label="Add receipt" onUploaded={(a) => setAReceipt(a)} />` with state `aReceipt: Attachment | null`, shown as an `AttachmentThumb` with `onRemove` (deletes via `api.deleteAttachment` and clears) once uploaded; `createBill` sends `receipt_id: aReceipt?.id`. On the bill card, under the notes line: when `b.receipt`, an `AttachmentThumb size={56}` with `onExpired={() => invalidate()}`; the More sheet gains "Add receipt" / "Replace receipt" (picker) and "Remove receipt" (`updateBill(id, { receipt_id: null })`).

- [ ] **Step 2: Vault.** Add and edit sheets gain, below the Value input, a horizontal row of `AttachmentThumb`s for the pending documents plus an `AttachmentPicker kind="vault_document" allowPdf label="Add document"`; create/update send `attachment_ids`. Entry rows show their `attachments` as 56 pt thumbs in a horizontal `ScrollView` under the value.

- [ ] **Step 3: Avatar and cover.** `Avatar` gains an optional `uri` prop: when set, renders `Image` instead of the initial. `AppHeader` and the member rows pass `member.avatar?.url` / `user.avatar?.url`. Account card: tapping the avatar opens an `Alert` with "Change photo" (`AttachmentPicker` flow with `kind="avatar"`, then `api.updateMe({ avatar_id })`) and "Remove photo" (`avatar_id: null`), invalidating `['me']` and `['home', homeId]`. Home card: owners see a cover photo strip (120 pt, `Image` with `contentFit cover`, `radius.lg`) above the title with a `camera` `IconButton` "Change cover photo" → picker with `kind="home_cover"` → `api.updateHome(id, { cover_id })`, invalidating `['homes']` and `['home', id]`. Non-owners just see the photo. The `useHomeEvents` substring matcher already refreshes on `home_updated` and `member_updated` (`home` matches `['home', id]` and `['homes']`; add `member` → `['home', id]` in `events.ts` if not covered).

- [ ] **Step 4: Gates and the design grep**

Run: `cd mobile && grep -rnE "#[0-9A-Fa-f]{6}|fontFamily|from 'react-native'.*\b(Text|Pressable|Modal)\b" app | grep -v headerTitleStyle || echo clean; ./node_modules/.bin/jest --ci && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/expo export --platform ios --output-dir dist/ios > /dev/null`
Expected: clean; all green.

- [ ] **Step 5: Commit**

```bash
git add mobile
git commit -m "Receipts on bills, documents on vault entries, avatars and home cover photos"
```

---

### Task 11: Ops and docs

**Files:**
- Modify: `deploy/compose.prod.yml`, `DEPLOY.md`, `CLAUDE.md`, `backend/.env.example` (done in Task 1), `.github/workflows/api.yml` (done in Task 3)

- [ ] **Step 1: Production env.** In `deploy/compose.prod.yml` under the API `environment` add optional passthroughs (no `:?`, so a box without R2 still starts):

```yaml
      R2_ACCOUNT_ID: ${R2_ACCOUNT_ID:-}
      R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID:-}
      R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY:-}
      R2_BUCKET: ${R2_BUCKET:-}
```

Confirm `Storage::from_env` treats an empty string as unset: in Task 1's `from_env`, filter each `var` with `.filter(|v| !v.is_empty())` (add this now and re-run the storage unit tests).

- [ ] **Step 2: DEPLOY.md.** Add a section "Attachments (R2)": create bucket `homesy-attachments` (private, no public access, lifecycle rule: abort incomplete multipart after 1 day), create an R2 API token scoped to that bucket with Object Read & Write, store the token in 1Password, add the four variables to `~/homesy/.env`, `docker compose up -d homesy-api`, verify `curl https://homesy-api.gilla.fun/config` returns `{"attachments":true}`. Note the account id is not a secret but still lives in `.env`, not the repo.

- [ ] **Step 3: CLAUDE.md.** Under Backend architecture add two lines: attachments are presigned-URL based (`storage.rs`, `attachments.rs`), owners embed `AttachmentOut` with 10-minute URLs, and the four R2 variables are optional. Under Mobile: `AttachmentPicker`/`AttachmentThumb` are the only way to upload or show files; the `features` store gates them on `GET /config`. Under Commands: the MinIO service in `docker compose` and `S3_ENDPOINT=http://localhost:9000 cargo test` for the attachment tests.

- [ ] **Step 4: Commit**

```bash
git add deploy/compose.prod.yml DEPLOY.md CLAUDE.md backend/src/storage.rs
git commit -m "Docs and prod env wiring for R2 attachments"
```

---

### Task 12: Simulator pass, PR, review

- [ ] **Step 1: Ask the owner before starting the dev server** (port 8091, production API). For a real upload path the API needs R2 configured; until the owner creates the bucket, run the backend locally with MinIO (`cd backend && S3_ENDPOINT=http://localhost:9000 R2_ACCESS_KEY_ID=homesy R2_SECRET_ACCESS_KEY=homesyhomesy R2_BUCKET=homesy-test cargo run`) and point the app at it with `EXPO_PUBLIC_API_URL=http://localhost:8080`.
- [ ] **Step 2: Walk the flows** with screenshots: add a bill with a photo receipt, open it full screen, replace it, remove it; add a vault document (PDF) and open it; set and remove an avatar; set a cover photo as owner. Check Reduce Motion for the viewer fade and that upload buttons disappear when the backend runs without storage.
- [ ] **Step 3: Push `feat/attachments-r2`, open the PR**, watch the `api` (now with MinIO) and `mobile` checks.
- [ ] **Step 4: Fresh whole-branch review on the most capable model** per executing-plans; one fix pass; ask the owner before merging.
