# ==========================================
# 1. BASE: Entorno común (Alpine + libc6)
# ==========================================
FROM node:24.18.0-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ==========================================
# 2. DEV: Etapa para Desarrollo Local
# ==========================================
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3000
# El container corre como PUID:PGID (docker-compose.yaml), no como root. Sin el
# bind mount de docker-compose.dev.yaml, /app queda con el dueño que le dio
# WORKDIR (root) y "npm install" falla con EACCES al escribir package-lock.json.
# node:alpine trae un usuario "node" en 1000:1000 (el default de PUID/PGID en
# .env.example) — chown acá es sólo la red de seguridad para ese caso; con el
# bind mount normal, el dueño real del host manda.
RUN chown node:node /app
# Verifica el binario real (no sólo si la carpeta existe: un node_modules a
# medias pasaría el chequeo y "npx prisma generate" quedaría pidiendo
# confirmación interactiva en medio del arranque del container). --no en npx
# hace que falle en vez de ofrecer bajar el paquete del registry.
CMD ["sh", "-c", "if [ ! -x node_modules/.bin/nest ]; then npm install; fi && npx --no prisma generate && npm run start:dev"]

# ==========================================
# 3. BUILDER: Compilación para Producción
# ==========================================
FROM base AS builder
# Copiamos manifiestos e instalamos TODAS las dependencias (incluyendo devDependencies para compilar)
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copiamos el schema de Prisma y generamos el cliente
COPY prisma ./prisma/
RUN npx prisma generate

# Copiamos el código fuente y compilamos NestJS
COPY . .
RUN npm run build

# Limpiamos las devDependencies para dejar solo las dependencias necesarias en producción
RUN npm prune --omit=dev

# Smoke test: if the prune above also stripped node_modules/.prisma/client,
# fail the build here instead of at the login screen of the final container.
RUN node -e "require('@prisma/client')"

# ==========================================
# 4. RUNNER: Imagen Final de Producción
# ==========================================
FROM base AS runner
ENV NODE_ENV=production

# Usuario no-root por seguridad
RUN addgroup --system --gid 1001 nestjs && \
    adduser --system --uid 1001 nestjs

# Copiamos las dependencias de producción ya podadas y el código compilado
COPY --from=builder --chown=nestjs:nestjs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nestjs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nestjs /app/dist ./dist
COPY --from=builder --chown=nestjs:nestjs /app/package*.json ./

USER nestjs

EXPOSE 3000
ENV PORT=3000

# Punto de entrada de la aplicación NestJS compilada. nest-cli.json declara
# sourceRoot=src, así que "nest build" preserva ese prefijo dentro de dist/ —
# el binario real queda en dist/src/main.js, no en dist/main.js.
CMD ["node", "dist/src/main.js"]