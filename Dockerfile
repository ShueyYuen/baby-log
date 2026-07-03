FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# ---- Install ALL dependencies (for build) ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile

# ---- Build shared + server TypeScript → JS ----
FROM deps AS server-build
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/server/src/ ./packages/server/src/
COPY packages/server/tsconfig.json ./packages/server/
COPY packages/server/prisma/ ./packages/server/prisma/
RUN cd packages/server && npx prisma generate \
    && cd /app && pnpm --filter shared build && pnpm --filter server build

# ---- Build frontend ----
FROM deps AS web-build
COPY packages/shared/ ./packages/shared/
COPY packages/web/ ./packages/web/
RUN pnpm --filter web build

# ---- Production dependencies + Prisma client ----
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
COPY packages/server/prisma/ ./packages/server/prisma/
RUN pnpm install --frozen-lockfile --prod \
    && cd packages/server && npx prisma generate \
    && pnpm store prune

# ---- Final production image ----
FROM node:22-alpine
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules

COPY --from=server-build /app/packages/server/dist ./packages/server/dist
COPY --from=server-build /app/packages/shared/dist ./packages/shared/dist
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/prisma/ ./packages/server/prisma/
COPY package.json pnpm-workspace.yaml ./

COPY --from=web-build /app/packages/web/dist ./packages/web/dist

COPY deploy/entrypoint.sh /entrypoint.sh
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL="file:/app/data/baby-log.db"

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
