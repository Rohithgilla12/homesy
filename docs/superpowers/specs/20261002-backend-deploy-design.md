# Backend deployment — design

- **Date:** 2026-10-02
- **Status:** Draft, awaiting review
- **Sub-project:** 1 of 4 in the "ship the beta" effort

This repository is treated as public. This document, and every file it introduces, must contain no host addresses, SSH users, ports specific to the host, tokens, or secrets. Operator details live outside the repo (see "Operator notes").

## Context

Homesy is going to a friends-and-family beta through external TestFlight, with a public App Store launch later. The work is split into four sub-projects, each with its own spec, plan, and implementation:

1. **Backend deployment** (this document). This blocks 2 and 3.
2. iOS release: EAS project, build profiles, icon, account deletion, TestFlight.
3. Web app: Expo web build at `app.homesy.gilla.fun`.
4. Marketing site: Astro static site at `homesy.gilla.fun`, with privacy and support pages.

Today the API runs only on a developer machine. A TestFlight build cannot reach a LAN address, and iOS App Transport Security rejects plain HTTP, so a public HTTPS API is a prerequisite for everything else.

## Goals

- The API is reachable at `https://api.homesy.gilla.fun`, backed by a persistent Postgres.
- Every push to `main` that touches `backend/` is tested, built, deployed, and smoke-tested with no manual steps.
- Homesy cannot degrade the shared host it runs on.
- Database data is backed up nightly and before every deploy.
- Rollback to any previously built image is a single, documented operation.

## Non-goals

- A staging environment. It can be added later, but it is not worth the disk on the host for a beta.
- Horizontal scaling. SSE fan-out uses an in-process `tokio::sync::broadcast` channel, so the API must run as exactly one instance.
- Error tracking (Sentry), metrics, or tracing backends.
- Mobile build configuration and per-environment API URLs, which belong to sub-project 2.

## Constraints

- **The host** is a personal, shared, arm64 server that runs many unrelated services.
  - It has limited free disk.
  - It has had outages caused by load spikes during on-host builds and by a full disk.
  - It already runs Cloudflare Tunnel connectors, Watchtower (watching all containers by default), Gatus, and a nightly restic backup job.
- **The nightly backup job** discovers every running container whose image name contains `postgres`, writes `pg_dumpall` output to an encrypted restic repository, and backs up compose and `.env` files under the home directory.
- **The API must not compile on the host.**
- **The repository is private for now but treated as public.**

## Architecture

```
iPhone / browser ──HTTPS──▶ Cloudflare edge ──tunnel──▶ homesy-cloudflared ──▶ homesy-api:8080 ──▶ homesy-postgres:5432
                          (api.homesy.gilla.fun)       (outbound-only; no inbound ports on the host)
```

One compose project, `homesy`, lives in `~/homesy` on the host. It has three services on a private bridge network, `homesy-internal`. No service publishes a port to the host.

| Service | Image | Notes |
|---|---|---|
| `homesy-postgres` | `postgres:16-alpine` | Named volume `homesy-pgdata`. Has a healthcheck (`pg_isready`). The image name matches the backup job's discovery pattern. |
| `homesy-api` | `${HOMESY_IMAGE:-ghcr.io/rohithgilla12/homesy-api:latest}` | Limited to `cpus: 1.0` and `mem_limit: 512m`. Starts after `homesy-postgres` is healthy. Runs migrations on boot (unchanged behaviour). |
| `homesy-cloudflared` | `cloudflare/cloudflared:latest` | Runs `tunnel --no-autoupdate --config /etc/cloudflared/config.yml run` with `TUNNEL_TOKEN`. The ingress file `deploy/cloudflared.yml` is committed and mounted read-only. It holds only the public hostname mapping (`api.homesy.gilla.fun` to `http://homesy-api:8080`, plus a catch-all `http_status:404`), with no tunnel ID or credentials. The token identifies the tunnel. |

**Rules that apply to all three services:**

- `restart: unless-stopped`.
- `json-file` logging with `max-size: 10m` and `max-file: 3`.
- `homesy-api` and `homesy-postgres` carry `com.centurylinklabs.watchtower.enable=false`, so changes reach them only through CI. `homesy-cloudflared` is left to Watchtower.

**SSE through the tunnel:** Cloudflare closes idle proxied connections after about 100 seconds. The API already sends SSE keep-alives every 15 seconds, so no change is needed.

## API changes

These are minimal changes, all in `backend/`.

1. **Configurable CORS.**
   - `Config` gains `cors_origins: Option<Vec<String>>`, read from `CORS_ORIGINS` (comma-separated).
   - When it is set, `create_app` uses a `CorsLayer` that allows exactly those origins, with methods `GET, POST, PATCH, DELETE` and headers `authorization, content-type`.
   - When it is unset, the layer stays `permissive()` for local development.
   - The production compose file declares `CORS_ORIGINS: ${CORS_ORIGINS:?CORS_ORIGINS is required}`, so a missing value fails the deploy instead of failing open.
   - Native apps do not send CORS preflights, so this only affects the web app (sub-project 3).
2. **`/health` checks the database.** It runs `select 1` against the pool and returns `200 ok`, or `503` with `{ "error": "database unavailable" }`.
3. **Graceful shutdown.**
   - `axum::serve(...).with_graceful_shutdown(...)` reacts to SIGTERM and Ctrl-C.
   - Long-lived SSE connections are expected to hold the server open until Docker's stop grace period (10 s) ends. Clients already reconnect with backoff.
4. **Container build files.**
   - `backend/Dockerfile` has two stages.
     - Builder: `rust:1-bookworm` with `cargo-chef`, so the dependency layer is cached separately from source.
     - Runtime: `gcr.io/distroless/cc-debian12:nonroot`, with `EXPOSE 8080` and `ENTRYPOINT ["/app/homesy-api"]`.
     - `sqlx::migrate!` embeds migrations at compile time, so no files are copied at runtime.
   - `backend/.dockerignore` excludes `target/`, `.env`, and `tests/`.

## CI/CD

The workflow file is `.github/workflows/api.yml`. It triggers on `push` and `pull_request` to `main` with paths `backend/**` and the workflow file, plus `workflow_dispatch`. It uses a concurrency group per ref with `cancel-in-progress`.

| Job | Runs on | When | Steps |
|---|---|---|---|
| `test` | `ubuntu-latest` | always | Postgres 16 service container. `Swatinem/rust-cache`. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` with `DATABASE_URL` pointing at the service. |
| `build-push` | `ubuntu-24.04-arm` (native arm64; available to private repos at 2 vCPU / 8 GB, billed against Actions minutes) | push to `main`, after `test` | Buildx, GHCR login with `GITHUB_TOKEN`. Push `:<short-sha>` and `:latest` for `linux/arm64`, with the GitHub Actions build cache and `provenance: false`. |
| `deploy` | `ubuntu-latest`, environment `production` | push to `main`, after `build-push` | Write the SSH key and known host from secrets, then SSH to the host. A forced command runs `~/homesy/deploy.sh`. Smoke test: `curl -fsS https://api.homesy.gilla.fun/health`, up to 5 attempts, 5 s apart. |

**Secrets** for the GitHub `production` environment: `VPS_SSH_PRIVATE_KEY`, `VPS_HOST_KEY`, `VPS_HOST`, and `VPS_USER`. They are set with `gh secret set --env production`. The private key is piped from a file and never printed. The key pair is dedicated to Homesy and is not shared with other projects.

## Deploy script

`deploy/deploy.sh` is committed and installed to `~/homesy/deploy.sh`. It is the only command the deploy key can run, enforced by `command="..."` together with `restrict` in `authorized_keys`, which disables forwarding, PTY, and agent use.

1. `set -euo pipefail`, then `cd ~/homesy`.
2. Back up before deploying: `docker exec homesy-postgres pg_dump -U homesy homesy | gzip > backups/predeploy-<UTC timestamp>.sql.gz`, then delete all but the newest 5. The first deploy skips this when the container is not running.
3. `docker compose pull homesy-api && docker compose up -d homesy-api`.
4. Print the running image digest for the CI log.

**Images and registry login:** the image is private while the repo is private. The host authenticates to GHCR once with a token limited to package read access. GHCR historically requires a classic personal access token with `read:packages`; this will be confirmed during implementation. If the repo becomes public, the package can be made public and the login removed.

## Migrations and rollback

- **Migrations** are embedded and applied at startup. A failing migration makes the container crash-loop, the smoke test fails, and the `deploy` job goes red.
- **Expand-only rule:** each release may only add things, such as tables, nullable columns, and indexes. Renames and drops ship in a later release, after no deployed image depends on the old shape. This keeps the previous image working against the newer schema, so rollback is safe. Document the rule in `CLAUDE.md`.
- **Rollback:** set `HOMESY_IMAGE=ghcr.io/rohithgilla12/homesy-api:<good-sha>` in `~/homesy/.env` and rerun `deploy.sh`. Reset it to `:latest` afterwards. Otherwise CI deploys pull the pinned tag and silently do nothing.
- **Data recovery:** restore from the latest `backups/predeploy-*.sql.gz` or from the nightly restic snapshot.

## Operations

- **Secrets** live in `~/homesy/.env` on the host only. The backup job captures that file nightly.
  - `POSTGRES_PASSWORD` and `JWT_SECRET` are generated on the host with `openssl rand -hex 32`, so they never pass through chat or git.
  - `TUNNEL_TOKEN` is written on the host directly from the `cloudflared` output.
  - `CORS_ORIGINS=https://app.homesy.gilla.fun`.
  - `RUST_LOG=homesy_api=info,tower_http=info`.
  - The owner stores copies of `POSTGRES_PASSWORD`, `JWT_SECRET`, and `TUNNEL_TOKEN` in 1Password.
- **Monitoring:** add a Gatus endpoint for `https://api.homesy.gilla.fun/health`, using Gatus's existing alerting.
- **Abuse protection:** a Cloudflare rate-limiting rule on `api.homesy.gilla.fun/auth/*`, at 10 requests per minute per IP with a block action. Every auth request runs Argon2, which is deliberately CPU-expensive, so the edge must absorb floods before they reach the shared host.

## Setup responsibilities

| Step | Who | How |
|---|---|---|
| Repo changes (API changes, Dockerfile, compose, deploy script, workflow, `DEPLOY.md`, `CLAUDE.md` update) | Claude | Code review, then CI |
| Create the `homesy` tunnel and the `api.homesy.gilla.fun` DNS route | Claude | `cloudflared tunnel login` (the owner clicks Authorize once in the browser), then `cloudflared tunnel create` and `cloudflared tunnel route dns`. The token is written straight to the host's `.env`. |
| Rate-limiting rule | Owner, or Claude with a scoped token | Neither the wrangler OAuth login nor the cloudflared certificate grants firewall-rule edit permission. Either the owner adds the rule in the dashboard using the values above, or the owner creates an API token limited to Zone WAF edit for `gilla.fun` (kept in 1Password) and Claude applies it through the API. |
| GitHub `production` environment and secrets | Claude | `gh api` and `gh secret set --env production` |
| Host setup: directory, `.env` secrets, deploy key, GHCR login, Gatus check, first `docker compose up` | Claude over SSH | Each state-changing step is confirmed with the owner first |
| Store secret copies in 1Password | Owner | Copy from `~/homesy/.env` on the host |

## Operator notes

Host address, SSH user, deploy-key fingerprint, tunnel ID, and troubleshooting notes go in a personal skill at `~/.claude/skills/deploy-homesy/SKILL.md`, which is not in this repo. This follows the existing pattern for other projects on the same host. The committed `DEPLOY.md` refers to "the host" generically.

## Verification

- **Locally:** `cargo test` passes, including a test that `/health` returns 200 with a live DB. `docker build` succeeds for `linux/arm64`. The CORS layer rejects an unlisted `Origin` when `CORS_ORIGINS` is set.
- **CI:** `test` runs green on a PR, and `build-push` and `deploy` run green on merge to `main`.
- **Production:**
  - `https://api.homesy.gilla.fun/health` returns `200`.
  - `POST /auth/signup` followed by `GET /me` works end to end.
  - An SSE connection to `/homes/{id}/events` stays open for more than 2 minutes and receives an event after a mutation.
  - `docker stats` shows the API inside its limits.
  - The next nightly backup log lists `homesy-postgres`.
  - Rolling back to the previous SHA through `.env` works, and returning to `:latest` works.

## Risks

- **Rust builds on a 2-vCPU arm64 runner** are slow on a cold cache: expect over 10 minutes for the first build and a few minutes when cached. This is acceptable for a beta.
- **Watchtower** auto-updates `homesy-cloudflared`. A broken upstream release would take the API offline until the next update or a manual pin. This is the same exposure the other tunnels on the host already have.
- **Single host, single instance.** Host downtime is Homesy downtime. This is accepted for a beta.
