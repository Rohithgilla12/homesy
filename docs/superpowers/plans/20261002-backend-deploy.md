# Backend Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the Homesy API at `https://api.homesy.gilla.fun` from the shared arm64 host. Every push to `main` that touches `backend/` should be tested, built, deployed, and smoke-tested automatically.

**Architecture:** The API gets four small changes: configurable CORS, a `/health` that pings the DB, graceful shutdown, and a Dockerfile. GitHub Actions tests on x64, builds a native arm64 image on `ubuntu-24.04-arm`, pushes it to GHCR, then SSHes to the host with a key restricted to one forced command. That command runs `deploy.sh`, which takes a pre-deploy `pg_dump` and then runs `docker compose pull && up -d`. A compose project on the host runs Postgres, the API, and a dedicated Cloudflare Tunnel connector. Nothing listens on a host port.

**Tech Stack:** Rust (Axum 0.8, SQLx 0.8, tower-http 0.6), Docker (cargo-chef, distroless), Docker Compose, GitHub Actions, GHCR, Cloudflare Tunnel (`cloudflared`), `gh` CLI, Gatus.

**Spec:** `docs/superpowers/specs/20261002-backend-deploy-design.md`

## Global Constraints

- **The repo is treated as public.** Never commit the host address, SSH user, tunnel ID, tunnel token, `.env` values, or the `authorized_keys` line. Commands in this plan refer to the host as `$HOMESY_SSH`, which is set in the shell from the operator notes (Task 9), never from the repo.
- Run `gitleaks protect --staged --no-banner` before every commit. It must report `no leaks found`.
- Generate secrets on the host with `openssl rand -hex 32`. Never print them; only key names may appear in output.
- The API must not compile on the host. The host only pulls images.
- Container and service names: `homesy-postgres`, `homesy-api`, `homesy-cloudflared`. Network: `homesy-internal`. Volume: `homesy-pgdata`. Compose project: `homesy`.
- Postgres image: `postgres:16-alpine`. API image: `ghcr.io/rohithgilla12/homesy-api`, tagged `:<short-sha>` and `:latest`.
- API limits: `cpus: 1.0`, `mem_limit: 512m`. Logging on every service: `json-file`, `max-size: 10m`, `max-file: 3`.
- `homesy-api` and `homesy-postgres` carry the label `com.centurylinklabs.watchtower.enable=false`.
- Production env: `CORS_ORIGINS=https://app.homesy.gilla.fun` and `RUST_LOG=homesy_api=info,tower_http=info`.
- Keep the last 5 pre-deploy backups.
- **Migrations are expand-only.** Add tables, nullable columns, and indexes; renames and drops ship in a later release.
- No `// ====` banner comments. Match the surrounding comment density.
- Ask the owner before every state-changing step on the host, in Cloudflare, or on GitHub (Tasks 9–15). Ask before running the dev server.

**Deviations from the spec, decided while planning:**

1. `deploy.sh` runs `docker compose up -d` for the whole stack, not only `homesy-api`. That way the first deploy also starts the tunnel, and the smoke test can pass. Services whose definition is unchanged are not recreated.
2. `deploy.sh` warns when `.env` pins `HOMESY_IMAGE` to anything other than `:latest`, because such a deploy silently does nothing.
3. The builder base image is `lukemathwalker/cargo-chef:latest-rust-1-bookworm`, which is `rust:1-bookworm` with cargo-chef preinstalled.
4. Cloudflare's free plan only allows a 10-second counting period for rate limiting. On free, the rule is **5 requests per 10 s per IP, block for 10 s**. If `gilla.fun` is on a paid plan, use the spec's 10 requests per 60 s.
5. Environments with secrets need a paid GitHub plan on private repos. If creating the `production` environment fails, use repo-level secrets and remove the `environment:` block from the `deploy` job.

## Review Focus

1. **`CORS_ORIGINS` with a trailing slash or no scheme** (for example `https://app.homesy.gilla.fun/`). The API must refuse to start with a clear error, not boot and silently block the web app. Pinned by tests in Task 2.
2. **A browser preflight for `PATCH`/`DELETE` with an `Authorization` header from the allowed origin.** It must succeed, because the web app edits items and vault entries this way. Pinned by an integration test in Task 2.
3. **The database is unreachable or hangs.** `/health` must answer `503` within seconds, not hang until the 30-second pool timeout, so CI and Gatus report it correctly. Pinned by an integration test in Task 3.
4. **`pg_dump` fails during a deploy.** The deploy must abort before touching containers. It must leave no truncated backup that would rotate a good one out. Pinned by `deploy/test_deploy.sh` in Task 6.
5. **`HOMESY_IMAGE` is left pinned after a rollback.** The deploy must say so loudly instead of reporting success while running an old image. Pinned by `deploy/test_deploy.sh` in Task 6.

---

### Task 1: Create the branch and apply rustfmt

CI enforces `cargo fmt --check`, and the backend currently has formatting drift. This task makes no behaviour change.

**Files:**
- Modify: every `backend/**/*.rs` file that `cargo fmt` rewrites

**Interfaces:**
- Consumes: nothing
- Produces: a branch `feat/backend-deploy` where `cargo fmt --check` passes

- [ ] **Step 1: Create the branch**

```bash
cd /Users/rohithgilla/github.com/Rohithgilla12/homesy
git switch -c feat/backend-deploy
```

- [ ] **Step 2: Confirm formatting fails before the change**

Run: `cd backend && cargo fmt --check > /dev/null; echo "exit=$?"`
Expected: `exit=1`

- [ ] **Step 3: Format**

Run: `cd backend && cargo fmt`

- [ ] **Step 4: Verify formatting, lints, and tests**

The local DB must be up (`docker compose up -d` from the repo root).

```bash
cd backend && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Expected: no fmt output, clippy finishes with no warnings, and every `test result: ok.` line (3 unit tests and 3 integration tests).

- [ ] **Step 5: Commit**

```bash
git add backend
gitleaks protect --staged --no-banner
git commit -m "Apply rustfmt to backend

No behaviour change; CI will enforce cargo fmt --check."
```

---

### Task 2: Configurable CORS

**Files:**
- Modify: `backend/src/config.rs` (whole file)
- Modify: `backend/src/lib.rs` (whole file)
- Modify: `backend/src/main.rs` (the `create_app` call)
- Test: `backend/src/config.rs` (unit tests), `backend/tests/api_integration_test.rs` (CORS tests, plus updated `create_app` calls)

**Interfaces:**
- Consumes: `state::AppState::new(pool: PgPool, jwt_secret: String) -> AppState` (existing)
- Produces:
  - `config::Config { database_url: String, jwt_secret: String, port: u16, cors_origins: Option<Vec<String>> }`
  - `config::parse_origins(raw: &str) -> anyhow::Result<Vec<String>>`
  - `homesy_api::create_app(state: AppState, cors_origins: Option<&[String]>) -> Router`. `None` means permissive, for local development.

- [ ] **Step 1: Write failing unit tests for origin parsing**

Append to `backend/src/config.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::parse_origins;

    #[test]
    fn parses_and_trims_a_comma_separated_list() {
        let origins = parse_origins(" https://app.homesy.gilla.fun , http://localhost:8081 ").unwrap();
        assert_eq!(origins, vec!["https://app.homesy.gilla.fun", "http://localhost:8081"]);
    }

    #[test]
    fn rejects_a_trailing_slash() {
        // Browsers never send a trailing slash in Origin, so this entry would silently match nothing.
        assert!(parse_origins("https://app.homesy.gilla.fun/").is_err());
    }

    #[test]
    fn rejects_a_missing_scheme() {
        assert!(parse_origins("app.homesy.gilla.fun").is_err());
    }

    #[test]
    fn rejects_a_list_with_no_origins() {
        assert!(parse_origins(" , ").is_err());
    }
}
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `cd backend && cargo test --lib config::tests`
Expected: compile error `cannot find function 'parse_origins'`.

- [ ] **Step 3: Implement `Config.cors_origins` and `parse_origins`**

Replace everything above the `#[cfg(test)]` module in `backend/src/config.rs` with:

```rust
use anyhow::{bail, Context};
use axum::http::HeaderValue;

pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub port: u16,
    /// Browser origins allowed by CORS. `None` allows any origin, for local development.
    pub cors_origins: Option<Vec<String>>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            jwt_secret: std::env::var("JWT_SECRET").context("JWT_SECRET not set")?,
            port: std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            cors_origins: std::env::var("CORS_ORIGINS")
                .ok()
                .map(|raw| parse_origins(&raw))
                .transpose()?,
        })
    }
}

/// Parses a comma-separated `CORS_ORIGINS` value, rejecting entries a browser would never send
/// as `Origin` (no scheme, a path, a trailing slash). Those would otherwise silently block the web app.
pub fn parse_origins(raw: &str) -> anyhow::Result<Vec<String>> {
    let origins: Vec<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|o| !o.is_empty())
        .map(String::from)
        .collect();
    if origins.is_empty() {
        bail!("CORS_ORIGINS is set but lists no origins");
    }
    for origin in &origins {
        let host = origin
            .strip_prefix("https://")
            .or_else(|| origin.strip_prefix("http://"))
            .with_context(|| format!("CORS origin {origin:?} must start with http:// or https://"))?;
        if host.is_empty() || host.contains('/') {
            bail!("CORS origin {origin:?} must be scheme://host[:port], with no path or trailing slash");
        }
        HeaderValue::from_str(origin).with_context(|| format!("CORS origin {origin:?} is not a valid header value"))?;
    }
    Ok(origins)
}
```

- [ ] **Step 4: Run the unit tests to confirm they pass**

Run: `cd backend && cargo test --lib config::tests`
Expected: `test result: ok. 4 passed`

- [ ] **Step 5: Write failing CORS integration tests**

In `backend/tests/api_integration_test.rs`:

1. Change every `create_app(state)` call to `create_app(state, None)`. There are three, one in each existing test.
2. Append:

```rust
/// State whose pool never connects. Enough for routes that do not touch the database.
fn unconnected_state() -> AppState {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://homesy:homesy@127.0.0.1:1/homesy")
        .unwrap();
    AppState::new(pool, "test-jwt-secret-for-api-tests-123".into())
}

fn preflight(origin: &str, method: &str) -> Request<Body> {
    Request::builder()
        .method("OPTIONS")
        .uri("/items/00000000-0000-0000-0000-000000000000")
        .header(header::ORIGIN, origin)
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, method)
        .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type")
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn test_cors_allows_preflight_from_listed_origin() {
    let origins = vec!["https://app.homesy.gilla.fun".to_string()];
    let app = create_app(unconnected_state(), Some(&origins));

    for method in ["PATCH", "DELETE"] {
        let res = app.clone().oneshot(preflight("https://app.homesy.gilla.fun", method)).await.unwrap();
        let headers = res.headers();
        assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "https://app.homesy.gilla.fun");
        assert!(headers[header::ACCESS_CONTROL_ALLOW_METHODS].to_str().unwrap().contains(method));
        let allowed = headers[header::ACCESS_CONTROL_ALLOW_HEADERS].to_str().unwrap().to_lowercase();
        assert!(allowed.contains("authorization") && allowed.contains("content-type"));
    }
}

#[tokio::test]
async fn test_cors_rejects_unlisted_origin() {
    let origins = vec!["https://app.homesy.gilla.fun".to_string()];
    let app = create_app(unconnected_state(), Some(&origins));

    let res = app.oneshot(preflight("https://evil.example", "PATCH")).await.unwrap();
    assert!(res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
}
```

- [ ] **Step 6: Run them to confirm they fail**

Run: `cd backend && cargo test --test api_integration_test test_cors`
Expected: compile error, because `create_app` takes 1 argument but 2 were supplied.

- [ ] **Step 7: Implement the CORS layer and the new `create_app` signature**

Replace `backend/src/lib.rs` with:

```rust
pub mod activity;
pub mod auth;
pub mod config;
pub mod error;
pub mod models;
pub mod routes;
pub mod state;

use axum::{
    http::{header, HeaderValue, Method},
    routing::get,
    Router,
};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};

/// Builds the router. `cors_origins` comes from `CORS_ORIGINS`; `None` allows any origin (local development).
pub fn create_app(state: state::AppState, cors_origins: Option<&[String]>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(routes::auth::router())
        .merge(routes::homes::router())
        .merge(routes::lists::router())
        .merge(routes::vault::router())
        .merge(routes::bulletin::router())
        .merge(routes::bills::router())
        .layer(cors_layer(cors_origins))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

fn cors_layer(origins: Option<&[String]>) -> CorsLayer {
    let Some(origins) = origins else {
        return CorsLayer::permissive();
    };
    let origins = origins
        .iter()
        .map(|o| HeaderValue::from_str(o).expect("origins are validated by config::parse_origins"));
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}
```

In `backend/src/main.rs`, change `let app = create_app(state);` to:

```rust
    let app = create_app(state, cfg.cors_origins.as_deref());
```

- [ ] **Step 8: Run all backend tests**

Run: `cd backend && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: everything passes, including the 4 new `config::tests` and the 2 new `test_cors_*` tests.

- [ ] **Step 9: Commit**

```bash
git add backend/src/config.rs backend/src/lib.rs backend/src/main.rs backend/tests/api_integration_test.rs
gitleaks protect --staged --no-banner
git commit -m "Make CORS origins configurable via CORS_ORIGINS

Unset keeps the permissive layer for local development. Invalid entries
(trailing slash, missing scheme) fail at startup instead of silently
blocking the web app."
```

---

### Task 3: `/health` checks the database

**Files:**
- Modify: `backend/src/error.rs` (add `Unavailable`)
- Modify: `backend/src/lib.rs` (health handler)
- Test: `backend/tests/api_integration_test.rs`

**Interfaces:**
- Consumes: `create_app(state, cors_origins)` and `unconnected_state()` from Task 2
- Produces: `GET /health` returns `200 "ok"`, or `503 {"error":"database unavailable"}` within about 2 s. Adds `error::AppError::Unavailable`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api_integration_test.rs`:

```rust
#[tokio::test]
async fn test_health_reports_unreachable_database_promptly() {
    let app = create_app(unconnected_state(), None);
    let started = std::time::Instant::now();

    let res = app
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(started.elapsed() < std::time::Duration::from_secs(5), "health must not wait for the pool timeout");
    let body = parse_json_response(res.into_body()).await;
    assert_eq!(body["error"], "database unavailable");
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && cargo test --test api_integration_test test_health_reports_unreachable_database_promptly`
Expected: FAIL. The assertion `left: 200, right: 503` fails because `/health` currently always returns `ok`.

- [ ] **Step 3: Add the error variant**

In `backend/src/error.rs`, add to `enum AppError` after `Conflict(String),`:

```rust
    #[error("database unavailable")]
    Unavailable,
```

and add to the `match` in `into_response`, after the `Conflict` arm:

```rust
            AppError::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
```

- [ ] **Step 4: Implement the health handler**

In `backend/src/lib.rs`:

1. Add the imports `axum::extract::State`, `std::time::Duration`, and `error::{AppError, AppResult}`.
2. Change the route to `.route("/health", get(health))`.
3. Add:

```rust
/// Liveness plus a DB ping, bounded so a hung database fails fast instead of waiting out the pool timeout.
async fn health(State(s): State<state::AppState>) -> AppResult<&'static str> {
    match tokio::time::timeout(Duration::from_secs(2), sqlx::query("select 1").execute(&s.pool)).await {
        Ok(Ok(_)) => Ok("ok"),
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "health check: database unavailable");
            Err(AppError::Unavailable)
        }
        Err(_) => {
            tracing::warn!("health check: database ping timed out");
            Err(AppError::Unavailable)
        }
    }
}
```

The import block becomes:

```rust
use axum::{
    extract::State,
    http::{header, HeaderValue, Method},
    routing::get,
    Router,
};
use error::{AppError, AppResult};
use std::time::Duration;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
```

- [ ] **Step 5: Run all backend tests**

Run: `cd backend && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: all pass. `test_full_api_flow` still sees `/health` return 200 against the live DB.

- [ ] **Step 6: Commit**

```bash
git add backend/src/error.rs backend/src/lib.rs backend/tests/api_integration_test.rs
gitleaks protect --staged --no-banner
git commit -m "Make /health ping the database

Returns 503 within ~2s when the database is down or hung, so the CI smoke
test and uptime checks catch a dead DB."
```

---

### Task 4: Graceful shutdown

**Files:**
- Modify: `backend/src/main.rs`

**Interfaces:**
- Consumes: `create_app` from Task 2
- Produces: the process exits cleanly on SIGTERM and Ctrl-C after draining connections. `docker stop` sends SIGTERM.

- [ ] **Step 1: Implement**

In `backend/src/main.rs`, replace `axum::serve(listener, app).await?;` with:

```rust
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
```

and add at the end of the file:

```rust
/// Resolves on Ctrl-C or SIGTERM (what `docker stop` sends). Open SSE streams keep the server
/// draining until Docker's stop grace period ends; clients reconnect on their own.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("install Ctrl-C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received, draining connections");
}
```

- [ ] **Step 2: Verify manually**

This starts the API binary on a scratch port, not the dev server. Ask the owner first, per their instruction about dev servers.

```bash
cd backend && cargo build && (PORT=18081 ./target/debug/homesy-api & echo $! > /tmp/homesy-api.pid) && sleep 3 \
  && curl -fsS localhost:18081/health && kill -TERM "$(cat /tmp/homesy-api.pid)" && sleep 1 \
  && (kill -0 "$(cat /tmp/homesy-api.pid)" 2>/dev/null && echo STILL-RUNNING || echo EXITED)
```

Expected: `ok`, then the log line `shutdown signal received, draining connections`, then `EXITED`.

- [ ] **Step 3: Run checks and commit**

```bash
cd backend && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd .. && git add backend/src/main.rs
gitleaks protect --staged --no-banner
git commit -m "Shut down gracefully on SIGTERM and Ctrl-C"
```

---

### Task 5: Container image

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`

**Interfaces:**
- Consumes: the `homesy-api` binary (package name in `backend/Cargo.toml`)
- Produces: an image that runs `/app/homesy-api` as a non-root user on port 8080, configured only through env (`DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGINS`, `RUST_LOG`)

- [ ] **Step 1: Write `backend/.dockerignore`**

```
target/
tests/
.env
.env.*
!.env.example
```

- [ ] **Step 2: Write `backend/Dockerfile`**

```dockerfile
# Builds a static-ish homesy-api binary and ships it on distroless. cargo-chef caches the dependency
# layer separately so source-only changes rebuild fast. Migrations are embedded by sqlx::migrate!.
FROM lukemathwalker/cargo-chef:latest-rust-1-bookworm AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release --bin homesy-api

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /app/target/release/homesy-api /app/homesy-api
EXPOSE 8080
ENTRYPOINT ["/app/homesy-api"]
```

- [ ] **Step 3: Build locally**

The Mac is arm64, so this produces the same architecture as the host.

Run: `docker build -t homesy-api:local backend`
Expected: build succeeds, and `docker image inspect homesy-api:local --format '{{.Architecture}} {{.Size}}'` prints `arm64` and a size under about 60 MB.

- [ ] **Step 4: Smoke-test the image against the local DB**

The local DB must be up (`docker compose up -d`).

```bash
docker run -d --name homesy-api-smoke -p 18080:8080 \
  -e DATABASE_URL=postgres://homesy:homesy@host.docker.internal:5432/homesy \
  -e JWT_SECRET=local-smoke-secret -e CORS_ORIGINS=https://app.homesy.gilla.fun \
  homesy-api:local
sleep 3 && curl -fsS localhost:18080/health && echo
time docker stop homesy-api-smoke && docker logs homesy-api-smoke 2>&1 | tail -3
docker rm homesy-api-smoke
```

Expected:
- `ok`
- `docker stop` returns in about 1 s, well under the 10 s kill timeout
- the log ends with `shutdown signal received, draining connections`

- [ ] **Step 5: Verify the image fails fast on a bad `CORS_ORIGINS`**

```bash
docker run --rm -e DATABASE_URL=postgres://x@127.0.0.1:1/x -e JWT_SECRET=x \
  -e CORS_ORIGINS=https://app.homesy.gilla.fun/ homesy-api:local; echo "exit=$?"
```

Expected: an error mentioning `no path or trailing slash`, and `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore
gitleaks protect --staged --no-banner
git commit -m "Add multi-stage Dockerfile for homesy-api

cargo-chef dependency caching, distroless nonroot runtime."
```

---

### Task 6: Production compose, tunnel ingress, and deploy script

**Files:**
- Create: `deploy/compose.prod.yml` (installed on the host as `~/homesy/compose.yml`)
- Create: `deploy/cloudflared.yml` (installed as `~/homesy/cloudflared.yml`)
- Create: `deploy/deploy.sh` (installed as `~/homesy/deploy.sh`)
- Test: `deploy/test_deploy.sh`

**Interfaces:**
- Consumes: the image from Task 5. Host `.env` keys: `POSTGRES_PASSWORD`, `JWT_SECRET`, `CORS_ORIGINS`, `RUST_LOG`, `HOMESY_IMAGE`, `TUNNEL_TOKEN`.
- Produces: `deploy.sh` (no arguments, reads no client input) does a pre-deploy backup, then `compose pull homesy-api`, then `compose up -d`, then prints the running image. Exit code is non-zero on any failure.

- [ ] **Step 1: Write the failing deploy-script test**

Create `deploy/test_deploy.sh`:

```bash
#!/usr/bin/env bash
# Tests deploy.sh against a stub `docker`. Runs inside Linux to match the host:
#   docker run --rm -v "$PWD/deploy:/deploy:ro" debian:bookworm-slim bash /deploy/test_deploy.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fail() { echo "FAIL: $*" >&2; exit 1; }

# Fresh copy of deploy.sh in a temp dir, with a stub docker on PATH that logs every call.
setup() {
  work=$(mktemp -d)
  cp "$here/deploy.sh" "$work/deploy.sh"
  mkdir -p "$work/bin" "$work/backups"
  : > "$work/calls"
  cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_CALLS"
if [ "$1" = inspect ] && [[ "$*" == *State.Running* ]]; then echo "${STUB_PG_RUNNING:-true}"; exit 0; fi
if [ "$1" = exec ]; then [ "${STUB_DUMP_FAILS:-0}" = 1 ] && exit 1; echo "-- dump"; exit 0; fi
exit 0
STUB
  chmod +x "$work/bin/docker"
  export PATH="$work/bin:$PATH" STUB_CALLS="$work/calls"
  unset STUB_PG_RUNNING STUB_DUMP_FAILS
}

old_backups() {
  for i in 1 2 3 4 5 6 7; do
    touch -d "2026-01-0$i" "$work/backups/predeploy-2026010${i}T000000Z.sql.gz"
  done
}

test_backs_up_rotates_and_deploys() {
  setup; old_backups
  "$work/deploy.sh" > "$work/out" 2>&1 || fail "deploy exited non-zero: $(cat "$work/out")"
  [ "$(ls "$work"/backups/predeploy-*.sql.gz | wc -l)" -eq 5 ] || fail "expected 5 backups kept"
  [ ! -e "$work/backups/predeploy-20260101T000000Z.sql.gz" ] || fail "oldest backup not rotated out"
  grep -q '^compose pull homesy-api$' "$work/calls" || fail "no compose pull"
  grep -q '^compose up -d$' "$work/calls" || fail "no compose up"
}

test_failed_dump_aborts_before_touching_containers() {
  setup; old_backups; export STUB_DUMP_FAILS=1
  if "$work/deploy.sh" > "$work/out" 2>&1; then fail "deploy succeeded despite failed dump"; fi
  [ "$(ls "$work"/backups/predeploy-*.sql.gz | wc -l)" -eq 7 ] || fail "existing backups were touched"
  ! ls -a "$work/backups" | grep -q partial || fail "partial dump left behind"
  ! grep -q '^compose' "$work/calls" || fail "compose ran after a failed dump"
}

test_first_deploy_skips_backup() {
  setup; export STUB_PG_RUNNING=false
  "$work/deploy.sh" > "$work/out" 2>&1 || fail "first deploy failed: $(cat "$work/out")"
  [ -z "$(ls "$work/backups")" ] || fail "backup taken with no running database"
  grep -q '^compose up -d$' "$work/calls" || fail "no compose up on first deploy"
}

test_warns_when_image_is_pinned() {
  setup; echo "HOMESY_IMAGE=ghcr.io/rohithgilla12/homesy-api:abc1234" > "$work/.env"
  "$work/deploy.sh" > "$work/out" 2>&1 || fail "deploy failed: $(cat "$work/out")"
  grep -q 'WARNING: .env pins HOMESY_IMAGE' "$work/out" || fail "no warning for pinned image"
}

test_no_warning_for_latest() {
  setup; echo "HOMESY_IMAGE=ghcr.io/rohithgilla12/homesy-api:latest" > "$work/.env"
  "$work/deploy.sh" > "$work/out" 2>&1 || fail "deploy failed"
  ! grep -q WARNING "$work/out" || fail "warned for :latest"
}

for t in test_backs_up_rotates_and_deploys test_failed_dump_aborts_before_touching_containers \
         test_first_deploy_skips_backup test_warns_when_image_is_pinned test_no_warning_for_latest; do
  ( "$t" ) && echo "ok   $t" || { echo "FAIL $t"; exit 1; }
done
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `docker run --rm -v "$PWD/deploy:/deploy:ro" debian:bookworm-slim bash /deploy/test_deploy.sh`
Expected: `FAIL test_backs_up_rotates_and_deploys`, because `deploy.sh` does not exist yet.

- [ ] **Step 3: Write `deploy/deploy.sh`**

```bash
#!/usr/bin/env bash
# Deploys the newest homesy-api image. Installed on the host as ~/homesy/deploy.sh and pinned as the
# forced command of the CI deploy key, so it must never read $SSH_ORIGINAL_COMMAND or other client input.
set -euo pipefail
cd "$(dirname "$0")"

keep=5
mkdir -p backups
trap 'rm -f backups/.predeploy-*.partial' EXIT

if grep -Eq '^HOMESY_IMAGE=.+' .env 2>/dev/null && ! grep -Eq '^HOMESY_IMAGE=.*:latest$' .env; then
  echo "WARNING: .env pins HOMESY_IMAGE to a fixed tag; this deploy will not pick up the new :latest image" >&2
fi

if [ "$(docker inspect -f '{{.State.Running}}' homesy-postgres 2>/dev/null || true)" = "true" ]; then
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  partial="backups/.predeploy-$ts.partial"
  docker exec homesy-postgres pg_dump -U homesy homesy | gzip > "$partial"
  mv "$partial" "backups/predeploy-$ts.sql.gz"
  ls -1t backups/predeploy-*.sql.gz | tail -n +$((keep + 1)) | xargs -r rm --
  echo "pre-deploy backup: backups/predeploy-$ts.sql.gz"
fi

docker compose pull homesy-api
docker compose up -d
docker inspect -f 'running {{.Config.Image}} ({{.Image}})' homesy-api
```

Run: `chmod +x deploy/deploy.sh deploy/test_deploy.sh`

- [ ] **Step 4: Run the tests and shellcheck**

```bash
docker run --rm -v "$PWD/deploy:/deploy:ro" debian:bookworm-slim bash /deploy/test_deploy.sh
docker run --rm -v "$PWD/deploy:/mnt:ro" koalaman/shellcheck:stable -S warning /mnt/deploy.sh /mnt/test_deploy.sh
```

Expected: five `ok   test_*` lines, and shellcheck prints nothing. `-S warning` skips info-level notes such as SC2012 on `ls | xargs`, which do not apply because both scripts only list `predeploy-<UTC timestamp>.sql.gz` names they create.

- [ ] **Step 5: Write `deploy/cloudflared.yml`**

```yaml
# Ingress for the homesy tunnel. The tunnel itself is identified by TUNNEL_TOKEN, which lives only in the host .env.
ingress:
  - hostname: api.homesy.gilla.fun
    service: http://homesy-api:8080
  - service: http_status:404
```

Validate:

```bash
cloudflared tunnel --config deploy/cloudflared.yml ingress validate
cloudflared tunnel --config deploy/cloudflared.yml ingress rule https://api.homesy.gilla.fun/health
```

Expected: `OK`, then `Matched rule #0` showing `service: http://homesy-api:8080`.

- [ ] **Step 6: Write `deploy/compose.prod.yml`**

```yaml
# Production stack on the host, installed as ~/homesy/compose.yml next to .env, cloudflared.yml and deploy.sh.
# All values come from ~/homesy/.env (host-only). Required ones fail the deploy when missing instead of failing open.
name: homesy

x-logging: &logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

services:
  homesy-postgres:
    image: postgres:16-alpine
    container_name: homesy-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: homesy
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: homesy
    volumes:
      - homesy-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U homesy -d homesy"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    labels:
      com.centurylinklabs.watchtower.enable: "false"
    logging: *logging
    networks: [homesy-internal]

  homesy-api:
    # Keep HOMESY_IMAGE at :latest; pin a :<sha> only while rolling back (see DEPLOY.md).
    image: ${HOMESY_IMAGE:-ghcr.io/rohithgilla12/homesy-api:latest}
    container_name: homesy-api
    restart: unless-stopped
    depends_on:
      homesy-postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://homesy:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}@homesy-postgres:5432/homesy
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      PORT: "8080"
      CORS_ORIGINS: ${CORS_ORIGINS:?CORS_ORIGINS is required}
      RUST_LOG: ${RUST_LOG:-homesy_api=info,tower_http=info}
    cpus: 1.0
    mem_limit: 512m
    stop_grace_period: 10s
    labels:
      com.centurylinklabs.watchtower.enable: "false"
    logging: *logging
    networks: [homesy-internal]

  homesy-cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: homesy-cloudflared
    restart: unless-stopped
    depends_on: [homesy-api]
    command: tunnel --no-autoupdate --config /etc/cloudflared/config.yml run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?TUNNEL_TOKEN is required}
    volumes:
      - ./cloudflared.yml:/etc/cloudflared/config.yml:ro
    logging: *logging
    networks: [homesy-internal]

volumes:
  homesy-pgdata:
    name: homesy-pgdata

networks:
  homesy-internal:
    name: homesy-internal
```

- [ ] **Step 7: Verify that required variables fail closed**

```bash
SMOKE=$(mktemp -d)
cp deploy/compose.prod.yml "$SMOKE/compose.yml"; cp deploy/cloudflared.yml "$SMOKE/"
printf 'POSTGRES_PASSWORD=x\nJWT_SECRET=x\nTUNNEL_TOKEN=x\n' > "$SMOKE/.env"
(cd "$SMOKE" && docker compose -p homesy-smoke config > /dev/null); echo "exit=$?"
```

Expected: an error containing `CORS_ORIGINS is required`, and `exit=1`.

- [ ] **Step 8: Run the stack locally with the local image**

`-p homesy-smoke` is mandatory. The local dev compose project is also named `homesy`, and reusing that name would tear down the dev database.

```bash
printf 'POSTGRES_PASSWORD=smoke\nJWT_SECRET=smoke\nTUNNEL_TOKEN=unused\nCORS_ORIGINS=https://app.homesy.gilla.fun\nHOMESY_IMAGE=homesy-api:local\n' > "$SMOKE/.env"
cd "$SMOKE"
sed -i '' 's/name: homesy-pgdata/name: homesy-smoke-pgdata/; s/name: homesy-internal/name: homesy-smoke-internal/' compose.yml
sed -i '' 's/container_name: homesy-/container_name: homesy-smoke-/' compose.yml
docker compose -p homesy-smoke up -d homesy-postgres homesy-api
sleep 15
docker run --rm --network homesy-smoke-internal curlimages/curl -fsS http://homesy-api:8080/health; echo
docker inspect homesy-smoke-api --format 'cpus={{.HostConfig.NanoCpus}} mem={{.HostConfig.Memory}} log={{.HostConfig.LogConfig.Config}}'
docker compose -p homesy-smoke down -v
cd - && rm -rf "$SMOKE"
```

Expected:
- `ok`
- `cpus=1000000000 mem=536870912`, with log config showing `max-file:3 max-size:10m`
- clean teardown, and the dev `homesy-db-1` container still running (check with `docker ps | grep homesy-db-1`)

- [ ] **Step 9: Commit**

```bash
git add deploy/
gitleaks protect --staged --no-banner
git commit -m "Add production compose stack, tunnel ingress and deploy script

deploy.sh takes a pre-deploy pg_dump (last 5 kept), aborts on dump failure,
warns when HOMESY_IMAGE is pinned, then pulls and restarts the stack.
Tested against a stub docker in deploy/test_deploy.sh."
```

---

### Task 7: CI/CD workflow

**Files:**
- Create: `.github/workflows/api.yml`

**Interfaces:**
- Consumes: `backend/Dockerfile` (Task 5). GitHub secrets `VPS_SSH_PRIVATE_KEY`, `VPS_HOST_KEY`, `VPS_HOST`, `VPS_USER` (Task 12).
- Produces: jobs `test`, `build-push`, `deploy`. On `main`, the image is `ghcr.io/rohithgilla12/homesy-api:{<short-sha>,latest}`.

- [ ] **Step 1: Write `.github/workflows/api.yml`**

```yaml
name: api

# Tests every backend change. On main it also builds the arm64 image, pushes it to GHCR and deploys it.
# Host details live only in the deploy secrets, never in this file.

on:
  push:
    branches: [main]
    paths:
      - "backend/**"
      - ".github/workflows/api.yml"
  pull_request:
    branches: [main]
    paths:
      - "backend/**"
      - ".github/workflows/api.yml"
  workflow_dispatch: {}

concurrency:
  group: api-${{ github.ref }}
  # Superseded PR runs can go; never cancel a main run mid-deploy.
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: homesy
          POSTGRES_PASSWORD: homesy
          POSTGRES_DB: homesy
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v6
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: backend
      - run: cargo fmt --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test
        env:
          DATABASE_URL: postgres://homesy:homesy@localhost:5432/homesy

  build-push:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04-arm # native arm64, matching the host
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v6
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/rohithgilla12/homesy-api
          tags: |
            type=sha,format=short,prefix=
            type=raw,value=latest
      - uses: docker/build-push-action@v7
        with:
          context: backend
          platforms: linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=homesy-api
          cache-to: type=gha,scope=homesy-api,mode=max
          provenance: false

  deploy:
    needs: build-push
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://api.homesy.gilla.fun
    steps:
      - name: Configure SSH
        env:
          SSH_PRIVATE_KEY: ${{ secrets.VPS_SSH_PRIVATE_KEY }}
          HOST_KEY: ${{ secrets.VPS_HOST_KEY }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/deploy
          chmod 600 ~/.ssh/deploy
          printf '%s\n' "$HOST_KEY" > ~/.ssh/known_hosts
          chmod 600 ~/.ssh/known_hosts
      - name: Deploy
        # The key's forced command on the host runs ~/homesy/deploy.sh, whatever is requested here.
        env:
          VPS_USER: ${{ secrets.VPS_USER }}
          VPS_HOST: ${{ secrets.VPS_HOST }}
        run: ssh -i ~/.ssh/deploy -o BatchMode=yes -o IdentitiesOnly=yes "$VPS_USER@$VPS_HOST"
      - name: Smoke test
        run: |
          for attempt in 1 2 3 4 5; do
            if curl --max-time 8 -fsS https://api.homesy.gilla.fun/health; then echo; exit 0; fi
            echo "attempt $attempt failed; retrying in 5s"
            sleep 5
          done
          echo "::error::/health did not return 200 after 5 attempts"
          exit 1
```

- [ ] **Step 2: Lint the workflow**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/api.yml
gitleaks protect --staged --no-banner
git commit -m "Add api CI/CD workflow

Test on x64 with Postgres 16; on main, build the arm64 image on a native
runner, push to GHCR, deploy via the forced-command SSH key and smoke-test
/health."
```

---

### Task 8: Docs

**Files:**
- Create: `DEPLOY.md`
- Modify: `CLAUDE.md` (Commands, Backend architecture, Conventions and gotchas)

**Interfaces:**
- Consumes: everything in Tasks 2–7
- Produces: an operator runbook with no host specifics, and Claude guidance for the deploy pipeline and the migration rule

- [ ] **Step 1: Write `DEPLOY.md`**

````markdown
# Deploying the Homesy API

Production is `https://api.homesy.gilla.fun`. It is one compose stack (`deploy/compose.prod.yml`) on a shared arm64 host, reached only through a Cloudflare Tunnel; the host exposes no ports. Host access details are kept outside this repository.

## How a deploy happens

Merging to `main` with changes under `backend/` runs `.github/workflows/api.yml`:

1. `test`: `cargo fmt --check`, `cargo clippy -- -D warnings`, and `cargo test` against Postgres 16.
2. `build-push`: a native arm64 build pushed to `ghcr.io/rohithgilla12/homesy-api` as `:<short-sha>` and `:latest`.
3. `deploy`: SSH with a key whose forced command runs `~/homesy/deploy.sh` (a `pg_dump` to `~/homesy/backups/`, keeping the last 5, then `docker compose pull homesy-api && docker compose up -d`), followed by a smoke test of `/health`.

Changes to `deploy/compose.prod.yml`, `deploy/cloudflared.yml`, or `deploy/deploy.sh` are not deployed automatically. Copy them to `~/homesy/` on the host (as `compose.yml`, `cloudflared.yml`, and `deploy.sh`), then run `~/homesy/deploy.sh`.

## Host layout

```
~/homesy/
  compose.yml        from deploy/compose.prod.yml
  cloudflared.yml    from deploy/cloudflared.yml
  deploy.sh          from deploy/deploy.sh
  .env               host-only: POSTGRES_PASSWORD, JWT_SECRET, TUNNEL_TOKEN, CORS_ORIGINS, RUST_LOG, HOMESY_IMAGE
  backups/           pre-deploy dumps
```

## Rollback

1. In `~/homesy/.env`, set `HOMESY_IMAGE=ghcr.io/rohithgilla12/homesy-api:<good-sha>`.
2. Run `~/homesy/deploy.sh` and check `curl -fsS https://api.homesy.gilla.fun/health`.
3. Once a fix ships, set `HOMESY_IMAGE` back to `:latest`. While it is pinned, every CI deploy pulls the pinned tag and changes nothing. `deploy.sh` warns about this.

## Migrations

Migrations run when the API starts. They must be **expand-only**: add tables, nullable columns, and indexes. Ship renames and drops in a later release, once no deployed image uses the old shape. This keeps a rollback to the previous image safe.

## Restoring the database

```bash
cd ~/homesy
docker compose stop homesy-api
docker exec homesy-postgres dropdb -U homesy homesy
docker exec homesy-postgres createdb -U homesy homesy
gunzip -c backups/predeploy-<timestamp>.sql.gz | docker exec -i homesy-postgres psql -U homesy -d homesy
docker compose start homesy-api
```

The host's nightly backup job also snapshots this database.
````

- [ ] **Step 2: Update `CLAUDE.md`**

1. In the Commands block, after `cargo clippy && cargo fmt`, change that line to:

```
cargo fmt --check && cargo clippy --all-targets -- -D warnings   # what CI enforces
```

2. In "Backend architecture", replace the bullet `- CORS is `permissive()` (marked "tighten before prod").` with:

```markdown
- **CORS** is permissive unless `CORS_ORIGINS` is set (comma-separated `scheme://host[:port]`, validated at startup). Production sets it to the web app origin.
- **Deployment:** merging backend changes to `main` tests, builds an arm64 image, and deploys it to `https://api.homesy.gilla.fun` (see `DEPLOY.md`). The API runs as a single instance, which the in-process SSE broadcast requires. `/health` pings the database and returns 503 within about 2 s when it is down.
```

3. In "Conventions and gotchas", append:

```markdown
- Migrations must be expand-only (add tables, nullable columns, and indexes; renames and drops go in a later release). Rolling back to the previous image must keep working against the new schema.
- This repo is treated as public. Never commit host addresses, SSH users, tunnel IDs or tokens, or `.env` values. Production secrets live only in the host's `~/homesy/.env` and in GitHub secrets.
```

- [ ] **Step 3: Commit**

```bash
git add DEPLOY.md CLAUDE.md
gitleaks protect --staged --no-banner
git commit -m "Document the deploy pipeline, rollback and migration rule"
```

---

### Task 9: Operator notes (outside the repo)

**Files:**
- Create: `~/.claude/skills/deploy-homesy/SKILL.md`. This is **not** in the repo and must never be committed.

**Interfaces:**
- Consumes: the host details already used for the other projects on this host
- Produces: the source of `$HOMESY_SSH` for Tasks 10–15, plus the runbook for future sessions

- [ ] **Step 1: Write the skill**

Fill in the real values at execution time. They exist only in this file.

````markdown
---
name: deploy-homesy
description: Operate the Homesy API in production (api.homesy.gilla.fun) on the shared arm64 host — manual deploys, rollback, logs, restores, tunnel and Gatus checks. Use when asked to deploy, roll back, debug, or inspect production Homesy.
---

# Homesy production

Normal deploys happen in CI when backend changes merge to `main` (see the repo's `DEPLOY.md`). This skill holds the host details that are deliberately kept out of that public repo.

| | |
|---|---|
| SSH | `export HOMESY_SSH=<user@host>` (same host as Openmind; see the deploy-openmind skill) |
| Stack dir | `~/homesy` (compose.yml, cloudflared.yml, deploy.sh, .env, backups/) |
| Containers | homesy-postgres, homesy-api, homesy-cloudflared |
| Tunnel | `homesy`, id `<tunnel-id>`, route `api.homesy.gilla.fun` to `http://homesy-api:8080` |
| CI deploy key | `homesy-ci-deploy`, fingerprint `<fingerprint>`, forced command `~/homesy/deploy.sh` |
| Gatus | endpoint `homesy-api` in `~/gatus/config/config.yaml` |

The host is busy and shared, and its disk is tight. Never build images on it, and check `cat /proc/loadavg; df -h /` before heavy operations.

- Manual deploy: `ssh "$HOMESY_SSH" '~/homesy/deploy.sh'`
- Logs: `ssh "$HOMESY_SSH" 'docker logs --tail 200 homesy-api'`
- Rollback and restore: follow the repo's `DEPLOY.md`.
````

- [ ] **Step 2: Verify the repo cannot pick it up**

Run: `git -C /Users/rohithgilla/github.com/Rohithgilla12/homesy status --porcelain | grep -c deploy-homesy`
Expected: `0`

---

### Task 10: Host setup (state-changing; confirm with the owner first)

**Files:** none in the repo. This creates `~/homesy/` on the host.

**Interfaces:**
- Consumes: `deploy/compose.prod.yml`, `deploy/cloudflared.yml`, `deploy/deploy.sh` (Task 6), and `$HOMESY_SSH` (Task 9)
- Produces: `~/homesy/` with the files and a `.env` holding every key except `TUNNEL_TOKEN` (added in Task 11), plus GHCR login on the host

- [ ] **Step 1: Pre-flight**

Run: `ssh "$HOMESY_SSH" 'cat /proc/loadavg; df -h / | tail -1; ls -d ~/homesy 2>/dev/null || echo "no ~/homesy yet"'`
Expected: load under 8, at least 5 GB free, and `no ~/homesy yet`.

- [ ] **Step 2: Create the directory and copy the files**

```bash
ssh "$HOMESY_SSH" 'mkdir -p ~/homesy/backups && chmod 700 ~/homesy'
scp deploy/compose.prod.yml "$HOMESY_SSH:homesy/compose.yml"
scp deploy/cloudflared.yml "$HOMESY_SSH:homesy/cloudflared.yml"
scp deploy/deploy.sh "$HOMESY_SSH:homesy/deploy.sh"
ssh "$HOMESY_SSH" 'chmod 755 ~/homesy/deploy.sh && ls -la ~/homesy'
```

- [ ] **Step 3: Generate `.env` on the host without printing secrets**

```bash
ssh "$HOMESY_SSH" 'cd ~/homesy && test ! -e .env && umask 077 && {
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
  echo "JWT_SECRET=$(openssl rand -hex 32)"
  echo "CORS_ORIGINS=https://app.homesy.gilla.fun"
  echo "RUST_LOG=homesy_api=info,tower_http=info"
  echo "HOMESY_IMAGE=ghcr.io/rohithgilla12/homesy-api:latest"
} > .env && stat -c "%a %n" .env && cut -d= -f1 .env'
```

Expected: `600 .env` followed by the five key names. No values are printed. `test ! -e .env` refuses to overwrite an existing file.

- [ ] **Step 4: GHCR login (owner action, needed while the image is private)**

1. Check for an existing login: `ssh "$HOMESY_SSH" 'grep -c "\"ghcr.io\"" ~/.docker/config.json 2>/dev/null || echo 0'`
2. If it is `0`, the owner creates a classic personal access token with only the `read:packages` scope (github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)) and saves it in 1Password. The owner then runs one of these in this session, so the token never appears in chat:
   - `! op read "op://<vault>/<item>/token" | ssh "$HOMESY_SSH" 'docker login ghcr.io -u rohithgilla12 --password-stdin'`
   - or, with the token on the clipboard: `! pbpaste | ssh "$HOMESY_SSH" 'docker login ghcr.io -u rohithgilla12 --password-stdin'`

Expected: `Login Succeeded`.

- [ ] **Step 5: Confirm the nightly backup will discover the database**

This check runs against the container name pattern that the backup job matches. It works once the stack is up in Task 13, so record the command now and re-run it there:

`ssh "$HOMESY_SSH" "docker ps --format '{{.Names}} {{.Image}}' | awk '/postgres|postgis|pgvector/ { print \$1 }' | grep -x homesy-postgres"`

Expected after Task 13: `homesy-postgres`.

---

### Task 11: Cloudflare tunnel and DNS (state-changing; confirm with the owner first)

**Files:** none in the repo. The tunnel credentials stay in `~/.cloudflared/` on the Mac, and the token goes only to the host `.env`.

**Interfaces:**
- Consumes: `~/homesy/.env` (Task 10)
- Produces: tunnel `homesy`, the DNS record `api.homesy.gilla.fun` as a CNAME to the tunnel, and `TUNNEL_TOKEN` in the host `.env`

- [ ] **Step 1: Authorise cloudflared for the zone (owner clicks once)**

Run: `cloudflared tunnel login`
The owner picks `gilla.fun` in the browser. Expected: `~/.cloudflared/cert.pem` is written.

- [ ] **Step 2: Create the tunnel and route DNS**

```bash
cloudflared tunnel create homesy
cloudflared tunnel route dns homesy api.homesy.gilla.fun
cloudflared tunnel list | grep homesy
```

Expected: the tunnel ID is printed (record it in the Task 9 skill only). The route reports a CNAME for `api.homesy.gilla.fun`.

- [ ] **Step 3: Put the token on the host without printing it**

```bash
cloudflared tunnel token homesy | ssh "$HOMESY_SSH" 'cd ~/homesy && umask 077 && t=$(cat) && test -n "$t" && printf "TUNNEL_TOKEN=%s\n" "$t" >> .env && cut -d= -f1 .env'
```

Expected: six key names, now including `TUNNEL_TOKEN`.

- [ ] **Step 4: Verify DNS**

Run: `dig +short api.homesy.gilla.fun`
Expected: Cloudflare edge IPs. The hostname returns `530` until the connector starts in Task 13, which is expected at this point.

---

### Task 12: Deploy key and GitHub secrets (state-changing; confirm with the owner first)

**Files:** none in the repo. The key pair is created in the session scratchpad and the private half is deleted at the end.

**Interfaces:**
- Consumes: `~/homesy/deploy.sh` on the host (Task 10)
- Produces: a forced-command key in the host's `authorized_keys`, and secrets `VPS_SSH_PRIVATE_KEY`, `VPS_HOST_KEY`, `VPS_HOST`, `VPS_USER` in the `production` environment (or at repo level, per deviation 5)

- [ ] **Step 1: Generate the key pair in the scratchpad**

```bash
KEY="$SCRATCHPAD/homesy-deploy"   # the session scratchpad directory
ssh-keygen -t ed25519 -N "" -C homesy-ci-deploy -f "$KEY" -q && ssh-keygen -lf "$KEY.pub"
```

Expected: one fingerprint line (record it in the Task 9 skill).

- [ ] **Step 2: Install the public key with a forced command**

```bash
ssh "$HOMESY_SSH" 'k=$(cat) && printf "restrict,command=\"%s/homesy/deploy.sh\" %s\n" "$HOME" "$k" >> ~/.ssh/authorized_keys && tail -1 ~/.ssh/authorized_keys | cut -c1-60' < "$KEY.pub"
```

Expected: `restrict,command="/home/.../homesy/deploy.sh" ssh-ed25519 ...`

- [ ] **Step 3: Verify the key cannot run anything else**

Run: `ssh -i "$KEY" -o IdentitiesOnly=yes "$HOMESY_SSH" 'echo should-not-run'`
Expected: `should-not-run` is **not** printed. Instead `deploy.sh` runs, skips the backup, then fails at `docker compose pull` because no image exists yet. That failure is expected here and proves the forced command is in effect.

- [ ] **Step 4: Create the environment and set the secrets**

```bash
gh api -X PUT repos/Rohithgilla12/homesy/environments/production >/dev/null && echo "environment ok" || echo "environment unavailable"
```

If `environment ok`, use `ENVFLAG="--env production"`. If not, use `ENVFLAG=""`, and in a follow-up commit remove the `environment:` block (3 lines) from the `deploy` job in `.github/workflows/api.yml`.

```bash
HOST_ONLY=${HOMESY_SSH#*@}; USER_ONLY=${HOMESY_SSH%@*}
gh secret set VPS_SSH_PRIVATE_KEY $ENVFLAG --repo Rohithgilla12/homesy < "$KEY"
ssh-keyscan -t ed25519 "$HOST_ONLY" 2>/dev/null | gh secret set VPS_HOST_KEY $ENVFLAG --repo Rohithgilla12/homesy
gh secret set VPS_HOST $ENVFLAG --repo Rohithgilla12/homesy --body "$HOST_ONLY"
gh secret set VPS_USER $ENVFLAG --repo Rohithgilla12/homesy --body "$USER_ONLY"
gh secret list $ENVFLAG --repo Rohithgilla12/homesy
```

Expected: the list shows all four names.

- [ ] **Step 5: Delete the local private key**

Run: `rm -f "$KEY" "$KEY.pub" && ls "$KEY"* 2>/dev/null | wc -l`
Expected: `0`

---

### Task 13: First deploy through CI

**Files:** none

**Interfaces:**
- Consumes: the branch from Tasks 1–8 and the setup from Tasks 10–12
- Produces: a live `https://api.homesy.gilla.fun`

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin feat/backend-deploy
gh pr create --fill --title "Deploy the backend to api.homesy.gilla.fun"
gh pr checks --watch
```

Expected: the `test` check passes. `build-push` and `deploy` are skipped on PRs.

- [ ] **Step 2: Merge (confirm with the owner first) and watch the main run**

```bash
gh pr merge --merge --delete-branch
sleep 10 && gh run watch "$(gh run list --workflow api.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: `test`, `build-push`, and `deploy` all pass, and the smoke test prints `ok`.

- [ ] **Step 3: Confirm on the host**

```bash
ssh "$HOMESY_SSH" 'cd ~/homesy && docker compose ps --format "{{.Name}} {{.Status}}" && docker logs homesy-cloudflared 2>&1 | grep -c "Registered tunnel connection"'
```

Expected: all three containers are `Up` (Postgres shows `(healthy)`), and the tunnel shows at least one registered connection. Then re-run the backup discovery check from Task 10, Step 5. Expected: `homesy-postgres`.

---

### Task 14: Edge rate limiting and uptime monitoring

**Files:** none in the repo. This changes the Cloudflare zone and `~/gatus/config/config.yaml` on the host.

**Interfaces:**
- Consumes: the live API (Task 13)
- Produces: a rate-limiting rule on `/auth/*` and a Gatus endpoint `homesy-api`

- [ ] **Step 1: Rate-limiting rule (owner action, or Claude with a scoped token)**

Neither available credential can edit firewall rules. Either the owner adds the rule in the dashboard (gilla.fun → Security → WAF → Rate limiting rules → Create rule), or the owner creates an API token with only `Zone → Zone WAF → Edit` on `gilla.fun`, stored in 1Password, and Claude applies the same rule through the Rulesets API.

- Name: `homesy auth`
- Expression: `(http.host eq "api.homesy.gilla.fun" and starts_with(http.request.uri.path, "/auth/"))`
- Characteristics: IP
- Rate: 5 requests per 10 seconds on the free plan (10 per 60 s if the plan allows)
- Action: Block, for 10 seconds (the free plan's only duration)

If the zone's single free-plan rule slot is already taken by another project, stop and ask the owner which rule to keep.

- [ ] **Step 2: Verify the rate limit**

```bash
for i in $(seq 1 15); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://api.homesy.gilla.fun/auth/login \
    -H 'content-type: application/json' -d '{"email":"ratelimit-probe@homesy.test","password":"not-a-real-password"}'
done; echo
```

Expected: `401` responses at first, then `429` once the limit trips.

- [ ] **Step 3: Add the Gatus endpoint (confirm with the owner first)**

The script goes to the remote `python3` over stdin. The local heredoc is quoted, so nothing in it is expanded and its quotes cannot clash with the `ssh` argument.

```bash
ssh "$HOMESY_SSH" 'cd ~/gatus/config && cp config.yaml config.yaml.bak-homesy && python3 -' <<'PY'
import pathlib
p = pathlib.Path("config.yaml")
s = p.read_text()
anchor = '    alerts: [{ type: ntfy, description: "runstamp-api.gilla.fun is down" }]\n'
block = anchor + '''
  - name: homesy-api
    group: apps
    url: "https://api.homesy.gilla.fun/health"
    interval: 5m
    conditions: ["[STATUS] == 200", "[RESPONSE_TIME] < 5000"]
    alerts: [{ type: ntfy, description: "api.homesy.gilla.fun is down" }]
'''
assert s.count(anchor) == 1, "anchor not found exactly once"
p.write_text(s.replace(anchor, block))
PY
ssh "$HOMESY_SSH" 'grep -n -A5 "name: homesy-api" ~/gatus/config/config.yaml'
```

Expected: the new block is printed. If the anchor assertion fails, the config has changed. Stop and place the block next to the `cadence-api` endpoint by hand.

- [ ] **Step 4: Verify Gatus picked it up**

Run: `ssh "$HOMESY_SSH" 'sleep 30; docker logs --since 2m gatus 2>&1 | grep -i -E "homesy|config" | tail -5'`
Expected: a config reload or a `homesy-api` health result. If Gatus does not hot-reload, run `docker restart gatus` and check again.

---

### Task 15: Production verification and rollback drill

**Files:** none

**Interfaces:**
- Consumes: the live stack
- Produces: evidence for every item in the spec's production verification list

- [ ] **Step 1: Health and auth end to end**

```bash
API=https://api.homesy.gilla.fun
curl -fsS $API/health; echo
EMAIL="smoke+$(date +%s)@homesy.test"
TOKEN=$(curl -fsS -X POST $API/auth/signup -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smoke-test-password\",\"display_name\":\"Smoke Test\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -fsS $API/me -H "authorization: Bearer $TOKEN"; echo
```

Expected: `ok`, then a JSON user with the smoke email.

- [ ] **Step 2: SSE survives the 100 s tunnel idle limit and delivers events**

```bash
HOME_ID=$(curl -fsS -X POST $API/homes -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"Smoke"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
LIST_ID=$(curl -fsS $API/homes/$HOME_ID/lists -H "authorization: Bearer $TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
curl -sN --max-time 150 $API/homes/$HOME_ID/events -H "authorization: Bearer $TOKEN" > /tmp/homesy-sse.txt &
sleep 130
curl -fsS -X POST $API/lists/$LIST_ID/items -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"title":"milk"}' > /dev/null
wait
grep -c '^event: item_created' /tmp/homesy-sse.txt
```

Expected: `1`. The stream was still open after 130 s and received the event.

- [ ] **Step 3: Resource limits and backup**

```bash
ssh "$HOMESY_SSH" 'docker stats --no-stream --format "{{.Name}} {{.CPUPerc}} {{.MemUsage}}" homesy-api homesy-postgres homesy-cloudflared; ls -1 ~/homesy/backups'
```

Expected: `homesy-api` memory is under its 512 MiB limit. The first CI deploy ran with Postgres down, so there may be no backup yet. Run `ssh "$HOMESY_SSH" '~/homesy/deploy.sh'` once and confirm one `predeploy-*.sql.gz` appears.

- [ ] **Step 4: Rollback drill**

```bash
SHA=$(gh run list --workflow api.yml --branch main --limit 1 --json headSha -q '.[0].headSha' | cut -c1-7)
ssh "$HOMESY_SSH" "cd ~/homesy && sed -i 's|^HOMESY_IMAGE=.*|HOMESY_IMAGE=ghcr.io/rohithgilla12/homesy-api:$SHA|' .env && ./deploy.sh"
curl -fsS https://api.homesy.gilla.fun/health; echo
ssh "$HOMESY_SSH" "cd ~/homesy && sed -i 's|^HOMESY_IMAGE=.*|HOMESY_IMAGE=ghcr.io/rohithgilla12/homesy-api:latest|' .env && ./deploy.sh"
```

Expected: the first `deploy.sh` prints the pinned-image `WARNING` and `running ghcr.io/rohithgilla12/homesy-api:<sha>`. Health returns `ok`. The second run prints no warning and `running ...:latest`.

- [ ] **Step 5: Clean up the smoke data**

```bash
ssh "$HOMESY_SSH" "docker exec homesy-postgres psql -U homesy -d homesy -c \"delete from homes where created_by in (select id from users where email like 'smoke+%@homesy.test'); delete from users where email like 'smoke+%@homesy.test';\""
```

Expected: `DELETE 1` for each table. `homes.created_by` does not cascade, so homes go first. Carry this cascade gap into the account-deletion design in sub-project 2.

- [ ] **Step 6: Update the operator notes and finish**

Record the tunnel ID, key fingerprint, and anything surprising in `~/.claude/skills/deploy-homesy/SKILL.md`. Remind the owner to copy `POSTGRES_PASSWORD`, `JWT_SECRET`, and `TUNNEL_TOKEN` from `~/homesy/.env` into 1Password.
