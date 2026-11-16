#!/bin/sh
set -eu
psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set api_password="$DATABASE_API_PASSWORD" <<'SQL'
CREATE ROLE tutorial_api_login LOGIN NOINHERIT PASSWORD :'api_password';
GRANT tutorial_api TO tutorial_api_login;
SQL
