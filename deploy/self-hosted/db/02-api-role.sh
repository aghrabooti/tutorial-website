#!/bin/sh
set -eu
psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set api_password="$DATABASE_API_PASSWORD" <<'SQL'
CREATE ROLE tutorial_api NOLOGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tutorial_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tutorial_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tutorial_api;
CREATE ROLE tutorial_api_login LOGIN NOINHERIT PASSWORD :'api_password';
GRANT tutorial_api TO tutorial_api_login;
SQL
