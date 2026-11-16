#!/usr/bin/env python3
"""Export or restore the website's application tables using psql and CSV."""

import argparse
import csv
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
from shutil import copyfileobj
import re


TABLES = {
    "site_users": "id phone password_hash first_name last_name grade major role is_active last_login created_at",
    "courses": "id title grade major category type description price discount_price image_url requires_shipping created_at",
    "user_sessions": "id user_id token_hash is_active expires_at created_at",
    "course_sessions": "id course_id session_number title video_url is_online online_url scheduled_at created_at",
    "cart_items": "id user_id course_id created_at",
    "user_purchases": "id user_id course_id created_at",
    "user_addresses": "user_id full_name phone province city address postal_code updated_at",
    "orders": "id user_id authority amount_rial description status source items course_ids ref_id card_pan created_at verified_at",
    "shipments": "id order_id user_id full_name phone province city address postal_code status tracking_code sent_at created_at updated_at",
    "site_content": "key value updated_at updated_by",
}
OPTIONAL = {"user_purchases", "user_addresses", "shipments", "site_content"}
# Normalize nullable legacy values where the new schema requires a default.
DEFAULTS = {
    "site_users": {"first_name": "''", "last_name": "''", "role": "'student'", "is_active": "true"},
    "courses": {"price": "0", "requires_shipping": "false"},
    "course_sessions": {"is_online": "false"},
    "shipments": {"status": "'pending'"},
    "site_content": {"value": "''"},
}
REWRITE_IMAGE_URLS = r"""
UPDATE courses SET image_url = regexp_replace(image_url,
    '^https?://[^/]+/storage/v1/object/public/course-images/', '/api/files/course-images/')
WHERE image_url ~ '^https?://[^/]+/storage/v1/object/public/course-images/';
UPDATE site_content SET value = regexp_replace(value,
    '^https?://[^/]+/storage/v1/object/public/course-images/', '/api/files/course-images/')
WHERE value ~ '^https?://[^/]+/storage/v1/object/public/course-images/';
"""


def psql(directory, *args, sql=None):
    # libpq reads connection details from PGHOST, PGPORT, PGUSER, PGDATABASE,
    # PGPASSFILE and PGSSLMODE. The connection secret stays out of command arguments.
    subprocess.run(
        ["psql", "-X", "--no-password", "--set=ON_ERROR_STOP=1", *args],
        cwd=directory, input=sql, text=True, encoding="utf-8",
        env={**os.environ, "PGCLIENTENCODING": "UTF8"}, check=True,
    )


def export_tables(directory, include_files):
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    psql(directory, "--command", r"\copy (SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public') TO 'columns.csv' WITH CSV")
    with (directory / "columns.csv").open(encoding="utf-8", newline="") as stream:
        available = {(table, column) for table, column in csv.reader(stream)}
    manifest = {}
    statements = ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"]
    for table, fields in TABLES.items():
        columns = [name for name in fields.split() if (table, name) in available]
        if not columns:
            if table not in OPTIONAL:
                raise ValueError(f"Missing required source table: {table}")
            continue
        defaults = DEFAULTS.get(table, {})
        projection = ", ".join(
            f"coalesce({column}, {defaults[column]})" if column in defaults else column
            for column in columns
        )
        manifest[table] = columns
        statements.append(f"\\copy (SELECT {projection} FROM public.{table}) TO '{table}.csv' WITH CSV")
    if include_files:
        statements.append(r"\copy (SELECT bucket_id, name FROM storage.objects WHERE bucket_id IN ('course-images','course-files') ORDER BY bucket_id, name) TO 'objects.csv' WITH CSV")
    statements.append("COMMIT;")
    psql(directory, sql="\n".join(statements) + "\n")
    (directory / "columns.csv").unlink()
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def export_files(directory):
    base = os.environ["LEGACY_STORAGE_URL"].rstrip("/")
    if urlsplit(base).scheme != "https":
        raise ValueError("LEGACY_STORAGE_URL must use HTTPS")
    token = os.environ["LEGACY_STORAGE_KEY"]
    with (directory / "objects.csv").open(encoding="utf-8", newline="") as stream:
        for bucket, key in csv.reader(stream):
            if bucket == "course-files":
                supported = re.fullmatch(r"[a-zA-Z0-9_-]+\.pdf", key)
            else:
                supported = re.fullmatch(r"(?:courses|site)/[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp|gif|avif)", key, re.IGNORECASE)
            if not supported:
                raise ValueError(f"Unsupported storage object name: {bucket}/{key}")
            dest = directory / "files" / bucket / key
            dest.parent.mkdir(parents=True, exist_ok=True)
            url = f"{base}/storage/v1/object/authenticated/{bucket}/{quote(key)}"
            request = Request(url, headers={"Authorization": f"Bearer {token}", "apikey": token})
            with urlopen(request, timeout=60) as response, dest.open("xb") as out:
                copyfileobj(response, out)


def restore_sql(directory):
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if set(manifest) - set(TABLES) or set(TABLES) - set(manifest) - OPTIONAL:
        raise ValueError("Export manifest contains unexpected tables or is incomplete")
    statements = ["BEGIN;"]
    for table, fields in TABLES.items():
        if table not in manifest:
            continue
        columns = manifest[table]
        if not columns or len(set(columns)) != len(columns) or set(columns) - set(fields.split()):
            raise ValueError(f"Unexpected columns for {table}")
        statements.append(f"\\copy public.{table} ({', '.join(columns)}) FROM '{table}.csv' WITH CSV")
    statements.extend([REWRITE_IMAGE_URLS, "COMMIT;"])
    return "\n".join(statements) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("export", "restore", "restore-sql"))
    parser.add_argument("directory", type=Path)
    parser.add_argument("--include-files", action="store_true")
    options = parser.parse_args()
    if options.action == "export":
        export_tables(options.directory, options.include_files)
        if options.include_files:
            export_files(options.directory)
    elif options.action == "restore-sql":
        print(restore_sql(options.directory), end="")
    else:
        psql(options.directory, sql=restore_sql(options.directory))
