# Usamos Node.js LTS más reciente basado en Alpine
FROM node:24.18.0-alpine

# Instalamos libc6-compat (muy recomendado en Alpine para compatibilidad con dependencias nativas de Next.js/SWC)
RUN apk add --no-cache libc6-compat

WORKDIR /app

## Copiamos primero los archivos de dependencias para aprovechar la caché de capas de Docker
#COPY services/web/package*.json ./
#
## Instalamos todas las dependencias (incluyendo devDependencies)
#RUN npm install
#
## Copiamos el resto del código del servicio
#COPY services/web/ .

# Exponemos el puerto por defecto de Next.js
EXPOSE 3000

# Comando para iniciar en modo desarrollo
#CMD ["npm", "run", "dev"]
CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npm run dev"]