#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "$0")/../.." && pwd -P)
ENV_FILE="$ROOT_DIR/.env"
BACKUP_DIR=${BACKUP_DIR:-}
BACKUP_AGE_RECIPIENT=${BACKUP_AGE_RECIPIENT:-}
BACKUP_KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/deploy/self-hosted/compose.yaml")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE; create it first with deploy/self-hosted/create-env.sh." >&2
  exit 1
fi
if [[ -z "$BACKUP_DIR" || -z "$BACKUP_AGE_RECIPIENT" ]]; then
  echo "Set BACKUP_DIR to off-VPS storage and BACKUP_AGE_RECIPIENT to an age public key." >&2
  exit 1
fi
if ! [[ "$BACKUP_KEEP_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_KEEP_DAYS must be a positive integer." >&2
  exit 1
fi
for command_name in docker age sha256sum; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 1; }
done

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_DIR=$(cd -- "$BACKUP_DIR" && pwd -P)
case "$BACKUP_DIR/" in
  "$ROOT_DIR/"*) echo "BACKUP_DIR must not be inside the repository." >&2; exit 1 ;;
esac

stamp=$(date -u +%Y%m%dT%H%M%SZ)
db_file="$BACKUP_DIR/tutorial-db-$stamp.dump.age"
storage_file="$BACKUP_DIR/tutorial-storage-$stamp.tar.gz.age"
db_tmp="$db_file.tmp"
storage_tmp="$storage_file.tmp"
manifest="$BACKUP_DIR/tutorial-$stamp.sha256"
trap 'rm -f "$db_tmp" "$storage_tmp" "$manifest.tmp"' EXIT

"${COMPOSE[@]}" exec -T db sh -ec \
  'pg_dump --no-owner --format=custom --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$db_tmp"

"${COMPOSE[@]}" run --rm --no-deps --entrypoint sh storage-init -ec \
  'tar -C /storage -czf - .' \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$storage_tmp"

[[ -s "$db_tmp" && -s "$storage_tmp" ]] || { echo "A backup artifact is empty." >&2; exit 1; }
mv -- "$db_tmp" "$db_file"
mv -- "$storage_tmp" "$storage_file"
(
  cd -- "$BACKUP_DIR"
  sha256sum "$(basename -- "$db_file")" "$(basename -- "$storage_file")" > "$manifest.tmp"
)
mv -- "$manifest.tmp" "$manifest"
chmod 600 "$db_file" "$storage_file" "$manifest"

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'tutorial-db-*.dump.age' -o -name 'tutorial-storage-*.tar.gz.age' -o -name 'tutorial-*.sha256' \) \
  -mtime "+$BACKUP_KEEP_DAYS" -delete

printf 'Encrypted database and Storage backups created: %s\n' "$stamp"
printf 'Verify these files are replicated to a separate provider/region; this script only writes to BACKUP_DIR.\n'
