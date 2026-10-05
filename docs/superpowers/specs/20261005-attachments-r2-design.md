# Attachments on Cloudflare R2 — design

Date: 2026-10-05. Status: approved in conversation, awaiting plan.

## Goal

One generic attachments layer so a home can store photos and documents: receipts on bills, documents on vault entries, member avatars, a home cover photo, and photos on love notes (a separate spec). Files live in a private Cloudflare R2 bucket owned by the operator; the API never serves bytes itself.

## Approach

Presigned S3 URLs issued by the Rust API. The phone uploads straight to R2 with a short-lived PUT URL and reads with short-lived GET URLs returned inline with the records that own them. Nothing is deployed on Cloudflare beyond the bucket. This was chosen over proxying uploads through the single API box (ties up the box and tunnel) and over a Worker in front of R2 (a second deployable to keep in sync); the Worker remains the upgrade path if serving ever gets heavy.

## Storage

- One private bucket, `homesy-attachments`. No public access; every read and write is a presigned URL.
- Object key: `{home_id}/{attachment_id}`. Listing or purging a home is a prefix operation.
- Credentials from the environment: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. They reach production through the box's `~/homesy/.env` and CI through GitHub secrets, exactly like `JWT_SECRET`; they are never committed. When any is unset, attachment endpoints return 503 `{ "error": "attachments disabled" }` and the app hides every upload affordance, so local development needs no bucket.
- The API uses the AWS SDK for Rust's S3 client pointed at `https://{account}.r2.cloudflarestorage.com` with path-style addressing and region `auto`.

## Data model

New table `attachments` (expand-only migration `0004_attachments.sql`):

| column | type | notes |
| --- | --- | --- |
| id | uuid | v7, primary key |
| home_id | uuid | FK homes; avatars use the uploader's current active home for scoping of the key only |
| uploaded_by | uuid | FK users |
| kind | text | `note_photo` \| `bill_receipt` \| `vault_document` \| `avatar` \| `home_cover` |
| content_type | text | validated on create |
| size_bytes | bigint | declared on create, confirmed on complete |
| status | text | `pending` \| `ready` |
| created_at | timestamptz | |

Owners gain nullable references, all added in the same migration: `household_bills.receipt_id`, `users.avatar_id`, `homes.cover_id`, `love_notes.photo_id` (created by the love-notes migration, which depends on this one), and a join table `vault_entry_attachments (entry_id, attachment_id, position)` because a document can have several pages. All FKs are `on delete set null` (or cascade for the join table) so deleting an attachment never fails.

## API

All routes require `AuthUser`; every handler resolves the owning home and calls `ensure_member`.

- `POST /homes/{id}/attachments` body `{ kind, content_type, size_bytes }`. Validates kind, content type (`image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`; PDFs only for `bill_receipt` and `vault_document`) and size (10 MiB images, 20 MiB PDFs). Inserts a `pending` row and returns `{ id, upload_url, expires_at }` where `upload_url` is a presigned PUT valid 15 minutes with the content type bound.
- `POST /attachments/{id}/complete`. Caller must be the uploader. `HEAD`s the object; 409 if missing or the size differs from the declared one; otherwise sets `ready` and returns the attachment with a `url`.
- `DELETE /attachments/{id}`. Deletes the object then the row. Allowed for the uploader or any owner of the home.
- Attaching is done through the owners' existing endpoints: `receipt_id` on bill create/PATCH, `avatar_id` on `PATCH /me` (new, minimal), `cover_id` on `PATCH /homes/{id}` (new, owners only), `attachment_ids` on vault create/PATCH, `photo_id` on love-note create. The handler checks the attachment is `ready`, belongs to the same home (or to the caller for avatars) and has the matching kind.
- Reads: every response that carries an attachment id also carries an `Attachment` object `{ id, kind, content_type, size_bytes, url, url_expires_at }` with a presigned GET valid 10 minutes, so the app never makes a second request. Lists of 50 bills therefore presign up to 50 URLs per request; presigning is local computation, no network call.
- Deleting a bill, vault entry or note deletes its attachments. Leaving the last home does not purge the home's objects (homes are never deleted today); a `purge-home` admin task is out of scope.
- Sweep: on startup and every 6 hours, delete `pending` rows older than 24 hours and their objects.
- Events: attaching goes through the owners' update paths, so the existing `bill_updated`, `vault_updated` and `member_updated` events cover refresh. No new event type.

Errors follow `AppError`: 400 for validation, 403 for membership, 404 unknown id, 409 complete-before-upload, 413 over size, 503 when storage is not configured.

## Mobile

- `src/api/attachments.ts`: `uploadAttachment(homeId, kind, file) → Attachment` does create → PUT (via `fetch` with the file blob; `expo-file-system` upload for large PDFs) → complete, with progress callbacks. Images are resized to a 2048 px long edge and HEIC converted to JPEG with `expo-image-manipulator` before upload. Pickers: `expo-image-picker` for photos, `expo-document-picker` for PDFs.
- `Attachment` type mirrors the Rust struct in `src/api/types.ts`; owners' types gain the optional field.
- `@/ui` gains `AttachmentThumb` (image or PDF tile, 72 pt, tap opens a full-screen viewer, long-press offers Remove) and `AttachmentPicker` (a dashed "Add photo / Add PDF" chip that runs the picker and shows upload progress). Both use tokens and Reduce Motion rules like every primitive.
- Expired URLs: `AttachmentThumb` treats an image load error as "refresh": it invalidates the owning query, which returns fresh URLs. No separate refresh endpoint.
- Hook points: add-bill sheet and bill card (receipt), vault add/edit sheets and entry row (documents), Home tab (cover photo on the home card for owners, avatar on the account card), love notes (photo).
- Feature gating: `GET /health` already exists; the app reads a new `GET /config` `{ attachments: boolean }` once per session and hides pickers when false.

## Security and privacy

- Private bucket, presigned URLs only, 10–15 minute lifetimes, one object each.
- Vault documents stay inside the operator's own R2 account, consistent with the vault rule of never sending values to a third-party service; URLs are never logged (the request logger redacts query strings on attachment hosts).
- Content type is bound into the PUT signature so a client cannot upload a different type than declared; the API also stores and serves `content_type` from its own row, never from client headers.
- Size is confirmed by `HEAD` on complete; oversize objects are deleted and the row removed.

## Testing

- Backend: integration tests run against MinIO in CI (service container; same S3 API), covering create → complete → read-with-url → delete, the member and uploader checks, size and type rejection, and the 503 path when env is unset. Presigning is unit-tested for URL shape and expiry.
- Mobile: unit tests for validation and the resize decision; a simulator pass for both pickers, the progress state, the full-screen viewer and Reduce Motion.

## Out of scope

Thumbnails generated server-side, image editing, sharing attachments outside the app, purging a home's objects, multiple buckets per environment (dev uses no bucket).
