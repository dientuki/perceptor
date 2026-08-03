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
##CMD ["npm", "run", "dev"]
#CMD ["sh", "-c", "if [ ! -f node_modules/.bin/nest ]; then npm install; fi && npm run start:dev"]

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
# Verifica si existe nest CLI o node_modules, de lo contrario instala e inicia en dev
CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npx prisma generate && npm run start:dev"]

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

# Punto de entrada de la aplicación NestJS compilada
CMD ["node", "dist/main.js"]