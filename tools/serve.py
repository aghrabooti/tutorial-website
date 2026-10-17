#!/usr/bin/env python3
"""
serve.py — سرور کارگاه (داخل خودِ ریپو، پس همیشه باقی می‌ماند)

کارها:
  /            → پیش‌نمایش سایت (با cleanUrls مثل Vercel)
  /download    → صفحه‌ی دانلود: zip کل پروژه + zip فایل‌های تغییریافته
  /make-admin  → راهنمای ساخت مدیر اولیه با bootstrap امن PostgreSQL
  /otp-doctor  → ابزار تشخیص مشکل پیامک کد تأیید (sms.ir / کاوه‌نگار)
  /deploy      → هشدار/آرشیو قدیمی Edge؛ API فعال در Next.js است
  /deploy/NAME.ts → دانلود کد legacy برای بررسی/rollback
  /profile-doctor → تشخیص خطای ذخیره‌ی پروفایل کاربر
  /project.zip /changes.zip /COMMANDS.txt /health

اجرا:
    python3 tools/serve.py            (پورت پیش‌فرض ۸۰۰۰)
    PORT=9000 python3 tools/serve.py
"""
import io
import os
import subprocess
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from string import Template

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_NAME = os.path.basename(REPO)
PORT = int(os.environ.get("PORT", "8000"))
BASE_REF = os.environ.get("BASE_REF", "origin/main")

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".build", ".arena",
             ".cache", ".vercel", ".pytest_cache", ".vscode"}
SKIP_FILES = {".DS_Store"}

# گروه‌بندی کامیت‌ها: الگوی مسیر → پیام کامیت
COMMIT_GROUPS = [
    ("tools/", "chore: add the profile doctor tool"),
    ("update-profile",
     "fix: implement update-profile (was an empty stub that returned 502)"),
    ("register-user",
     "fix: allow signup with phone and password only, plus cors"),
    ("send-otp", "feat: send the otp sms through sms.ir"),
    ("register.js", "feat: show countdown when otp is rate limited"),
    ("dashboard.js",
     "fix: accept the session response so users stay logged in"),
    ("login.js",
     "fix: do not ask ninth graders for a major"),
    ("complete-profile.js",
     "fix: refresh the stored user after saving the profile"),
    ("site-content.js",
     "fix: fall back to default texts when the content function is missing"),
    ("tests/", "test: cover the profile update flow"),
    ("supabase/functions/",
     "fix: add cors headers so the browser can call these functions"),
]


def git(*args):
    r = subprocess.run(["git", "-C", REPO, *args], capture_output=True)
    return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else ""


def project_files():
    """همه‌ی فایل‌های پروژه روی دیسک (به‌جز پوشه‌های موقت)"""
    out = []
    for base, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if name in SKIP_FILES:
                continue
            full = os.path.join(base, name)
            out.append(os.path.relpath(full, REPO))
    return sorted(out)


def changed_files():
    """{path: 'A'|'M'|'D'} نسبت به BASE_REF — شامل فایل‌های تازه‌ی stage‌نشده"""
    out = git("diff", "--name-status", "-z", "--no-renames", BASE_REF)
    tokens = [t for t in out.split("\0") if t]

    result = {}
    i = 0
    while i + 1 < len(tokens):
        result[tokens[i + 1]] = tokens[i][:1]
        i += 2

    # فایل‌های تازه‌ای که در گیت نیستند
    for rel in project_files():
        if rel in result:
            continue
        in_git = git("ls-files", "--error-unmatch", rel).strip()
        if not in_git:
            in_base = subprocess.run(
                ["git", "-C", REPO, "cat-file", "-e", f"{BASE_REF}:{rel}"],
                capture_output=True).returncode == 0
            if not in_base:
                result[rel] = "A"

    return result


def commands_text(changes):
    """دستورهای add/commit گروه‌بندی‌شده"""
    added = sorted(p for p, s in changes.items() if s != "D")
    deleted = sorted(p for p, s in changes.items() if s == "D")

    used = set()
    blocks = []

    for pattern, message in COMMIT_GROUPS:
        group = [p for p in added if pattern in p and p not in used]
        if not group:
            continue
        used.update(group)
        blocks.append("\n".join(f"git add {p}" for p in group) +
                      f'\ngit commit -m "{message}"')

    rest = [p for p in added if p not in used]
    if rest:
        blocks.append("\n".join(f"git add {p}" for p in rest) +
                      '\ngit commit -m "chore: update project files"')

    if deleted:
        blocks.append("\n".join(f"git rm {p}" for p in deleted) +
                      '\ngit commit -m "chore: remove outdated files"')

    header = ("# دستورهای کامیت — به ترتیب اجرا کنید\n"
              "# (فایل‌های هر گروه با هم کامیت می‌شوند)\n\n")

    return header + "\n\n".join(blocks) + "\n" if blocks else \
        "# هیچ تغییری برای کامیت نیست\n"


def build_zip(paths, extra=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for rel in sorted(paths):
            full = os.path.join(REPO, rel)
            if os.path.isfile(full):
                z.write(full, f"{ROOT_NAME}/{rel}")
        for name, data in (extra or {}).items():
            z.writestr(f"{ROOT_NAME}/{name}", data)
    return buf.getvalue()


def size_str(n):
    if n < 1024:
        return f"{n} B"
    if n < 1048576:
        return f"{n / 1024:.0f} KB"
    return f"{n / 1048576:.1f} MB"


# ───────────────────────── صفحه‌ها ─────────────────────────

DOWNLOAD_PAGE = Template("""<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>دانلود و ابزارها</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: Tahoma, "Segoe UI", sans-serif; background: #f4f4f7;
         color: #1f2937; padding: 24px; }
  .card { background: #fff; border-radius: 24px; padding: 34px; max-width: 720px;
          width: 100%; box-shadow: 0 12px 40px rgba(15,23,42,.09); }
  h1 { margin: 0 0 6px; font-size: 23px; }
  .sub { color: #6b7280; font-size: 13.5px; margin: 0 0 24px; }
  a.btn { display: block; text-decoration: none; border-radius: 16px; padding: 17px 20px;
          margin-bottom: 11px; font-weight: bold; border: 2px solid transparent; }
  a.primary { background: #4f46e5; color: #fff; }
  a.secondary { background: #eef2ff; color: #3730a3; border-color: #c7d2fe; }
  a.ghost { background: #fff; color: #374151; border-color: #e5e7eb; }
  a.btn small { display: block; font-weight: normal; opacity: .85; font-size: 12px; margin-top: 5px; }
  .meta { margin-top: 22px; padding-top: 18px; border-top: 1px solid #e5e7eb;
          font-size: 13px; color: #6b7280; line-height: 2; }
  .meta code { background: #f3f4f6; padding: 2px 7px; border-radius: 6px;
               direction: ltr; display: inline-block; font-size: 12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>دانلود و ابزارها</h1>
    <p class="sub">$branch — $commit</p>

    <a class="btn primary" href="/project.zip">
      ⬇ دانلود کل پروژه (zip)
      <small>$total فایل — $full_size — نام فایل: tutorial-website.zip</small>
    </a>

    <div class="meta" style="margin:0 0 18px; border-top:0; padding-top:0">
      لینک مستقیم (برای کپی در مرورگر یا موبایل):<br>
      <code style="word-break:break-all">$base/project.zip</code>
    </div>

    <a class="btn secondary" href="/changes.zip">
      ⬇ فقط فایل‌های تغییریافته نسبت به main
      <small>$changed فایل + COMMANDS.txt با دستورهای کامیت — $chg_size</small>
    </a>

    <a class="btn ghost" href="/deploy">
      🗃 آرشیو راهنمای قدیمی Edge Functions
      <small>APIهای فعال در Next.js هستند؛ این لینک برای deploy روزمره نیست</small>
    </a>

    <a class="btn ghost" href="/otp-doctor">
      🩺 دکتر پیامک (تشخیص مشکل ارسال کد)
      <small>راه‌اندازی sms.ir، قالب کد تأیید، قفل ۶۰ ثانیه، خطای پنل پیامکی</small>
    </a>

    <a class="btn ghost" href="/profile-doctor">
      🩹 دکتر پروفایل (خطای ذخیره‌ی کاربر)
      <small>بررسی route و schema PostgreSQL در محیط self-hosted</small>
    </a>

    <a class="btn ghost" href="/make-admin">
      🔐 ابزار ساخت حساب مدیر
      <small>راهنمای bootstrap تعاملی مدیر اولیه روی VPS؛ بدون ورود رمز در مرورگر</small>
    </a>

    <a class="btn ghost" href="/">
      ↗ پیش‌نمایش سایت
    </a>

    <div class="meta">
      فایل <code>COMMANDS.txt</code> داخل zip دوم، دستورهای <code>git add</code> و
      <code>git commit</code> را آماده دارد.
    </div>
  </div>
</body>
</html>
""")


# ── آرشیو legacy Edge Functions؛ deploy فعال با Next.js انجام می‌شود ──

# Disabled: these old browser-facing Edge functions have dedicated Next.js
# routes now. Keep the source in supabase/functions/ for archival/rollback only.
def deploy_hub_page():
    # The old copy/paste Edge deployment UI is intentionally disabled.
    return """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>آرشیو Edge Functionهای قدیمی</title></head>
<body style="font-family:Tahoma,sans-serif;max-width:760px;margin:40px auto;padding:24px;line-height:2">
  <h1>آرشیو Edge Functionهای قدیمی</h1>
  <p>همه‌ی APIهای browser-facing در routeهای اختصاصی Next.js اجرا می‌شوند؛ allowlist پراکسی compatibility خالی و fail-closed است.</p>
  <p>این صفحه‌ی کپی/deploy عمداً غیرفعال است. کدهای Supabase Edge فقط برای بررسی legacy نگه داشته شده‌اند و deploy آن‌ها مسیر فعال Next را تغییر نمی‌دهد.</p>
  <p><a href="/otp-doctor">دکتر پیامک</a> · <a href="/download">صفحه‌ی دانلود</a></p>
</body>
</html>"""


def deploy_function_page(name):
    # Keep the route closed; only explicit legacy .ts downloads remain available.
    return None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "WorkshopServer/1.0"

    # ── ابزار ارسال ──
    def _send(self, code, body, ctype, headers=None, head_only=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _file(self, rel_path, ctype, head_only=False, extra=None):
        full = os.path.join(REPO, rel_path)
        if not os.path.isfile(full):
            self._send(404, b"404 Not Found\n", "text/plain; charset=utf-8", head_only=head_only)
            return
        with open(full, "rb") as f:
            data = f.read()
        self._send(200, data, ctype, extra, head_only=head_only)

    def _base_url(self):
        """آدرس عمومی همین سرور (همان دامنه‌ای که کاربر باز کرده)"""
        host = self.headers.get("Host") or f"localhost:{PORT}"
        scheme = "https" if "e2b.app" in host else "http"
        return f"{scheme}://{host}"

    def _resolve_static(self, url_path):
        """مسیر درخواست → فایل واقعی (رفتار cleanUrls ورسل)"""
        clean = urllib.parse.unquote(urllib.parse.urlparse(url_path).path, errors="replace")
        clean = clean.lstrip("/")

        if clean == "":
            return "index.html"

        direct = os.path.join(REPO, clean)
        if os.path.isfile(direct):
            return clean

        if os.path.isfile(direct + ".html"):
            return clean + ".html"

        index = os.path.join(direct, "index.html")
        if os.path.isfile(index):
            return os.path.join(clean, "index.html")

        return None

    def do_HEAD(self):
        self.do_GET(head_only=True)

    def do_GET(self, head_only=False):
        path = urllib.parse.urlparse(self.path).path

        # ── دانلودها ──
        if path == "/download":
            changes = changed_files()
            project = project_files()
            full_zip = build_zip(project)
            chg_zip = build_zip(
                [p for p, s in changes.items() if s != "D"],
                extra={"COMMANDS.txt": commands_text(changes),
                       "FILES-REMOVED.txt": "\n".join(
                           sorted(p for p, s in changes.items() if s == "D")) or "—\n"},
            )
            html = DOWNLOAD_PAGE.substitute(
                branch=git("rev-parse", "--abbrev-ref", "HEAD").strip() or "?",
                commit=git("log", "-1", "--format=%h — %s").strip() or "?",
                total=len(project),
                full_size=size_str(len(full_zip)),
                changed=sum(1 for s in changes.values() if s != "D"),
                chg_size=size_str(len(chg_zip)),
                base=self._base_url(),
            )
            self._send(200, html.encode("utf-8"), "text/html; charset=utf-8", head_only=head_only)
            return

        if path in ("/project.zip", "/tutorial-website.zip", "/repo.zip"):
            try:
                data = build_zip(project_files())
            except Exception as e:                                  # noqa: BLE001
                self._send(500, f"zip failed: {e}".encode(), "text/plain", head_only=head_only)
                return
            self._send(200, data, "application/zip",
                       {"Content-Disposition":
                        'attachment; filename="tutorial-website.zip"'},
                       head_only=head_only)
            return

        if path == "/changes.zip":
            changes = changed_files()
            data = build_zip(
                [p for p, s in changes.items() if s != "D"],
                extra={"COMMANDS.txt": commands_text(changes),
                       "FILES-REMOVED.txt": "\n".join(
                           sorted(p for p, s in changes.items() if s == "D")) or "—\n"},
            )
            self._send(200, data, "application/zip",
                       {"Content-Disposition": 'attachment; filename="changes.zip"'},
                       head_only=head_only)
            return

        if path == "/COMMANDS.txt":
            self._send(200, commands_text(changed_files()).encode("utf-8"),
                       "text/plain; charset=utf-8", head_only=head_only)
            return

        if path == "/health":
            self._send(200, b"ok\n", "text/plain; charset=utf-8", head_only=head_only)
            return

        if path in ("/deploy", "/deploy-send-otp", "/send-otp"):
            self._send(200, deploy_hub_page().encode("utf-8"),
                       "text/html; charset=utf-8", head_only=head_only)
            return

        if path.startswith("/deploy/"):
            tail = urllib.parse.unquote(path[len("/deploy/"):])

            if tail.endswith(".ts"):
                name = tail[:-3]
                rel = f"supabase/functions/{name}/index.ts"
                self._file(rel, "text/plain; charset=utf-8", head_only,
                           {"Content-Disposition": f'attachment; filename="{name}.ts"'})
                return

            html = deploy_function_page(tail.strip("/"))
            if html is None:
                self._send(404, b"404 Not Found\n", "text/plain; charset=utf-8",
                           head_only=head_only)
                return

            self._send(200, html.encode("utf-8"), "text/html; charset=utf-8",
                       head_only=head_only)
            return

        if path in ("/send-otp.ts", "/send-otp-code.ts"):
            self._file("supabase/functions/send-otp/index.ts",
                       "text/plain; charset=utf-8", head_only,
                       {"Content-Disposition": 'attachment; filename="send-otp.ts"'})
            return

        if path in ("/otp-doctor", "/otp-doctor.html", "/tools/otp-doctor"):
            self._file("tools/otp-doctor.html", "text/html; charset=utf-8", head_only)
            return

        if path in ("/profile-doctor", "/profile-doctor.html", "/tools/profile-doctor"):
            self._file("tools/profile-doctor.html", "text/html; charset=utf-8", head_only)
            return

        if path in ("/make-admin", "/make-admin.html", "/tools/make-admin"):
            self._file("tools/make-admin.html", "text/html; charset=utf-8", head_only)
            return

        # ── فایل‌های استاتیک سایت ──
        rel = self._resolve_static(path)
        if not rel:
            self._send(404, b"404 Not Found\n", "text/plain; charset=utf-8", head_only=head_only)
            return

        ext = os.path.splitext(rel)[1].lower()
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".xml": "application/xml; charset=utf-8",
            ".txt": "text/plain; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".ico": "image/x-icon",
            ".woff2": "font/woff2",
        }.get(ext, "application/octet-stream")

        self._file(rel, ctype, head_only)

    def log_message(self, fmt, *args):
        return  # ساکت — فقط خطاها مهم‌اند


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"سرور کارگاه روی پورت {PORT} بالا آمد (ریشه: {REPO})", flush=True)
    print(f"  سایت        → http://localhost:{PORT}/", flush=True)
    print(f"  دانلود      → http://localhost:{PORT}/download", flush=True)
    print(f"  ساخت ادمین  → http://localhost:{PORT}/make-admin", flush=True)
    print(f"  آرشیو Edge → http://localhost:{PORT}/deploy", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
