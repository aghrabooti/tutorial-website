-- ═══════════════════════════════════════════════════════════════════════════
-- محتوای قابل ویرایش سایت (متن‌ها و عکس‌ها)
--
-- هدف: مدیر سایت بتواند از پنل ادمین، متن‌ها و عکس‌های هر بخش سایت را
--       بدون دست‌زدن به کد عوض کند.
--
-- ساختار: هر ردیف یک «کلید» است (مثل home.title_1) و مقدارش متن یا آدرس عکس.
--         اگر کلیدی در این جدول نباشد، سایت مقدار پیش‌فرض خودِ HTML را نشان می‌دهد.
--         پس خالی‌بودن جدول = سایت دقیقاً مثل قبل.
--
-- دسترسی: این جدول RLS روشن دارد و هیچ policy‌ای ندارد؛ یعنی نه anon و نه
--         کاربر لاگین‌شده نمی‌تواند مستقیم به آن دست بزند. خواندن/نوشتن فقط از
--         طریق فانکشن site-content (با service role) و با بررسی نقش admin.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.site_content (
    key         text primary key,
    value       text not null default '',
    updated_at  timestamptz not null default now(),
    updated_by  uuid
);

-- برای مرتب‌کردن بر اساس آخرین تغییر در پنل
create index if not exists site_content_updated_at_idx
    on public.site_content (updated_at desc);

-- توضیح ستون‌ها برای کسی که بعداً به دیتابیس نگاه می‌کند
comment on table public.site_content is
    'متن‌ها و عکس‌های قابل ویرایش سایت — از پنل ادمین (فانکشن site-content)';
comment on column public.site_content.key is
    'کلید یکتا مثل home.title_1 یا about.photo — با data-content در HTML متناظر است';

-- دسترسی مستقیم بسته است (service role از RLS عبور می‌کند)
alter table public.site_content enable row level security;

revoke all on public.site_content from anon, authenticated;
