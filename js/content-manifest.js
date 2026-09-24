/* ─────────────────────────────────────────────────────────────
   content-manifest.js — فهرست همه‌ی متن‌ها و عکس‌های قابل ویرایش سایت
   این فایل هم در سایت (js/site-content.js) و هم در پنل ادمین
   (js/admin-content.js) استفاده می‌شود، تا فهرست ویرایش‌ها یک‌جا بمانَد.

   type:
     "text"    → متن ساده (تگ‌های HTML به‌صورت متن نشان داده می‌شوند)
     "html"    → متن با تگ ساده (<strong>، <a>) — با احتیاط ویرایش شود
     "counter" → عددِ انیمیشنی (مثل «۱۵۰۰+ دانش‌آموز»)
     "image"   → آدرس تصویر (از پنل آپلود می‌شود)
   ───────────────────────────────────────────────────────────── */
window.SITE_CONTENT_MANIFEST = {
    version: 1,

    groups: [
        {
            id: "home-hero",
            title: "صفحه اصلی — بخش اول (هدر)",
            hint: "اولین چیزی که بازدیدکننده می‌بیند",
            items: [
                { key: "home.badge", label: "نوار کوچک بالای عنوان", type: "text",
                  default: "⚡ آکادمی تخصصی ریاضیات — نهم تا دوازدهم" },
                { key: "home.title_1", label: "عنوان اصلی — خط اول", type: "text",
                  default: "ریاضی رو این‌بار" },
                { key: "home.title_2", label: "عنوان اصلی — خط دوم (رنگی)", type: "text",
                  default: "واقعاً یاد بگیر" },
                { key: "home.subtitle", label: "توضیح زیر عنوان", type: "html",
                  default: "پکیج‌های ویدئویی مفهومی و تستی استاد مهدی عزیزی برای مقاطع نهم تا دوازدهم؛ به‌همراه جزوه‌های کامل، کلاس‌های آنلاین زنده و پشتیبانی واقعی تا روز امتحان." },
                { key: "home.cta_primary", label: "دکمه‌ی اصلی", type: "text",
                  default: "مشاهده پکیج‌های آموزشی" },
                { key: "home.cta_secondary", label: "دکمه‌ی دوم", type: "text",
                  default: "چرا آکادمی عزیزی؟" },
                { key: "home.hero_image", label: "عکس استاد در هدر", type: "image",
                  default: "/assets/images/professor-cutout.webp" },
                { key: "home.stat_students", label: "آمار ۱ — عدد", type: "counter",
                  default: "1500" },
                { key: "home.stat_students_label", label: "آمار ۱ — برچسب", type: "text",
                  default: "دانش‌آموز فعال" },
                { key: "home.stat_hours", label: "آمار ۲ — عدد", type: "counter",
                  default: "300" },
                { key: "home.stat_hours_label", label: "آمار ۲ — برچسب", type: "text",
                  default: "ساعت آموزش ویدئویی" },
                { key: "home.stat_satisfaction", label: "آمار ۳ — عدد", type: "counter",
                  default: "96" },
                { key: "home.stat_satisfaction_label", label: "آمار ۳ — برچسب", type: "text",
                  default: "رضایت دانش‌آموزان" },
            ],
        },

        {
            id: "home-courses",
            title: "صفحه اصلی — بخش دوره‌ها",
            items: [
                { key: "home.courses_tag", label: "برچسب بالای عنوان", type: "text",
                  default: "پکیج‌های آموزشی" },
                { key: "home.courses_title", label: "عنوان بخش", type: "text",
                  default: "جدیدترین دوره‌ها، جزوه‌ها و کتاب‌ها" },
                { key: "home.courses_subtitle", label: "توضیح بخش", type: "text",
                  default: "با بروزترین منابع مطابق سوالات کنکور و امتحانات نهایی" },
                { key: "home.courses_cta", label: "لینک «مشاهده همه»", type: "text",
                  default: "مشاهده همه‌ی پکیج‌ها" },
            ],
        },

        {
            id: "home-intro",
            title: "صفحه اصلی — معرفی استاد (متن سئو)",
            hint: "این بخش مهم‌ترین جای متن برای گوگل است؛ کلیدواژه‌ها را نگه دارید",
            items: [
                { key: "home.intro_title", label: "عنوان", type: "text",
                  default: "آکادمی رسمی استاد مهدی عزیزی" },
                { key: "home.intro_p1", label: "پاراگراف اول", type: "html",
                  default: "این سایت، آکادمی رسمی <strong>استاد مهدی عزیزی</strong>، مدرس ریاضیات و حسابان کنکور است. دوره‌های ریاضی نهم، دهم، یازدهم و دوازدهم (رشته‌های تجربی و ریاضی) به‌صورت ویدئویی مفهومی و تستی، همراه با جزوه‌های PDF، کتاب و جزوه‌ی چاپی ارسالی به سراسر کشور، کلاس‌های آنلاین زنده و پشتیبانی آموزشی تا روز امتحان ارائه می‌شوند." },
                { key: "home.intro_p2", label: "پاراگراف دوم", type: "html",
                  default: "اگر می‌خواهید با سابقه‌ی تدریس، روش کار و جزئیات پکیج‌ها بیشتر آشنا شوید، صفحه‌ی <a href=\"/about-us\" class=\"text-indigo-600 font-bold hover:underline\">درباره استاد مهدی عزیزی</a> و بخش <a href=\"/courses\" class=\"text-indigo-600 font-bold hover:underline\">دوره‌های آموزشی</a> را ببینید." },
            ],
        },

        {
            id: "home-features",
            title: "صفحه اصلی — چهار ویژگی",
            items: [
                { key: "home.features_tag", label: "برچسب بالای عنوان", type: "text",
                  default: "چرا آکادمی عزیزی؟" },
                { key: "home.features_title", label: "عنوان بخش", type: "text",
                  default: "همه‌چیز برای یک یادگیری کامل" },
                { key: "home.features_subtitle", label: "توضیح بخش", type: "text",
                  default: "فقط ویدئو نیست؛ یک مسیر کامل یادگیری با ابزارها و پشتیبانی واقعی" },
                { key: "home.feature1_title", label: "ویژگی ۱ — عنوان", type: "text",
                  default: "تدریس مفهومی و قدم‌به‌قدم" },
                { key: "home.feature1_desc", label: "ویژگی ۱ — توضیح", type: "text",
                  default: "از پایه تا تست‌های ترکیبی کنکور؛ هر جلسه با مثال‌های تمرینی و نکته‌برداری." },
                { key: "home.feature2_title", label: "ویژگی ۲ — عنوان", type: "text",
                  default: "جزوه و منابع کامل" },
                { key: "home.feature2_desc", label: "ویژگی ۲ — توضیح", type: "text",
                  default: "جزوه‌های PDF منظم هر فصل + نسخه‌ی چاپی کتاب و جزوه که به درب خانه ارسال می‌شود." },
                { key: "home.feature3_title", label: "ویژگی ۳ — عنوان", type: "text",
                  default: "کلاس‌های آنلاین زنده" },
                { key: "home.feature3_desc", label: "ویژگی ۳ — توضیح", type: "text",
                  default: "جلسات زنده با زمان‌بندی مشخص؛ لینک کلاس دقیقاً چند دقیقه قبل شروع برایت فعال می‌شود." },
                { key: "home.feature4_title", label: "ویژگی ۴ — عنوان", type: "text",
                  default: "پشتیبانی و رفع اشکال" },
                { key: "home.feature4_desc", label: "ویژگی ۴ — توضیح", type: "text",
                  default: "هر سوالی داشتی می‌پرسی؛ تا روز امتحان کنارت هستیم، نه فقط تا لحظه‌ی خرید." },
            ],
        },

        {
            id: "home-steps",
            title: "صفحه اصلی — مسیر شروع در ۳ قدم",
            items: [
                { key: "home.steps_tag", label: "برچسب بالای عنوان", type: "text",
                  default: "شروع در ۳ قدم" },
                { key: "home.steps_title", label: "عنوان بخش", type: "text",
                  default: "از ثبت‌نام تا نمره‌ی عالی" },
                { key: "home.step1_title", label: "قدم ۱ — عنوان", type: "text",
                  default: "ثبت‌نام رایگان" },
                { key: "home.step1_desc", label: "قدم ۱ — توضیح", type: "text",
                  default: "با شماره موبایلت در چند ثانیه ثبت‌نام کن و پروفایل تحصیلی‌ات را کامل کن." },
                { key: "home.step2_title", label: "قدم ۲ — عنوان", type: "text",
                  default: "انتخاب و خرید پکیج" },
                { key: "home.step2_desc", label: "قدم ۲ — توضیح", type: "text",
                  default: "دوره، جزوه یا کتاب موردنیازت را به سبد اضافه کن و امن از درگاه بانکی پرداخت کن." },
                { key: "home.step3_title", label: "قدم ۳ — عنوان", type: "text",
                  default: "شروع یادگیری" },
                { key: "home.step3_desc", label: "قدم ۳ — توضیح", type: "text",
                  default: "دسترسی به ویدئوها، جزوه‌ها و کلاس‌های زنده بلافاصله فعال می‌شود." },
            ],
        },

        {
            id: "about",
            title: "صفحه درباره ما",
            items: [
                { key: "about.title_1", label: "عنوان صفحه — خط اول", type: "text",
                  default: "درباره‌ی آکادمی" },
                { key: "about.title_accent", label: "عنوان صفحه — بخش رنگی", type: "text",
                  default: "استاد مهدی عزیزی" },
                { key: "about.lead", label: "پاراگراف معرفی", type: "html",
                  default: "آکادمی عزیزی با هدف آموزش مفهومی و عمیق ریاضیات دوره‌ی متوسطه شکل گرفته است. تمرکز ما بر این است که دانش‌آموز به‌جای حفظ‌کردن، <b>فهمیدن</b> را تجربه کند — با درسنامه‌های روان، حل تست‌های هدفمند، و پوشش کامل مقاطع نهم، دهم، یازدهم و دوازدهم برای رشته‌های ریاضی و تجربی." },
                { key: "about.lead2", label: "پاراگراف دوم معرفی", type: "text",
                  default: "هر پکیج آموزشی همراه با ویدیوهای مرحله‌به‌مرحله، جزوات اختصاصی، و امکان رفع اشکال ارائه می‌شود تا مسیر یادگیری برای هر دانش‌آموز روشن و بدون‌سد باشد." },
                { key: "about.photo", label: "عکس اصلی صفحه", type: "image",
                  default: "/assets/images/about-photo-900.jpg" },
                { key: "about.resume_title", label: "عنوان بخش رزومه", type: "text",
                  default: "استاد مهدی عزیزی، مدرس ریاضیات و حسابان کنکور" },
                { key: "about.resume_p1", label: "رزومه — پاراگراف اول", type: "html",
                  default: "<strong>استاد مهدی عزیزی</strong> مدرس ریاضیات و حسابان آزمون سراسری، دانش‌آموخته‌ی کارشناسی ریاضی محض دانشگاه شهید بهشتی و مؤلف کتاب‌های کمک‌آموزشی است. ایشان سال‌هاست در مدارس و آموزشگاه‌های معتبر تدریس می‌کنند و تمرکزشان بر <strong>آموزش مفهومی ریاضیات</strong> همراه با حل تست‌های هدفمند برای کنکور و امتحانات نهایی است." },
                { key: "about.resume_p2", label: "رزومه — پاراگراف دوم", type: "text",
                  default: "حاصل این مسیر، آکادمی عزیزی است: پکیج‌های آموزشی ویدئویی برای پایه‌های نهم، دهم، یازدهم و دوازدهم (رشته‌های ریاضی و تجربی)، جزوه‌های اختصاصی، کتاب و جزوه‌ی چاپی ارسالی به سراسر ایران، کلاس‌های آنلاین زنده و پشتیبانی آموزشی تا روز امتحان." },
                { key: "about.stat_years", label: "کارت آمار ۱ (سال سابقه)", type: "text",
                  default: "NN" },
                { key: "about.stat_students", label: "کارت آمار ۲ (دانش‌آموز)", type: "text",
                  default: "NN" },
                { key: "about.stat_hours", label: "کارت آمار ۳ (ساعت آموزش)", type: "text",
                  default: "NN" },
                { key: "about.stat_packages", label: "کارت آمار ۴ (پکیج و جزوه)", type: "text",
                  default: "NN" },
                { key: "about.socials_title", label: "عنوان بخش شبکه‌های اجتماعی", type: "text",
                  default: "استاد مهدی عزیزی در شبکه‌های اجتماعی" },
                { key: "about.socials_intro", label: "توضیح بخش شبکه‌های اجتماعی", type: "text",
                  default: "محتوای رایگان، نمونه تدریس‌ها و تحلیل آزمون‌ها را در کانال‌های رسمی زیر منتشر می‌کنیم. این‌ها تنها صفحه‌ها و کانال‌های رسمی استاد مهدی عزیزی هستند." },
                { key: "about.socials_telegram_stat", label: "آمار تلگرام", type: "text",
                  default: "۵۹٬۰۰۰+ عضو" },
                { key: "about.socials_bale_stat", label: "آمار بله", type: "text",
                  default: "۱۳٬۱۰۰+ عضو" },
                { key: "about.socials_aparat_stat", label: "آمار آپارات (دنبال‌کننده)", type: "text",
                  default: "۷٬۴۰۰+ دنبال‌کننده" },
                { key: "about.socials_aparat_views", label: "آمار آپارات (بازدید)", type: "text",
                  default: "۲۳۸٬۰۰۰ بازدید ویدیوها" },
                { key: "about.socials_instagram_stat", label: "آمار اینستاگرام", type: "text",
                  default: "صفحه‌ی رسمی" },
            ],
        },

        {
            id: "courses-page",
            title: "صفحه دوره‌ها",
            items: [
                { key: "courses.title", label: "عنوان صفحه", type: "text",
                  default: "فروشگاه محصولات آموزشی" },
                { key: "courses.subtitle", label: "توضیح زیر عنوان", type: "text",
                  default: "دوره‌ها و بسته‌های آموزشی آکادمی ریاضی مهدی عزیزی" },
            ],
        },

        {
            id: "site-wide",
            title: "مشترک همه‌ی صفحات (فوتر)",
            items: [
                { key: "footer.brand_1", label: "نام برند در فوتر — بخش اول", type: "text",
                  default: "آکادمی" },
                { key: "footer.brand_2", label: "نام برند در فوتر — بخش رنگی", type: "text",
                  default: "عزیزی" },
                { key: "footer.copyright", label: "متن کپی‌رایت", type: "text",
                  default: "تمامی حقوق مادی و معنوی برای آکادمی استاد مهدی عزیزی محفوظ است." },
                { key: "footer.free_hint", label: "توضیح نمونه تدریس رایگان", type: "text",
                  default: "نمونه تدریس‌های رایگان در" },
            ],
        },
    ],
};

/* فهرست تختِ کلیدها — برای تست‌ها و پنل ادمین */
window.SITE_CONTENT_KEYS = window.SITE_CONTENT_MANIFEST.groups
    .flatMap(function (g) { return g.items.map(function (i) { return i.key; }); });
