# One combined image: the backend serves both the API and the built
# frontend (see server.ts's static-file + SPA-fallback block), so a
# self-hosted deploy only ever runs this one container plus a database —
# no separate frontend container/reverse proxy to configure.

# ---- frontend ----
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
# Passed in from CI as the commit being built (see docker-publish.yml) — the
# build context here is just frontend/, with no .git, so vite.config.ts
# can't derive it itself the way it does for a local `npm run build`.
ARG COMMIT_SHA=dev
ENV COMMIT_SHA=$COMMIT_SHA
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend ----
# Keeps devDependencies (unlike a typical prod install) because the
# runtime stage below reuses this same node_modules wholesale — the
# `prisma` CLI (a devDependency) is needed at container startup to run
# `prisma migrate deploy`, and copying node_modules as-is avoids any risk
# of the generated Prisma client drifting from a separately-installed copy.
FROM node:22-slim AS backend-build
WORKDIR /app/backend
# Skip puppeteer's own Chromium download here — the runtime stage installs
# a system Chromium via apt instead (see PUPPETEER_EXECUTABLE_PATH below),
# so this copy is never used and would just fail anyway (no `unzip` in
# this base image to extract it, on top of being wasted image size).
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate
RUN npm run build

# ---- runtime ----
FROM node:22-slim AS runtime
# Chromium + the libraries it needs headless, for the PDF report feature
# (backend/src/routes/individuals.ts's puppeteer usage) — installed from
# apt rather than letting puppeteer download its own copy, since that
# download is what actually needs these same system libraries to run.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/prisma ./prisma
COPY --from=backend-build /app/backend/package.json ./package.json
COPY --from=frontend-build /app/frontend/dist ./public

# Uploaded photos/documents — see backend/src/uploads.ts's
# path.resolve(process.cwd(), "uploads"), matching WORKDIR /app above.
# Mount a volume here in docker-compose.yml so they survive a redeploy.
VOLUME ["/app/uploads"]

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
