# ==========================================
# 1. BASE: shared environment (Alpine + FFmpeg + libc6)
# ==========================================
FROM node:26.10.0-alpine AS base
# FFmpeg and the compatibility libraries the worker needs.
# mkvtoolnix: mkvmerge for the final remux (see src/ffmpeg/runner.ts).
RUN apk add --no-cache ffmpeg mkvtoolnix libc6-compat
# ffsubsync: python3 and py3-numpy come from apk so numpy is never compiled;
# the build tools live in a virtual package removed in the same layer.
RUN apk add --no-cache python3 py3-pip py3-numpy && \
    apk add --no-cache --virtual .ffsubsync-build build-base python3-dev && \
    pip install --no-cache-dir --break-system-packages ffsubsync==0.5.1 && \
    apk del .ffsubsync-build
WORKDIR /app

# ==========================================
# 2. DEV: local development stage
# ==========================================
FROM base AS dev
ENV NODE_ENV=development
# See the matching comment in services/api/Dockerfile: a safety net for when
# /app has no docker-compose.dev.yaml bind mount over it.
RUN chown node:node /app
CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npm run dev"]

# ==========================================
# 3. BUILDER: compiles TypeScript to dist/ (this stage is never published)
# ==========================================
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ==========================================
# 4. PROD: final production image
# ==========================================
FROM base AS prod
ENV NODE_ENV=production

# Create a non-root user, for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 workerjs

# Copy the dependency manifests
COPY package*.json ./

# Install production dependencies only (no devDependencies)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy only what the builder stage compiled, never the source or the
# development node_modules (a reproducible image that does not depend on
# whatever is on the host).
COPY --from=builder --chown=workerjs:nodejs /app/dist ./dist

USER workerjs

# dist/index.js was compiled by the build, not inherited from the context.
CMD ["node", "dist/index.js"]