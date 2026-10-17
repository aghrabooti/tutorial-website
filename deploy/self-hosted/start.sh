#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/deploy/self-hosted/compose.yaml"
CREATE_INITIAL_ADMIN=${CREATE_INITIAL_ADMIN:-0}

case "$CREATE_INITIAL_ADMIN" in
  0|1) ;;
  *) echo "CREATE_INITIAL_ADMIN must be 0 or 1." >&2; exit 2 ;;
esac
if [ "$CREATE_INITIAL_ADMIN" = 1 ] && [ ! -t 0 ]; then
  echo "CREATE_INITIAL_ADMIN=1 requires an interactive terminal for the hidden password prompt." >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Engine is missing. Install Docker Engine and its Compose plugin first." >&2
  exit 2
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 plugin is missing." >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running or the current user cannot access its daemon." >&2
  exit 2
fi

if [ ! -f "$ENV_FILE" ]; then
  "$ROOT_DIR/deploy/self-hosted/create-env.sh"
fi
chmod 600 "$ENV_FILE"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if ! grep -Eq '^(SMS_IR_API_KEY|SMSIR_API_KEY|KAVENEGAR_API_KEY)=.+' "$ENV_FILE"; then
  echo "WARNING: no SMS provider key found; OTP registration will not work until one is configured in .env." >&2
fi
if ! grep -Eq '^ZARINPAL_MERCHANT_ID=.{36}$' "$ENV_FILE"; then
  echo "WARNING: ZARINPAL_MERCHANT_ID is not configured; checkout will remain unavailable." >&2
fi
if grep -q 'YOUR_EXISTING_DOMAIN' "$ENV_FILE"; then
  echo "WARNING: replace the payment callback placeholder in .env before testing Zarinpal." >&2
fi

if ! compose config --quiet; then
  echo "Compose configuration is invalid; review .env and the error above." >&2
  exit 1
fi

compose build
if ! compose up --detach --wait --wait-timeout 300; then
  echo "The self-hosted stack did not become healthy. Logs follow; the containers and data are left intact." >&2
  compose ps || true
  compose logs --no-color --tail=150 db migrate storage-init next-app web 2>/dev/null || true
  exit 1
fi

compose ps
printf '\nSelf-hosted services are running; the web entrypoint is bound to http://127.0.0.1:8080.\n'
printf 'Use an SSH tunnel for private smoke testing, or configure an existing host/provider reverse proxy for public access.\n'
printf 'Create the first admin with:\n  docker compose --env-file .env -f deploy/self-hosted/compose.yaml exec -it next-app node --conditions=react-server scripts/create-admin.js\n'
printf 'For a first run that also prompts for the hidden admin password, use CREATE_INITIAL_ADMIN=1 with this script.\n'
printf 'Do not shut down the old Supabase/Vercel deployment until backup, restore, smoke tests, and the rollback window are complete.\n'

if [ "$CREATE_INITIAL_ADMIN" = 1 ]; then
  compose exec -it next-app node --conditions=react-server scripts/create-admin.js
fi
