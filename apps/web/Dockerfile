# syntax=docker/dockerfile:1
# Lab Portal web: Vite SPA build served by nginx, which also reverse-proxies
# the API, Socket.IO and LiveKit signalling so the browser sees ONE origin.
# Build context MUST be the repo root:
#   docker build -f apps/web/Dockerfile -t lab-web .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=@lab/web --workspace=@lab/shared --include-workspace-root --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace=@lab/shared \
    && npm run build --workspace=@lab/web

# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache openssl
# The official image renders /etc/nginx/templates/*.template with envsubst
# (only for variables that are set) and runs /docker-entrypoint.d/*.sh.
COPY apps/web/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
ENV API_UPSTREAM=server:3000 \
    LIVEKIT_UPSTREAM=livekit:7880 \
    MAX_UPLOAD_MB=500
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/healthz || exit 1
