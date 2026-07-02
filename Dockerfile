FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile

# Build frontend
FROM deps AS web-build
COPY packages/shared/ ./packages/shared/
COPY packages/web/ ./packages/web/
RUN pnpm --filter web build

# Build server
FROM deps AS server-build
COPY packages/shared/ ./packages/shared/
COPY packages/server/src/ ./packages/server/src/
COPY packages/server/tsconfig.json ./packages/server/
COPY packages/server/prisma/ ./packages/server/prisma/
COPY tsconfig.base.json ./
RUN cd packages/server && npx prisma generate

# Production image
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
RUN apk add --no-cache nginx

WORKDIR /app

# Copy server dependencies and source
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY packages/server/package.json ./packages/server/
COPY packages/server/src/ ./packages/server/src/
COPY packages/server/prisma/ ./packages/server/prisma/
COPY packages/shared/ ./packages/shared/
COPY tsconfig.base.json ./
COPY package.json pnpm-workspace.yaml ./

# Copy Prisma client
COPY --from=server-build /app/node_modules/.pnpm/@prisma+client*/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=server-build /app/node_modules/.prisma ./node_modules/.prisma

# Copy frontend build
COPY --from=web-build /app/packages/web/dist ./packages/web/dist

# Copy nginx config
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf

# Create data directories
RUN mkdir -p /app/data /app/packages/server/uploads

# Copy entrypoint
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL="file:/app/data/baby-log.db"

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
