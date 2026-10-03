# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Homesy is a shared-household app where the **home is the unit, not the user**. A user can belong to several homes (joined with a 6-char invite code, role `owner` | `member`), and every list, vault entry, bulletin notice, bill and activity record is scoped to exactly one home. Nothing crosses homes.

Two independent projects, no shared tooling or workspace at the root:

- `backend/`: Rust (edition 2021, MSRV 1.80), Axum 0.8, SQLx 0.8 (Postgres), JWT + Argon2. Crate name `homesy_api`.
- `mobile/`: Expo SDK 52, Expo Router 4 (typed routes), TanStack Query 5, Zustand 5, React Native 0.76 (new architecture).

## Commands

```bash
# Postgres 16 on :5432 (user/password/db all "homesy")
docker compose up -d

# Backend (from backend/)
cp .env.example .env       # DATABASE_URL, JWT_SECRET, PORT, RUST_LOG
cargo run                  # applies migrations on boot, listens on :8080
cargo test                 # unit + integration; integration needs the DB up
cargo test --lib                                          # unit tests only, no DB
cargo test --lib auth::tests::test_jwt_issuance_and_verification
cargo test --test api_integration_test test_sse_events_broadcast
cargo fmt --check && cargo clippy --all-targets -- -D warnings   # what CI enforces

# Mobile (from mobile/)
npm install
npx expo start             # set EXPO_PUBLIC_API_URL to the machine's LAN IP for a physical device
npm run typecheck          # tsc --noEmit; there is no lint or test setup on the mobile side
```

Integration tests (`backend/tests/api_integration_test.rs`) connect to `DATABASE_URL` or fall back to the local docker DB, run migrations, and drive the router in-process via `tower::ServiceExt::oneshot`. They write to that real database using unique emails and do not clean up, so do not point them at anything shared.

## Backend architecture

- `lib.rs::create_app` merges one `router()` per module in `src/routes/` onto a shared `AppState` (`PgPool`, JWT secret, `broadcast::Sender<HomeEvent>`). `main.rs` only loads env, connects, migrates, and serves. Tests call `create_app` directly.
- **Auth and authorisation:** the `AuthUser` extractor (`auth.rs`) validates `Authorization: Bearer <jwt>` (30-day HS256 tokens, `sub` = user id). Home scoping is enforced per handler by calling `ensure_member(pool, uid, home_id)`, which returns 403. Routes keyed by a child id (`/items/{id}`, `/vault/{id}`, `/bills/{id}`, …) first resolve the owning `home_id` through a join (see `list_home` / `item_home` in `routes/lists.rs`) and then call `ensure_member`. Any new endpoint must follow this pattern; there is no middleware doing it for you.
- **Errors:** handlers return `AppResult<T>`. `AppError` maps to `{ "error": "..." }` JSON with the right status, `sqlx::Error::RowNotFound` becomes 404, and other DB errors are logged and returned as an opaque 500.
- **SQL:** raw runtime queries (`sqlx::query_as` with `FromRow` structs in `models.rs`), not the compile-time `query!` macros, so building does not need a live DB or `.sqlx` offline data. Column lists are kept in `*_COLS` constants per module. IDs are `Uuid::now_v7()` generated in Rust.
- **Migrations:** `backend/migrations/NNNN_name.sql`, embedded with `sqlx::migrate!` and applied at startup (and by the integration tests). Add a new numbered file; never edit an applied one, because SQLx checksums them.
- **Realtime:** every mutating handler does two things after writing: `state.broadcast(HomeEvent { home_id, event_type, payload })` (event names such as `item_created`, `vault_updated`, `bill_paid`, `member_joined`), and `activity::log_activity(...)`, which inserts an `activities` row and broadcasts `activity_created`. `GET /homes/{id}/events` is an SSE stream over the single process-wide broadcast channel, filtered by `home_id`. Each event's data is the payload object with `type` and `resource` set to the event name. This is in-memory only, so it does not fan out across multiple backend instances.
- New homes get three default lists (Groceries, Laundry, To-do) inside the create transaction. The last owner cannot leave a home.
- **Bills:** `billing_period` is required on create and new-cycle. `due_date` is a SQL `date`, so it must be `YYYY-MM-DD` or the JSON extractor rejects the whole body with a plain-text 422. `POST /bills/{id}/pay` takes an optional `paid_by`, which defaults to the caller and must be a home member. `new-cycle` resets a bill to unpaid for the next period. The PATCH handlers merge with `Option::or(existing)`, so a null or empty field keeps the old value and cannot clear it.
- The vault's `is_secret` only controls masking in the UI. Values are stored in plaintext.
- **CORS** is permissive unless `CORS_ORIGINS` is set (comma-separated `scheme://host[:port]`, validated at startup). Production sets it to the web app origin.
- **Deployment:** merging backend changes to `main` tests, builds an arm64 image, and deploys it to `https://api.homesy.gilla.fun` (see `DEPLOY.md`). The API runs as a single instance, which the in-process SSE broadcast requires. `/health` pings the database and returns 503 within about 2 s when it is down.

## Mobile architecture

- **Routing (`mobile/app/`):** the root `_layout.tsx` hydrates the session and active-home stores from SecureStore and redirects between `(auth)` and `(app)` based on the token. `(app)/_layout.tsx` fetches `['homes']`, renders the Home tab as onboarding when the user has no homes, and mounts `useHomeEvents(activeHomeId)`. The tabs are `index` (lists), `bills`, `vault`, `activity`, and `home`.
- **API:** `src/api/client.ts` is the single typed `api` object. It reads the token from the Zustand session store, any 401 triggers `signOut()`, and plain-text error bodies (Axum rejections) are surfaced as the error message. Response types live in `src/api/types.ts`, mirrored by hand from `backend/src/models.rs` (see below). The import alias is `@/*` → `src/*`.
- **State:** server state lives in TanStack Query, persisted to AsyncStorage (`HOMESY_QUERY_CACHE`, 24h). Query keys are scoped by home: `['lists', homeId]`, `['items', listId]`, `['vault', homeId]`, `['bills', homeId]`, `['bulletin', homeId]`, `['activity', homeId]`, `['home', homeId]`, `['homes']`. Client state is in Zustand: `store/session.ts` holds the token and user, `store/home.ts` holds the active home id, and both are persisted in SecureStore.
- **Realtime sync (`src/api/events.ts`):** React Native has no `EventSource`, so SSE is read through `XMLHttpRequest` progress events with manual line parsing and exponential-backoff reconnects. Events are never applied to the cache directly. The hook only invalidates query keys by substring-matching the event name (`bill`, `vault`, `item`, …). A new backend event type needs a matching name or a branch here, or screens will not refresh.

## Conventions and gotchas

- When changing a request or response shape, update all three: the Rust struct (`models.rs` or the route module), `mobile/src/api/types.ts`, and the payload type in `mobile/src/api/client.ts`. `npm run typecheck` then flags each screen that uses the old shape.
- Never send vault values to a third-party service. The Wi-Fi QR in `vault.tsx` is rendered on-device with `react-native-qrcode-svg` for this reason.
- There is no `expenses` feature. Migration `0003_bills.sql` dropped it in favour of `household_bills`.
- Migrations must be expand-only (add tables, nullable columns, and indexes; renames and drops go in a later release). Rolling back to the previous image must keep working against the new schema.
- This repo is treated as public. Never commit host addresses, SSH users, tunnel IDs or tokens, or `.env` values. Production secrets live only in the host's `~/homesy/.env` and in GitHub secrets.
