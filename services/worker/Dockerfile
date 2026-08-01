# ==========================================
# 1. BASE: Entorno común (Alpine + FFmpeg + libc6)
# ==========================================
FROM node:24.18.0-alpine AS base
# Instalamos FFmpeg y librerías de compatibilidad requeridas por el worker
RUN apk add --no-cache ffmpeg libc6-compat
WORKDIR /app

# ==========================================
# 2. DEV: Etapa para Desarrollo Local
# ==========================================
FROM base AS dev
ENV NODE_ENV=development
CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npm run dev"]

# ==========================================
# 3. RUNNER: Imagen Final de Producción
# ==========================================
FROM base AS runner
ENV NODE_ENV=production

# Creamos usuario no-root por seguridad
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 workerjs

# Copiamos manifiestos de dependencias
COPY package*.json ./

# Instalamos únicamente dependencias de producción (omitimos devDependencies)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copiamos todo el código fuente del worker
COPY --chown=workerjs:nodejs . .

USER workerjs

# Al no requerir compilación, ejecutamos directamente el script de inicio
CMD ["npm", "start"]