# ---- Build frontend (Node) ----
FROM node:22-alpine AS web-build
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---- Build backend (Go) ----
FROM golang:1.25-alpine AS go-build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w" -o /out/babylog-server .

# ---- Final production image ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates && update-ca-certificates
WORKDIR /app

COPY --from=go-build /out/babylog-server /app/babylog-server
COPY --from=web-build /app/web/dist /app/web
COPY deploy/entrypoint.sh /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL="file:/app/data/baby-log.db"

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
