#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "$0")/../.." && pwd -P)
ENV_FILE="$ROOT_DIR/.env"
BACKUP_DB_FILE=${BACKUP_DB_FILE:-}
BACKUP_STORAGE_FILE=${BACKUP_STORAGE_FILE:-}
BACKUP_MANIFEST=${BACKUP_MANIFEST:-}
BACKUP_AGE_IDENTITY=${BACKUP_AGE_IDENTITY:-}
CONFIRM_TEXT="OVERWRITE_CURRENT_DATABASE_AND_STORAGE"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/deploy/self-hosted/compose.yaml")

if [[ "${RESTORE_CONFIRM:-}" != "$CONFIRM_TEXT" ]]; then
  echo "Refusing destructive restore. Set RESTORE_CONFIRM=$CONFIRM_TEXT after reviewing the target." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" || ! -f "$BACKUP_DB_FILE" || ! -f "$BACKUP_STORAGE_FILE" || ! -f "$BACKUP_MANIFEST" || ! -f "$BACKUP_AGE_IDENTITY" ]]; then
  echo "Provide .env, both encrypted archives, their SHA-256 manifest, and an age identity file." >&2
  exit 1
fi
for command_name in docker age sha256sum; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 1; }
done

manifest_dir=$(cd -- "$(dirname -- "$BACKUP_MANIFEST")" && pwd -P)
(
  cd -- "$manifest_dir"
  sha256sum --check "$(basename -- "$BACKUP_MANIFEST")"
)

# Quiesce application traffic before replacing either persistent dataset.
"${COMPOSE[@]}" stop web next-app || true
"${COMPOSE[@]}" up -d db
"${COMPOSE[@]}" exec -T db sh -ec \
  'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 2; done'

age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$BACKUP_DB_FILE" \
  | "${COMPOSE[@]}" exec -T db sh -ec \
    'pg_restore --clean --if-exists --no-owner --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"'

age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$BACKUP_STORAGE_FILE" \
  | "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh storage-init -ec \
    'find /storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf - -C /storage; chown -R 1001:1001 /storage; chmod 755 /storage /storage/course-images; chmod 700 /storage/course-files; find /storage/course-images -type f -exec chmod 644 {} +'

"${COMPOSE[@]}" run --rm --no-deps migrate
"${COMPOSE[@]}" up -d
printf 'Restore commands completed. Verify /api/health/ready and run the full staging checklist before reopening traffic.\n'
