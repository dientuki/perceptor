# Usamos Node.js LTS más reciente basado en Alpine
FROM node:24.18.0-alpine

# Instalamos libc6-compat (muy recomendado en Alpine para compatibilidad con dependencias nativas de Next.js/SWC)
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Exponemos el puerto por defecto de Next.js
EXPOSE 3000

# Comando para iniciar en modo desarrollo
#CMD ["npm", "run", "dev"]
CMD ["sh", "-c", "if [ ! -f node_modules/.bin/nest ]; then npm install; fi && npm run start:dev"]