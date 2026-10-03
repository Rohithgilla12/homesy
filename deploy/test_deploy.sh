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
  grep -q '^image prune -f --filter label=org.opencontainers.image.source=https://github.com/Rohithgilla12/homesy$' "$work/calls" \
    || fail "superseded homesy images not pruned"
}

test_failed_dump_aborts_before_touching_containers() {
  setup; old_backups; export STUB_DUMP_FAILS=1
  if "$work/deploy.sh" > "$work/out" 2>&1; then fail "deploy succeeded despite failed dump"; fi
  [ "$(ls "$work"/backups/predeploy-*.sql.gz | wc -l)" -eq 7 ] || fail "existing backups were touched"
  if compgen -G "$work/backups/.predeploy-*.partial" > /dev/null; then fail "partial dump left behind"; fi
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
  if ( "$t" ); then echo "ok   $t"; else echo "FAIL $t"; exit 1; fi
done
