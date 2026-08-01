## Usamos Node.js LTS más reciente basado en Alpine
#FROM node:24.18.0-alpine
#
## Instalamos libc6-compat (muy recomendado en Alpine para compatibilidad con dependencias nativas de Next.js/SWC)
#RUN apk add --no-cache libc6-compat
#
#WORKDIR /app
#
## Exponemos el puerto por defecto de Next.js
#EXPOSE 3000
#
## Comando para iniciar en modo desarrollo
#CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npm run dev"]

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
CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npm run dev"]

# ==========================================
# 3. BUILDER: Compilación para Producción
# ==========================================
FROM base AS builder
# Copiamos manifiestos e instalamos dependencias completas
COPY package*.json ./
RUN npm ci

# Copiamos el resto del código y compilamos Next.js
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ==========================================
# 4. RUNNER: Imagen Final de Producción (Ultra liviana)
# ==========================================
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Creamos un usuario no-root por seguridad
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copiamos solo los artefactos estáticos y el servidor standalone compilado
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]