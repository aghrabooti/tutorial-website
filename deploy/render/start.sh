#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${DATABASE_USER:?DATABASE_USER is required}"
export PGCONNECT_TIMEOUT=5

attempt=0
until psql "$DATABASE_URL" -X -w -tAc 'select 1' >/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 10 ]; then exit 1; fi
    sleep 3
done
psql "$DATABASE_URL" -X -w -v ON_ERROR_STOP=1 -f /etc/tutorial/init.sql

export PGRST_DB_URI="$DATABASE_URL"
export PGRST_DB_ANON_ROLE="$DATABASE_USER"
export PGRST_DB_SCHEMAS=public PGRST_DB_POOL=3
export PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=3001

# Next and Nginx do not need the database login.
unset DATABASE_URL DATABASE_USER
exec supervisord -n -c /etc/supervisord-render.conf
