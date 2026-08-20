# ==========================================
# 1. BASE: Entorno común (Alpine + FFmpeg + libc6)
# ==========================================
FROM node:24.18.0-alpine AS base
# Instalamos FFmpeg y librerías de compatibilidad requeridas por el worker.
# mkvtoolnix: mkvmerge para el remux final (ver src/ffmpeg/runner.ts).
# libplacebo (tonemap 4K HDR/DoVi, ver src/ffmpeg/params.ts) ya viene compilado
# en el ffmpeg de Alpine (--enable-libplacebo) — estos paquetes no lo habilitan,
# sólo le dan algo que hablar: vulkan-loader es el loader de Vulkan y
# mesa-vulkan-intel/mesa-vulkan-ati son los drivers Intel y AMD respectivamente.
# Sin un driver que matchee el hardware (y /dev/dri mapeado, ver
# docker-compose.gpu.yaml), el filtro sigue presente pero falla con
# VK_ERROR_INCOMPATIBLE_DRIVER — src/ffmpeg/vulkan.ts prueba esto en runtime y
# cae a una cadena por software (017-worker-gpu-strategy) en vez de fallar el job.
RUN apk add --no-cache ffmpeg mkvtoolnix vulkan-loader mesa-vulkan-intel mesa-vulkan-ati libc6-compat
WORKDIR /app

# ==========================================
# 2. DEV: Etapa para Desarrollo Local
# ==========================================
FROM base AS dev
ENV NODE_ENV=development
CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npm run dev"]

# ==========================================
# 3. BUILDER: Compila TypeScript a dist/ (nunca se publica esta etapa)
# ==========================================
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ==========================================
# 4. RUNNER: Imagen Final de Producción
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

# Copiamos solo el resultado compilado por la etapa builder — nunca el
# código fuente ni node_modules de desarrollo (imagen reproducible, no
# depende de lo que haya en el host).
COPY --from=builder --chown=workerjs:nodejs /app/dist ./dist

USER workerjs

# dist/index.js fue compilado por el build, no heredado del contexto.
CMD ["node", "dist/index.js"]