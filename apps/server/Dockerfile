# syntax=docker/dockerfile:1
# Lab Portal API server (NestJS + Prisma + Socket.IO).
# Build context MUST be the repo root (npm workspaces + @lab/shared):
#   docker build -f apps/server/Dockerfile -t lab-server .
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Manifests first so the dependency layer caches across source edits.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=@lab/server --workspace=@lab/shared --include-workspace-root --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build --workspace=@lab/shared \
    && npm run build --workspace=@lab/server

# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
# espeak-ng powers IPA generation for pronunciation activities (optional).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates espeak-ng tini wget \
    && rm -rf /var/lib/apt/lists/*

# Install Piper TTS and download voices
RUN mkdir -p /usr/local/piper/voices \
    && wget -qO- https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_amd64.tar.gz | tar -xz -C /usr/local/piper --strip-components=1 \
    && wget -qO /usr/local/piper/voices/en_US.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
    && wget -qO /usr/local/piper/voices/en_US.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json \
    && wget -qO /usr/local/piper/voices/en_GB.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx \
    && wget -qO /usr/local/piper/voices/en_GB.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json \
    && apt-get purge -y --auto-remove wget

ENV NODE_ENV=production \
    PORT=3000 \
    LAB_DATA_ROOT=/data/LabData \
    UPDATES_DIR=/data/updates \
    ESPEAK_NG_BIN=/usr/bin/espeak-ng \
    PIPER_BIN=/usr/local/piper/piper \
    PIPER_VOICES_DIR=/usr/local/piper/voices
WORKDIR /app

# The install is already limited to server + shared; it keeps prisma (CLI,
# needed for `migrate deploy`) and tsx (needed for the optional seed).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server ./apps/server

WORKDIR /app/apps/server
COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data/LabData /data/updates && chown -R node:node /data /app/apps/server
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
