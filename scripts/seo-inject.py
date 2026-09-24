#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
درج بلاک‌های سئو در صفحات HTML سایت:

  • canonical
  • متای robots (index/noindex)
  • description
  • og: / twitter: (برای اشتراک‌گذاری زیبا در تلگرام و واتساپ)
  • favicon + apple-touch-icon + theme-color
  • داده‌ی ساختاریافته‌ی JSON-LD (Person / EducationalOrganization / WebSite)
  • در صفحه‌ی دوره‌ها: Schema دوره‌های موجود در دیتابیس (فقط برای موتورهای جستجو)

ایمن است: چند بار هم اجرا شود، بلاک تکراری نمی‌سازد.

اجرا:  python3 scripts/seo-inject.py
"""

import json
import pathlib
import re
import sys
import urllib.request

SITE = "https://www.mahdiazizi.com"

# ⚠️ پلیس‌هولدرها — بعداً با مقادیر واقعی جایگزین کنید
PLACEHOLDERS = {
    "TELEGRAM": "https://t.me/MahdiAzizi_math",   # کانال فعلی
    "APARAT": "https://www.aparat.com/",
    "INSTAGRAM": "https://www.instagram.com/",
    "YOUTUBE": "https://www.youtube.com/",
    "PHONE": "+98-21-00000000",
    "MOBILE": "+989120000000",
}

SUPABASE_URL = "https://qbsfotperzzhuimnpmto.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFi"
    "c2ZvdHBlcnp6aHVpbW5wbXRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MTM2NzIsImV4cCI6"
    "MjA5OTI4OTY3Mn0.N8Pv0hz3yKLcTVvwfiRlKW-yEE-d4vc1rkroZBglyTA"
)

# نکته: سایتمپ در فایل ریشه‌ی sitemap.xml نگهداری می‌شود؛
# صفحات تراکنشی (سبد خرید، ورود، داشبورد، پنل) عمداً در آن نیستند.
SITEMAP_NOTE = True

START = "<!-- SEO:START (خودکار — با scripts/seo-inject.py ساخته می‌شود) -->"
END = "<!-- SEO:END -->"

ROOT = pathlib.Path(__file__).resolve().parent.parent

FAVICON = """    <!-- Favicon و آیکون‌ها -->
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" href="/assets/images/favicon-512.png">
    <link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png">
    <meta name="theme-color" content="#4f46e5">"""


def person_jsonld():
    return """    <!-- داده‌ی ساختاریافته: هویت رسمی استاد مهدی عزیزی -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Person",
      "@id": "%(site)s/#mahdi-azizi",
      "name": "مهدی عزیزی",
      "alternateName": ["استاد مهدی عزیزی", "استاد عزیزی", "مهدی عزیزی مدرس ریاضی"],
      "jobTitle": "مدرس ریاضیات و حسابان کنکور",
      "description": "استاد مهدی عزیزی، مدرس ریاضیات و حسابان کنکور؛ دانش‌آموخته‌ی ریاضی محض دانشگاه شهید بهشتی و مؤلف کتاب‌های کمک‌آموزشی، با سال‌ها تدریس ریاضی مقاطع نهم تا دوازدهم.",
      "image": "%(site)s/assets/images/og-cover.jpg",
      "url": "%(site)s/about-us",
      "worksFor": {"@type": "EducationalOrganization", "name": "آکادمی استاد مهدی عزیزی", "url": "%(site)s/"},
      "alumniOf": {"@type": "CollegeOrUniversity", "name": "دانشگاه شهید بهشتی"},
      "knowsAbout": ["ریاضی کنکور تجربی", "حسابان", "ریاضی نهم", "ریاضی دهم", "ریاضی یازدهم", "ریاضی دوازدهم", "آزمون تیزهوشان"],
      "sameAs": ["%(telegram)s", "%(aparat)s", "%(instagram)s", "%(youtube)s"]
    }
    </script>

    <!-- داده‌ی ساختاریافته: آکادمی (سازمان آموزشی) و سایت رسمی -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "EducationalOrganization",
      "@id": "%(site)s/#academy",
      "name": "آکادمی استاد مهدی عزیزی",
      "alternateName": ["آکادمی عزیزی", "آکادمی استاد عزیزی"],
      "url": "%(site)s/",
      "logo": "%(site)s/assets/images/favicon-512.png",
      "image": "%(site)s/assets/images/og-cover.jpg",
      "description": "آکادمی تخصصی ریاضیات استاد مهدی عزیزی؛ پکیج‌های ویدئویی مفهومی و تستی، جزوه و کتاب چاپی، کلاس‌های آنلاین زنده و پشتیبانی آموزشی برای مقاطع نهم تا دوازدهم.",
      "founder": {"@id": "%(site)s/#mahdi-azizi"},
      "areaServed": {"@type": "Country", "name": "Iran"},
      "inLanguage": "fa-IR",
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "پشتیبانی آموزشی",
        "telephone": "%(mobile)s",
        "availableLanguage": ["fa"]
      },
      "sameAs": ["%(telegram)s", "%(aparat)s", "%(instagram)s", "%(youtube)s"]
    }
    </script>

    <!-- داده‌ی ساختاریافته: سایت رسمی (تا نام برند به همین دامنه گره بخورد) -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": "%(site)s/#website",
      "url": "%(site)s/",
      "name": "آکادمی استاد مهدی عزیزی",
      "alternateName": ["سایت رسمی استاد مهدی عزیزی", "آکادمی عزیزی"],
      "inLanguage": "fa-IR",
      "publisher": {"@id": "%(site)s/#academy"},
      "about": {"@id": "%(site)s/#mahdi-azizi"}
    }
    </script>""" % dict(site=SITE, **{k.lower(): v for k, v in PLACEHOLDERS.items()})


def course_jsonld(courses):
    """Schema دوره‌های آموزشی موجود در دیتابیس (فقط برای موتور جستجو)."""
    if not courses:
        return ""

    items = []
    for c in courses:
        name = str(c.get("title") or "").strip()
        if not name:
            continue

        price = c.get("discount_price") or c.get("price") or 0
        try:
            price = int(float(price))
        except (TypeError, ValueError):
            price = 0

        item = {
            "@type": "Course",
            "name": name,
            "description": str(c.get("description") or name)[:300],
            "inLanguage": "fa-IR",
            "url": f"{SITE}/courses-detail?id={c.get('id')}",
            "provider": {"@id": f"{SITE}/#academy"},
            "offers": {
                "@type": "Offer",
                "price": price,
                "priceCurrency": "IRR",
                "category": "پرداخت یک‌باره",
                "availability": "https://schema.org/InStock",
                "url": f"{SITE}/courses-detail?id={c.get('id')}",
            },
        }

        if c.get("image_url"):
            item["image"] = str(c["image_url"]).strip()

        grade = c.get("grade")
        if grade:
            item["educationalLevel"] = f"پایه {grade}"

        major = c.get("major")
        if major:
            item["about"] = str(major)

        items.append(item)

    if not items:
        return ""

    return (
        '    <!-- داده‌ی ساختاریافته: دوره‌ها و جزوه‌ها -->\n'
        '    <script type="application/ld+json">\n'
        "    "
        + json.dumps({"@context": "https://schema.org", "@graph": items}, ensure_ascii=False, indent=2).replace("\n", "\n    ")
        + "\n    </script>"
    )


def build_block(cfg):
    lines = [START]

    if cfg.get("noindex"):
        lines.append('    <meta name="robots" content="noindex, nofollow">')
        lines += [FAVICON, END]
        return "\n".join(lines) + "\n"

    url = cfg.get("canonical")
    title = cfg["title"]
    desc = cfg["description"]

    if url:
        lines.append(f'    <link rel="canonical" href="{url}">')

    lines += [
        '    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">',
        f'    <meta name="description" content="{desc}">',
        "",
        "    <!-- اشتراک‌گذاری در تلگرام / واتساپ / توییتر -->",
        '    <meta property="og:type" content="website">',
        '    <meta property="og:site_name" content="آکادمی استاد مهدی عزیزی">',
        '    <meta property="og:locale" content="fa_IR">',
        f'    <meta property="og:title" content="{title}">',
        f'    <meta property="og:description" content="{desc}">',
        f'    <meta property="og:url" content="{url}">',
        f'    <meta property="og:image" content="{SITE}/assets/images/og-cover.jpg">',
        '    <meta property="og:image:width" content="1200">',
        '    <meta property="og:image:height" content="630">',
        '    <meta property="og:image:alt" content="استاد مهدی عزیزی — دبیر ریاضیات">',
        '    <meta name="twitter:card" content="summary_large_image">',
        f'    <meta name="twitter:title" content="{title}">',
        f'    <meta name="twitter:description" content="{desc}">',
        f'    <meta name="twitter:image" content="{SITE}/assets/images/og-cover.jpg">',
        "",
        FAVICON,
    ]

    if cfg.get("person"):
        lines += ["", person_jsonld()]

    if cfg.get("courses_jsonld"):
        block = course_jsonld(fetch_courses())
        if block:
            lines += ["", block]

    lines.append(END)
    return "\n".join(lines) + "\n"


COURSES_FILE = ROOT / "scripts" / "seo-courses.json"


def fetch_courses():
    """اول از فایل محلی (اسنپ‌شات) و اگر نبود از API می‌خواند."""
    if COURSES_FILE.exists():
        try:
            data = json.loads(COURSES_FILE.read_text(encoding="utf-8"))
            print(f"  · {len(data)} دوره از {COURSES_FILE.name} خوانده شد")
            return data
        except Exception as exc:  # noqa: BLE001
            print(f"  ! خواندن {COURSES_FILE.name} ممکن نشد ({exc})")

    try:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/courses?select=id,title,description,grade,major,"
            "price,discount_price,image_url,type&limit=60",
            headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read().decode())
    except Exception as exc:  # noqa: BLE001
        print(f"  ! دریافت دوره‌ها ممکن نشد ({exc}) — Schema دوره‌ها رد شد")
        return []


PAGES = {
    "index.html": {
        "canonical": f"{SITE}/",
        "title": "آکادمی استاد مهدی عزیزی | آموزش مفهومی ریاضیات نهم تا دوازدهم",
        "description": "آکادمی رسمی استاد مهدی عزیزی؛ پکیج‌های ویدئویی مفهومی و تستی ریاضی نهم تا دوازدهم، جزوه و کتاب چاپی با ارسال پستی، کلاس‌های آنلاین زنده و پشتیبانی تا روز امتحان.",
        "person": True,
    },
    "courses.html": {
        "canonical": f"{SITE}/courses",
        "title": "دوره‌ها، جزوه‌ها و کتاب‌های ریاضی | آکادمی استاد مهدی عزیزی",
        "brand_first": True,
        "description": "لیست کامل پکیج‌های آموزشی ریاضی استاد مهدی عزیزی برای پایه‌های نهم، دهم، یازدهم و دوازدهم (تجربی و ریاضی)؛ دوره‌های ویدئویی، جزوه‌های PDF و کتاب چاپی.",
        "person": True,
        "courses_jsonld": True,
    },
    "about-us.html": {
        "canonical": f"{SITE}/about-us",
        "title": "درباره استاد مهدی عزیزی | رزومه و روش تدریس",
        "description": "درباره استاد مهدی عزیزی، مدرس ریاضیات و حسابان کنکور؛ دانش‌آموخته‌ی ریاضی محض دانشگاه شهید بهشتی، مؤلف کتاب‌های کمک‌آموزشی و بنیان‌گذار آکادمی عزیزی.",
        "person": True,
    },
    "courses-detail.html": {
        # صفحه‌ی پویا: canonical و Schema‌ی هر دوره با جاوااسکریپت (js/courses-detail.js) ست می‌شود
        "canonical": None,
        "title": "جزئیات دوره و جزوه‌ی ریاضی | آکادمی استاد مهدی عزیزی",
        "description": "مشخصات کامل دوره‌ی ریاضی استاد مهدی عزیزی: سرفصل‌ها، جلسات آنلاین، جزوه‌ها و شرایط خرید؛ دسترسی فوری پس از پرداخت.",
        "person": True,
    },
    "cart.html": {
        "canonical": f"{SITE}/cart",
        "sitemap": False,
        "title": "سبد خرید | آکادمی استاد مهدی عزیزی",
        "description": "سبد خرید آکادمی استاد مهدی عزیزی — پرداخت امن از درگاه بانکی و دسترسی فوری به دوره‌ها پس از پرداخت.",
    },
    "login.html": {
        "canonical": f"{SITE}/login",
        "title": "ورود به حساب کاربری | آکادمی استاد مهدی عزیزی",
        "description": "ورود دانش‌آموزان آکادمی استاد مهدی عزیزی با شماره موبایل و رمز عبور.",
    },
    "register.html": {
        "canonical": f"{SITE}/register",
        "title": "ثبت‌نام در آکادمی | آکادمی استاد مهدی عزیزی",
        "description": "ثبت‌نام سریع با شماره موبایل در آکادمی استاد مهدی عزیزی و دسترسی به دوره‌ها، جزوه‌ها و کلاس‌های آنلاین ریاضی.",
    },
    "complete-profile.html": {
        "canonical": f"{SITE}/complete-profile",
        "title": "تکمیل پروفایل | آکادمی استاد مهدی عزیزی",
        "description": "تکمیل اطلاعات پروفایل تحصیلی دانش‌آموز (پایه و رشته) در آکادمی استاد مهدی عزیزی.",
    },
    # صفحات خصوصی/پنل — نباید در گوگل بیایند
    "dashboard.html": {"noindex": True},
    "payment-result.html": {"noindex": True},
    "shipping-address.html": {"noindex": True},
    "admin.html": {"noindex": True},
    "admin-login.html": {"noindex": True},
    "admin-courses.html": {"noindex": True},
    "test-api.html": {"noindex": True},
}


def main():
    changed = 0

    for name, cfg in PAGES.items():
        path = ROOT / name
        if not path.exists():
            print(f"— {name}: پیدا نشد (رد شد)")
            continue

        html = path.read_text(encoding="utf-8")

        # بلاک قبلی را پاک کن تا اجرای دوباره، تکراری نسازد
        html = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\s*", "", html, flags=re.S)

        block = build_block(cfg)

        if "</head>" not in html:
            print(f"! {name}: تگ </head> پیدا نشد")
            continue

        html = html.replace("</head>", block + "</head>", 1)
        path.write_text(html, encoding="utf-8")
        changed += 1

        kind = "noindex" if cfg.get("noindex") else "index"
        print(f"✓ {name} ({kind})")

    print(f"\n{changed} صفحه به‌روزرسانی شد.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
