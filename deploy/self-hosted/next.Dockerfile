FROM node:22-alpine AS dependencies
WORKDIR /app
COPY apps/next-app/package.json apps/next-app/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY apps/next-app/ ./
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs \
    && mkdir -p /app/var/files && chown nextjs:nodejs /app/var/files

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

FROM postgrest/postgrest:v12.2.12 AS postgrest

FROM runner AS render
USER root
RUN apk add --no-cache nginx postgresql17-client supervisor \
    && rm -f /etc/nginx/http.d/default.conf

COPY --from=postgrest /bin/postgrest /usr/local/bin/postgrest
COPY *.html favicon.ico /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY components/ /usr/share/nginx/html/components/
COPY deploy/self-hosted/nginx.conf /etc/nginx/http.d/site.conf
RUN sed -i 's/listen 80/listen 8080/g; s/next-app:3000/127.0.0.1:3000/g; /server_tokens off;/a\    access_log off;' /etc/nginx/http.d/site.conf \
    && sed -i 's/worker_processes auto;/worker_processes 1;/' /etc/nginx/nginx.conf \
    && printf 'User-agent: *\nDisallow: /\n' > /usr/share/nginx/html/robots.txt

COPY deploy/self-hosted/db/01-schema.sql /etc/tutorial/schema.sql
COPY deploy/render/init.sql /etc/tutorial/init.sql
COPY deploy/render/supervisord.conf /etc/supervisord-render.conf
COPY deploy/render/start.sh /usr/local/bin/start-render

ENV PORT=8080 DATABASE_API_URL=http://127.0.0.1:3001 FILE_STORAGE_DIR=/app/var/files
EXPOSE 8080
CMD ["sh", "/usr/local/bin/start-render"]
