#!/bin/sh
set -e

mkdir -p /app/data /app/packages/server/uploads

cd /app/packages/server

# Run database migration
npx prisma migrate deploy 2>/dev/null || npx prisma migrate dev --name init --skip-generate

# Start server
exec node dist/index.js
