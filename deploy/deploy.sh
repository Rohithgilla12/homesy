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
