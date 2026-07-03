#!/bin/sh
set -e

# Ensure persistent directories exist inside container limits
mkdir -p /app/data /app/packages/server/uploads

cd /app/packages/server

# Run database migration
npx prisma migrate deploy 2>/dev/null || npx prisma migrate dev --name init --skip-generate

# Start API + static server in foreground
node dist/index.js
