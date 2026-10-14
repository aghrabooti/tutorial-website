FROM nginx:stable-alpine

COPY deploy/self-hosted/nginx.conf /etc/nginx/conf.d/default.conf

# صفحه‌ها و assetهای موردنیاز مرورگر؛ منطق backend همچنان از Supabase فعلی می‌آید.
COPY *.html robots.txt sitemap.xml favicon.ico /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY components/ /usr/share/nginx/html/components/
COPY tools/*.html /usr/share/nginx/html/tools/
