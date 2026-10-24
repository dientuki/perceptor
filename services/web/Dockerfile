FROM node:26.10.0-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ==========================================
# 2. DEV: local development stage
# ==========================================
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3000
# See the matching comment in services/api/Dockerfile: a safety net for when
# /app has no docker-compose.dev.yaml bind mount over it. Also needed now that
# the container runs as PUID:PGID, not as root.
RUN chown node:node /app
CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npm run dev"]

# ==========================================
# 3. BUILDER: production build
# ==========================================
FROM base AS builder
# Copy the manifests and install every dependency
COPY package*.json ./
RUN npm ci

# Copy the rest of the code and build Next.js
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ==========================================
# 4. PROD: final production image (minimal)
# ==========================================
FROM base AS prod
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user, for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy only the static assets and the compiled standalone server
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next writes its fetch/ISR cache under .next/cache at runtime, and the parent
# .next that the COPY above creates implicitly belongs to root. Without this the
# server logs `EACCES: permission denied, mkdir '/app/.next/cache'` on the first
# request that tries to cache anything.
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]