#!/usr/bin/env python3
"""
add-loader.py — درج لودر سراسری در همه‌ی صفحات سایت

کارهایی که انجام می‌دهد (برای هر صفحه، فقط یک بار):
  ۱) در <head>: فایل CSS لودر + نسخه‌ی no-JS (پنهان) + اسکریپت‌های loader.js
     و site-content.js (ویرایش متن‌ها و عکس‌ها از پنل ادمین)
  ۲) بلافاصله بعد از <body>: مارک‌آپ لودر و نوار پیشرفت

اجرای دوباره‌ی این اسکریپت بی‌خطر است (idempotent).
    python3 scripts/add-loader.py
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

HEAD_BLOCK = """<!-- LOADER:START (خودکار — با scripts/add-loader.py ساخته می‌شود) -->
    <link rel="stylesheet" href="/css/loader.css">
    <noscript><style>#page-loader,#page-loader-bar{display:none !important}</style></noscript>
    <script src="/js/loader.js" defer></script>
    <script src="/js/site-content.js" defer></script>
<!-- LOADER:END -->
"""

BODY_BLOCK = """
<!-- LOADER:START (خودکار — با scripts/add-loader.py ساخته می‌شود) -->
<div id="page-loader-bar" aria-hidden="true"></div>
<div id="page-loader" role="status" aria-live="polite" aria-label="در حال بارگذاری صفحه">
    <div style="position:relative;width:108px;height:108px" class="flex items-center justify-center">
        <span class="pl-ring" aria-hidden="true"></span>
        <div class="pl-mark">
            <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
                <path d="M8 46 24 18l8 14 8-14 16 28" stroke="#fff" stroke-width="6"
                      stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
    </div>
    <p class="pl-text">در حال بارگذاری<span class="pl-dots"><span></span><span></span><span></span></span></p>
</div>
<!-- LOADER:END -->
"""


def pages():
    return sorted(p for p in ROOT.glob("*.html") if p.is_file())


def inject_head(html: str) -> str:
    if "js/loader.js" in html and "js/site-content.js" in html:
        return html

    if "js/loader.js" in html and "js/site-content.js" not in html:
        return html.replace(
            '<script src="/js/loader.js" defer></script>',
            '<script src="/js/loader.js" defer></script>\n'
            '    <script src="/js/site-content.js" defer></script>',
            1,
        )

    if "<!-- SEO:END -->" in html:
        return html.replace("<!-- SEO:END -->", "<!-- SEO:END -->\n" + HEAD_BLOCK, 1)

    return html.replace("</head>", HEAD_BLOCK + "</head>", 1)


def inject_body(html: str) -> str:
    if 'id="page-loader"' in html:
        return html

    m = re.search(r"<body[^>]*>", html)
    if not m:
        return html
    return html[: m.end()] + BODY_BLOCK + html[m.end():]


def main() -> int:
    changed, skipped = [], []

    for path in pages():
        original = path.read_text(encoding="utf-8")
        html = inject_body(inject_head(original))

        if html == original:
            skipped.append(path.name)
            continue

        path.write_text(html, encoding="utf-8")
        changed.append(path.name)

    print(f"✅ لودر به {len(changed)} صفحه اضافه شد:")
    for name in changed:
        print("   •", name)
    if skipped:
        print(f"⏭  {len(skipped)} صفحه از قبل داشت (بدون تغییر): {', '.join(skipped)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
