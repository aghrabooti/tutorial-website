#!/usr/bin/env python3
"""اجرای فایل‌های SQL روی پروژه‌ی Supabase از طریق Management API.

استفاده:
    SUPABASE_ACCESS_TOKEN=... PROJECT_REF=xxxx python3 scripts/apply-migrations.py supabase/migrations/*.sql

این اسکریپت برای ورک‌فلوی دیپلوی نوشته شده است و فایل‌ها را به‌ترتیب نام مرتب
می‌کند. اگر توکن موجود نباشد فقط پیام می‌دهد و کد خروجی 0 برمی‌گرداند تا
دیپلوی فانکشن‌ها متوقف نشود.
"""

import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    files = sorted(sys.argv[1:])
    if not files:
        print("فایل SQL برای اجرا پیدا نشد")
        return 0

    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    ref = os.environ.get("PROJECT_REF", "").strip()

    if not token or not ref:
        print("SUPABASE_ACCESS_TOKEN یا PROJECT_REF تنظیم نشده؛ از مهاجرت صرف‌نظر می‌شود")
        return 0

    failed = 0

    for path in files:
        print(f"──── applying {path} ────")
        try:
            with open(path, encoding="utf-8") as fh:
                sql = fh.read()
        except OSError as exc:
            print(f"خواندن فایل ممکن نشد: {exc}")
            failed += 1
            continue

        req = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{ref}/database/query",
            data=json.dumps({"query": sql}).encode(),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=180) as res:
                body = res.read().decode()
            print("OK:", body[:2000])
        except urllib.error.HTTPError as exc:
            print("HTTP ERROR", exc.code, exc.read().decode()[:4000])
            failed += 1
        except Exception as exc:  # noqa: BLE001
            print("ERROR", exc)
            failed += 1

    if failed:
        print(f"{failed} فایل مهاجرت با خطا اجرا شد")
        return 1

    print("همه‌ی مهاجرت‌ها با موفقیت اجرا شد ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
