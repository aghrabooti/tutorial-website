#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ENV_FILE="$ROOT_DIR/.env"

if [ -e "$ENV_FILE" ]; then
  echo "Refusing to overwrite existing $ENV_FILE" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to generate random secrets." >&2
  exit 1
fi

umask 077
POSTGRES_ADMIN_PASSWORD=$(openssl rand -hex 32)
APP_DB_PASSWORD=$(openssl rand -hex 32)
STORAGE_SIGNING_SECRET=$(openssl rand -hex 32)

cat > "$ENV_FILE" <<EOF
# Generated locally by deploy/self-hosted/create-env.sh. Do not commit this file.
POSTGRES_DB=tutorial_website
POSTGRES_ADMIN_USER=postgres
POSTGRES_ADMIN_PASSWORD=$POSTGRES_ADMIN_PASSWORD
APP_DB_USER=tutorial_app
APP_DB_PASSWORD=$APP_DB_PASSWORD
DATABASE_URL=postgresql://tutorial_app:$APP_DB_PASSWORD@db:5432/tutorial_website
MIGRATION_DATABASE_URL=postgresql://postgres:$POSTGRES_ADMIN_PASSWORD@db:5432/tutorial_website

STORAGE_ROOT=/var/lib/tutorial-storage
STORAGE_MAX_BYTES=1073741824
STORAGE_SIGNING_SECRET=$STORAGE_SIGNING_SECRET

ZARINPAL_MERCHANT_ID=
ZARINPAL_SANDBOX=true
ZARINPAL_CALLBACK_URL=https://YOUR_EXISTING_DOMAIN/payment-result
PRICE_TO_RIAL_FACTOR=10

SMS_IR_API_KEY=
SMS_IR_TEMPLATE_ID=
SMS_IR_LINE_NUMBER=
SMS_IR_OTP_PARAMETER=
KAVENEGAR_API_KEY=
OTP_COOLDOWN_SECONDS=60
OTP_DEBUG=false
EOF

chmod 600 "$ENV_FILE"
echo "Created $ENV_FILE with fresh database credentials and storage signing secret."
echo "Fill in only the external SMS/payment values you intend to test; never print or commit .env."
