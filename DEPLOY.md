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
3. Once a fix ships, set `HOMESY_IMAGE` back to `:latest`. While it is pinned, `deploy.sh` warns, and CI deploys fail with an error instead of reporting a deploy that shipped nothing.

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
