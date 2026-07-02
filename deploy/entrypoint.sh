#!/bin/sh
set -e

cd /app/packages/server

# Run database migration
npx prisma migrate deploy 2>/dev/null || npx prisma migrate dev --name init --skip-generate

# Start API server in background
node dist/index.js &

# Start nginx in foreground
nginx -g "daemon off;"
