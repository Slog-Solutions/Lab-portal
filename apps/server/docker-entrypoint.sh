#!/bin/sh
set -e
# Apply pending migrations before the API starts (idempotent).
echo "[entrypoint] prisma migrate deploy"
npx prisma migrate deploy
# Opt-in only: the seed creates well-known demo accounts.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding"
  npx tsx prisma/seed.ts
fi
exec "$@"
