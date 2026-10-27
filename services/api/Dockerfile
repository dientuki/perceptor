# ==========================================
# 1. BASE: shared environment (Alpine + libc6)
# ==========================================
FROM node:26.10.0-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ==========================================
# 2. DEV: local development stage
# ==========================================
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3000
# The container runs as PUID:PGID (docker-compose.yaml), not as root. Without the
# docker-compose.dev.yaml bind mount, /app keeps the owner WORKDIR gave it (root)
# and "npm install" fails with EACCES writing package-lock.json. node:alpine ships
# a "node" user at 1000:1000 (the PUID/PGID default in .env.example); this chown
# is only the safety net for that case. With the normal bind mount, the host's
# real owner wins.
RUN chown node:node /app
# Checks the real binary, not just the folder: a half-installed node_modules
# would pass a folder check, and "npx prisma generate" would then wait for an
# interactive confirmation in the middle of the container's start. --no makes
# npx fail instead of offering to download the package from the registry.
CMD ["sh", "-c", "if [ ! -x node_modules/.bin/nest ]; then npm install; fi && npx --no prisma generate && npm run start:dev"]

# ==========================================
# 3. BUILDER: production build
# ==========================================
FROM base AS builder
# Copy the manifests and install ALL dependencies (devDependencies included, to compile)
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy the Prisma schema and generate the client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy the source and build NestJS
COPY . .
RUN npm run build

# Prune devDependencies, keeping only what production needs
RUN npm prune --omit=dev

# Smoke test: if the prune above also stripped node_modules/.prisma/client,
# fail the build here instead of at the login screen of the final container.
RUN node -e "require('@prisma/client')"

# ==========================================
# 4. PROD: final production image
# ==========================================
FROM base AS prod
ENV NODE_ENV=production

# Non-root user, for security
RUN addgroup --system --gid 1001 nestjs && \
    adduser --system --uid 1001 nestjs

# Copy the pruned production dependencies and the compiled code
COPY --from=builder --chown=nestjs:nestjs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nestjs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nestjs /app/dist ./dist
COPY --from=builder --chown=nestjs:nestjs /app/package*.json ./

# Spec 107, REQ-13 NFR-6: the OpenSubtitles application key arrives as a BuildKit secret and is
# written as a file only when present; no ARG/ENV, so it never reaches image metadata.
RUN --mount=type=secret,id=opensubtitles_api_key \
    mkdir -p /app/secrets && \
    if [ -s /run/secrets/opensubtitles_api_key ]; then \
      cp /run/secrets/opensubtitles_api_key /app/secrets/opensubtitles_api_key && \
      chmod 0444 /app/secrets/opensubtitles_api_key; \
    fi

USER nestjs

EXPOSE 3000
ENV PORT=3000

# Entry point of the compiled NestJS app. nest-cli.json declares sourceRoot=src,
# so "nest build" keeps that prefix inside dist/: the real entry point is
# dist/src/main.js, not dist/main.js.
CMD ["node", "dist/src/main.js"]