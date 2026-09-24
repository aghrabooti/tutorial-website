#!/usr/bin/env python3
"""
add-content-keys.py — علامت‌گذاری متن‌ها و عکس‌های سایت برای ویرایش از پنل ادمین

به هر متن/عکسِ قابل‌ویرایش یک «کلید» می‌دهد (data-content / data-content-img)
تا پنل ادمین بتواند مقدار آن را عوض کند. کلیدها با js/content-manifest.js
یکی هستند.

اجرای دوباره بی‌خطر است: اگر کلیدی از قبل باشد، دوباره اضافه نمی‌شود.
    python3 scripts/add-content-keys.py
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

stats = {"ok": 0, "skip": 0, "miss": 0}
problems = []


def sub(html: str, old: str, new: str, label: str, nth: int = 0) -> str:
    """جایگزینی یک متن مشخص با نسخه‌ی کلیددار (با بررسی تعداد تکرار)"""
    count = html.count(old)

    # اگر خودِ متن جدید در فایل باشد، یا attribute قبل از این متن نشسته باشد،
    # یعنی قبلاً انجام شده → دوباره اضافه نکن
    prefix = new[:-len(old)] if new.endswith(old) else None
    m = re.search(r'data-content(?:-img|-type)?="([^"]+)"', new)
    key_present = bool(m) and f'data-content="{m.group(1)}"' in html

    if new in html or key_present or (prefix and (prefix + old) in html):
        stats["skip"] += 1
        return html

    if count == 0:
        stats["miss"] += 1
        problems.append(f"پیدا نشد: {label}")
        return html

    if count == 1:
        stats["ok"] += 1
        return html.replace(old, new, 1)

    # چند تکرار → فقط مورد nth را عوض می‌کنیم (بقیه دست‌نخورده)
    if nth >= count:
        problems.append(f"تعداد تکرار کافی نیست: {label} ({count} مورد)")
        stats["miss"] += 1
        return html

    idx = -1
    for _ in range(nth + 1):
        idx = html.find(old, idx + 1)

    stats["ok"] += 1
    return html[:idx] + new + html[idx + len(old):]


def keyed(tag_line: str, attr: str) -> str:
    """یک attribute به تگ می‌افزاید (قبل از علامت >)"""
    return tag_line[:-1] + f' {attr}>'


# ═══════════════════════════════════════════════════════════════════════
# ۱) صفحه اصلی
# ═══════════════════════════════════════════════════════════════════════

def index_page(html: str) -> str:
    # بج بالای عنوان
    html = sub(html,
        "\n                        ⚡ آکادمی تخصصی ریاضیات — نهم تا دوازدهم\n",
        '\n                        <span data-content="home.badge">⚡ آکادمی تخصصی ریاضیات — نهم تا دوازدهم</span>\n',
        "home.badge")

    # عنوان اصلی (دو خط)
    html = sub(html,
        """                        ریاضی رو این‌بار
                        <span class="grad-text">واقعاً یاد بگیر</span>""",
        """                        <span data-content="home.title_1">ریاضی رو این‌بار</span>
                        <span class="grad-text" data-content="home.title_2">واقعاً یاد بگیر</span>""",
        "home.title")

    # توضیح زیر عنوان
    html = sub(html,
        '<p class="reveal text-gray-500 text-sm sm:text-base lg:text-lg font-medium leading-relaxed max-w-2xl mx-auto lg:mx-0" style="--d:.2s">',
        '<p class="reveal text-gray-500 text-sm sm:text-base lg:text-lg font-medium leading-relaxed max-w-2xl mx-auto lg:mx-0" style="--d:.2s" data-content="home.subtitle" data-content-type="html">',
        "home.subtitle")

    # دکمه‌ها
    html = sub(html,
        "                            مشاهده پکیج‌های آموزشی\n",
        '                            <span data-content="home.cta_primary">مشاهده پکیج‌های آموزشی</span>\n',
        "home.cta_primary")

    html = sub(html,
        "                            چرا آکادمی عزیزی؟\n",
        '                            <span data-content="home.cta_secondary">چرا آکادمی عزیزی؟</span>\n',
        "home.cta_secondary")

    # آمارها
    html = sub(html,
        '<span data-count="1500">۰</span>',
        '<span data-count="1500" data-content="home.stat_students" data-content-type="counter">۰</span>',
        "home.stat_students")

    html = sub(html,
        '<span data-count="300">۰</span>',
        '<span data-count="300" data-content="home.stat_hours" data-content-type="counter">۰</span>',
        "home.stat_hours")

    html = sub(html,
        '<span data-count="96">۰</span>',
        '<span data-count="96" data-content="home.stat_satisfaction" data-content-type="counter">۰</span>',
        "home.stat_satisfaction")

    html = sub(html,
        ">دانش‌آموز فعال</div>",
        ' data-content="home.stat_students_label">دانش‌آموز فعال</div>',
        "home.stat_students_label")

    html = sub(html,
        ">ساعت آموزش ویدئویی</div>",
        ' data-content="home.stat_hours_label">ساعت آموزش ویدئویی</div>',
        "home.stat_hours_label")

    html = sub(html,
        ">رضایت دانش‌آموزان</div>",
        ' data-content="home.stat_satisfaction_label">رضایت دانش‌آموزان</div>',
        "home.stat_satisfaction_label")

    # عکس هدر
    html = sub(html,
        '                            src="/assets/images/professor-cutout.webp"\n',
        '                            src="/assets/images/professor-cutout.webp"\n                            data-content-img="home.hero_image"\n',
        "home.hero_image")

    # ── بخش دوره‌ها ──
    html = sub(html,
        '>پکیج‌های آموزشی</span>',
        ' data-content="home.courses_tag">پکیج‌های آموزشی</span>',
        "home.courses_tag")

    html = sub(html,
        ">جدیدترین دوره‌ها، جزوه‌ها و کتاب‌ها</h2>",
        ' data-content="home.courses_title">جدیدترین دوره‌ها، جزوه‌ها و کتاب‌ها</h2>',
        "home.courses_title")

    html = sub(html,
        ">با بروزترین منابع مطابق سوالات کنکور و امتحانات نهایی</p>",
        ' data-content="home.courses_subtitle">با بروزترین منابع مطابق سوالات کنکور و امتحانات نهایی</p>',
        "home.courses_subtitle")

    html = sub(html,
        "                    مشاهده همه‌ی پکیج‌ها\n",
        '                    <span data-content="home.courses_cta">مشاهده همه‌ی پکیج‌ها</span>\n',
        "home.courses_cta")

    # ── معرفی استاد (متن سئو) ──
    html = sub(html,
        '<h2 class="text-xl sm:text-2xl font-black text-gray-950">آکادمی رسمی استاد مهدی عزیزی</h2>',
        '<h2 class="text-xl sm:text-2xl font-black text-gray-950" data-content="home.intro_title">آکادمی رسمی استاد مهدی عزیزی</h2>',
        "home.intro_title")

    html = sub(html,
        """        <p class="mt-3 text-sm sm:text-[15px] leading-relaxed text-gray-600">
            این سایت، آکادمی رسمی""",
        """        <p class="mt-3 text-sm sm:text-[15px] leading-relaxed text-gray-600" data-content="home.intro_p1" data-content-type="html">
            این سایت، آکادمی رسمی""",
        "home.intro_p1")

    html = sub(html,
        """        <p class="mt-3 text-sm sm:text-[15px] leading-relaxed text-gray-600">
            اگر می‌خواهید""",
        """        <p class="mt-3 text-sm sm:text-[15px] leading-relaxed text-gray-600" data-content="home.intro_p2" data-content-type="html">
            اگر می‌خواهید""",
        "home.intro_p2")

    # ── چهار ویژگی ──
    html = sub(html,
        '>چرا آکادمی عزیزی؟</span>',
        ' data-content="home.features_tag">چرا آکادمی عزیزی؟</span>',
        "home.features_tag")

    html = sub(html,
        ">همه‌چیز برای یک یادگیری کامل</h2>",
        ' data-content="home.features_title">همه‌چیز برای یک یادگیری کامل</h2>',
        "home.features_title")

    html = sub(html,
        ">فقط ویدئو نیست؛ یک مسیر کامل یادگیری با ابزارها و پشتیبانی واقعی</p>",
        ' data-content="home.features_subtitle">فقط ویدئو نیست؛ یک مسیر کامل یادگیری با ابزارها و پشتیبانی واقعی</p>',
        "home.features_subtitle")

    features = [
        ("1", "تدریس مفهومی و قدم‌به‌قدم",
         "از پایه تا تست‌های ترکیبی کنکور؛ هر جلسه با مثال‌های تمرینی و نکته‌برداری."),
        ("2", "جزوه و منابع کامل",
         "جزوه‌های PDF منظم هر فصل + نسخه‌ی چاپی کتاب و جزوه که به درب خانه ارسال می‌شود."),
        ("3", "کلاس‌های آنلاین زنده",
         "جلسات زنده با زمان‌بندی مشخص؛ لینک کلاس دقیقاً چند دقیقه قبل شروع برایت فعال می‌شود."),
        ("4", "پشتیبانی و رفع اشکال",
         "هر سوالی داشتی می‌پرسی؛ تا روز امتحان کنارت هستیم، نه فقط تا لحظه‌ی خرید."),
    ]

    for n, title, desc in features:
        html = sub(html,
            f'<h3 class="font-black text-gray-950 mt-5">{title}</h3>',
            f'<h3 class="font-black text-gray-950 mt-5" data-content="home.feature{n}_title">{title}</h3>',
            f"home.feature{n}_title")

        html = sub(html,
            f'<p class="text-xs sm:text-sm text-gray-500 leading-relaxed mt-2.5">{desc}</p>',
            f'<p class="text-xs sm:text-sm text-gray-500 leading-relaxed mt-2.5" data-content="home.feature{n}_desc">{desc}</p>',
            f"home.feature{n}_desc")

    # ── مسیر شروع ──
    html = sub(html,
        '>شروع در ۳ قدم</span>',
        ' data-content="home.steps_tag">شروع در ۳ قدم</span>',
        "home.steps_tag")

    html = sub(html,
        ">از ثبت‌نام تا نمره‌ی عالی</h2>",
        ' data-content="home.steps_title">از ثبت‌نام تا نمره‌ی عالی</h2>',
        "home.steps_title")

    steps = [
        ("1", "ثبت‌نام رایگان",
         "با شماره موبایلت در چند ثانیه ثبت‌نام کن و پروفایل تحصیلی‌ات را کامل کن."),
        ("2", "انتخاب و خرید پکیج",
         "دوره، جزوه یا کتاب موردنیازت را به سبد اضافه کن و امن از درگاه بانکی پرداخت کن."),
        ("3", "شروع یادگیری",
         "بلافاصله بعد از پرداخت، دوره‌ها در داشبوردت باز می‌شوند؛ جزوه‌ها هم دانلودی، هم پستی."),
    ]

    for n, title, desc in steps:
        html = sub(html,
            f'<h3 class="font-black text-gray-950">{title}</h3>',
            f'<h3 class="font-black text-gray-950" data-content="home.step{n}_title">{title}</h3>',
            f"home.step{n}_title")

        html = sub(html,
            f'<p class="text-xs sm:text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">{desc}</p>',
            f'<p class="text-xs sm:text-sm text-gray-500 leading-relaxed max-w-xs mx-auto" data-content="home.step{n}_desc">{desc}</p>',
            f"home.step{n}_desc")

    return html


# ═══════════════════════════════════════════════════════════════════════
# ۲) صفحه درباره ما
# ═══════════════════════════════════════════════════════════════════════

def about_page(html: str) -> str:
    html = sub(html,
        """                    درباره‌ی آکادمی
                    <span class="text-indigo-600">استاد مهدی عزیزی</span>""",
        """                    <span data-content="about.title_1">درباره‌ی آکادمی</span>
                    <span class="text-indigo-600" data-content="about.title_accent">استاد مهدی عزیزی</span>""",
        "about.title")

    html = sub(html,
        """                <p class="text-gray-500 text-sm sm:text-base font-medium leading-loose">
                    آکادمی عزیزی با هدف""",
        """                <p class="text-gray-500 text-sm sm:text-base font-medium leading-loose" data-content="about.lead" data-content-type="html">
                    آکادمی عزیزی با هدف""",
        "about.lead")

    html = sub(html,
        """                <p class="text-gray-500 text-sm sm:text-base font-medium leading-loose">
                    هر پکیج آموزشی""",
        """                <p class="text-gray-500 text-sm sm:text-base font-medium leading-loose" data-content="about.lead2">
                    هر پکیج آموزشی""",
        "about.lead2")

    html = sub(html,
        '                    src="/assets/images/about-photo-900.jpg"\n',
        '                    src="/assets/images/about-photo-900.jpg"\n                    data-content-img="about.photo"\n',
        "about.photo")

    # رزومه
    html = sub(html,
        """        <h2 class="text-2xl sm:text-3xl font-black text-gray-950">
            استاد مهدی عزیزی، مدرس ریاضیات و حسابان کنکور
        </h2>""",
        """        <h2 class="text-2xl sm:text-3xl font-black text-gray-950" data-content="about.resume_title">
            استاد مهدی عزیزی، مدرس ریاضیات و حسابان کنکور
        </h2>""",
        "about.resume_title")

    html = sub(html,
        """        <p class="mt-4 text-sm sm:text-base text-gray-600 leading-loose">
            <strong>استاد مهدی عزیزی</strong>""",
        """        <p class="mt-4 text-sm sm:text-base text-gray-600 leading-loose" data-content="about.resume_p1" data-content-type="html">
            <strong>استاد مهدی عزیزی</strong>""",
        "about.resume_p1")

    html = sub(html,
        """        <p class="mt-3 text-sm sm:text-base text-gray-600 leading-loose">
            حاصل این مسیر""",
        """        <p class="mt-3 text-sm sm:text-base text-gray-600 leading-loose" data-content="about.resume_p2">
            حاصل این مسیر""",
        "about.resume_p2")

    # چهار کارت آمار (چهار تگ یکسان → هر بار «اولین موردِ کلیدنگرفته»)
    for key in ["years", "students", "hours", "packages"]:
        html = sub(html,
            '<div class="text-2xl font-black text-indigo-600">NN</div>',
            f'<div class="text-2xl font-black text-indigo-600" data-content="about.stat_{key}">NN</div>',
            f"about.stat_{key}", nth=0)

    return html


# ═══════════════════════════════════════════════════════════════════════
# ۳) صفحه دوره‌ها
# ═══════════════════════════════════════════════════════════════════════

def courses_page(html: str) -> str:
    html = sub(html,
        '<h1 class="text-3xl md:text-4xl font-black text-gray-900">فروشگاه محصولات آموزشی</h1>',
        '<h1 class="text-3xl md:text-4xl font-black text-gray-900" data-content="courses.title">فروشگاه محصولات آموزشی</h1>',
        "courses.title")

    html = sub(html,
        '<p class="text-gray-500 mt-2 text-sm md:text-base">دوره‌ها و بسته‌های آموزشی آکادمی ریاضی مهدی عزیزی</p>',
        '<p class="text-gray-500 mt-2 text-sm md:text-base" data-content="courses.subtitle">دوره‌ها و بسته‌های آموزشی آکادمی ریاضی مهدی عزیزی</p>',
        "courses.subtitle")

    return html


# ═══════════════════════════════════════════════════════════════════════
# ۴) فوتر مشترک
# ═══════════════════════════════════════════════════════════════════════

def footer_component(html: str) -> str:
    html = sub(html,
        """                آکادمی <span class="text-indigo-600">عزیزی</span>""",
        """                <span data-content="footer.brand_1">آکادمی</span> <span class="text-indigo-600" data-content="footer.brand_2">عزیزی</span>""",
        "footer.brand")

    html = sub(html,
        "            تمامی حقوق مادی و معنوی برای آکادمی استاد مهدی عزیزی محفوظ است.",
        '            <span data-content="footer.copyright">تمامی حقوق مادی و معنوی برای آکادمی استاد مهدی عزیزی محفوظ است.</span>',
        "footer.copyright")

    html = sub(html,
        "                نمونه تدریس‌های رایگان در",
        '                <span data-content="footer.free_hint">نمونه تدریس‌های رایگان در</span>',
        "footer.free_hint")

    return html


# ═══════════════════════════════════════════════════════════════════════

TARGETS = {
    "index.html": index_page,
    "about-us.html": about_page,
    "courses.html": courses_page,
    "components/footer.html": footer_component,
}


def main() -> int:
    for rel, fn in TARGETS.items():
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        updated = fn(original)

        if updated != original:
            path.write_text(updated, encoding="utf-8")
            print(f"✏️  {rel} به‌روزرسانی شد")
        else:
            print(f"⏭  {rel} از قبل کلید داشت")

    print(f"\nکلیدهای اضافه‌شده: {stats['ok']} | از قبل بود: {stats['skip']} | پیدا نشد: {stats['miss']}")

    if problems:
        print("\nموارد نیازمند بررسی:")
        for p in problems:
            print("  ✗", p)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
