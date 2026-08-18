---
title: Reproducible Image Builds
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-18
last_updated: 2026-08-18
status: Draft
services: [infra, api, web, worker]
---

# SPEC: Reproducible Image Builds (`spec.md`)

## Context & Goal

Perceptor construye cinco imágenes propias (`web`, `api`, `worker`, `torrent`, `indexer`) y consume
cuatro de terceros (`db`, `redis`, `traefik`, `flaresolverr`). El stack funciona en la máquina del
desarrollador, pero funciona *gracias a* ella: los tres servicios Node se levantan en su stage
`dev`, que no copia código — el código llega por bind mount (`./services/<svc>:/app`) y las
dependencias se instalan en el primer arranque (`if [ ! -d node_modules ]; then npm install; fi`).
La imagen que se construye hoy para esos tres es, literalmente, `node:24.18.0-alpine` + `apk add` y
un `CMD`.

Los stages `runner`, que sí copian código, nunca se ejercitan desde cero: `bin/prod` los levanta con
los mismos bind mounts encima, tapando lo que la imagen trae, y sin `.dockerignore` en ningún
contexto sus `COPY . .` arrastran el `node_modules`, el `dist` y el `.next` del host (1.1 GB sólo en
`services/web/.next`), además de `services/api/.env`. En el `worker` la dependencia es total: su
stage `runner` corre `npm start` → `node dist/index.js` pero **nunca ejecuta `npm run build`**, y
`tsc` es devDependency — el `dist/` que sirve es el del host.

Esta feature deja `bin/prod` construyendo las cinco imágenes propias desde un checkout limpio, sin
artefactos previos y sin secretos adentro, y levantando el mismo stack funcional de hoy — sin tocar
el flujo de desarrollo (`bin/dev`: bind mount + hot reload). Es el paso previo a CI/CD: no publica
imágenes, no configura GHCR ni GitHub Actions, no versiona imágenes. Ningún stage del pipeline de
`CLAUDE.md` cambia de estado; lo que cambia es que ese pipeline pasa a ser construible en una
máquina que no es la del autor.

## Estado actual

Lo que sigue son hallazgos verificados contra el repositorio, no supuestos.

### 1. Organización y contextos de build

| Servicio | Contexto | Dockerfile | `target` en compose | Base image |
| :-- | :-- | :-- | :-- | :-- |
| `web` | `./services/web` | `services/web/Dockerfile` (default) | `${BUILD_TARGET:-dev}` | `node:24.18.0-alpine` |
| `api` | `./services/api` | `services/api/Dockerfile` (default) | `${BUILD_TARGET:-dev}` | `node:24.18.0-alpine` |
| `worker` | `./services/worker` | `services/worker/Dockerfile` (default) | `${BUILD_TARGET:-dev}` | `node:24.18.0-alpine` + `ffmpeg mkvtoolnix vulkan-loader mesa-vulkan-intel libc6-compat` |
| `torrent` | `./services/torrent` | default | — (sin `target`) | `lscr.io/linuxserver/qbittorrent:5.2.3` |
| `indexer` | `./services/indexer` | default | — (sin `target`) | `lscr.io/linuxserver/prowlarr:2.5.2` + `apk add jq` |

Todos los `build:` usan contexto por servicio, sin `args:`, sin `image:` declarada — los nombres
`perceptor-*` que se ven en `docker ps` son `container_name`, no tags de imagen. Las líneas
`#dockerfile: docker/web.Dockerfile` comentadas en los tres servicios Node apuntan a un directorio
`docker/` que no existe en el repo.

Stages por Dockerfile:

- `api`: `base` → `dev` / `builder` → `runner`, más ~15 líneas de un Dockerfile viejo comentadas
  arriba de todo.
- `web`: `base` → `dev` / `builder` → `runner`. Mismo bloque comentado.
- `worker`: `base` → `dev` / `runner`. **No hay `builder`.**
- `torrent` / `indexer`: single-stage sobre la imagen de LinuxServer; sólo `RUN sed`/`apk add` y
  `COPY --chmod=755` de los scripts de init. **Ya son reproducibles y no se tocan.**

### 2. Dependencias entre builds

Ninguna imagen depende del build de otra: no hay base image compartida entre servicios ni un stage
que copie de otro contexto. Las dependencias son de arranque (`depends_on` + healthchecks), no de
build. Los cinco pueden construirse en paralelo.

### 3. Dependencias implícitas del host

- **No existe ningún `.dockerignore`** (`find . -name .dockerignore` no devuelve nada). Cada contexto
  viaja completo al daemon: `services/web` con `node_modules` (467 MB) y `.next` (1.1 GB);
  `services/api` con `node_modules` (687 MB), `dist` (2.2 MB) y **`services/api/.env`**, que contiene
  `DATABASE_URL` con usuario y password; `services/worker` con `node_modules` (76 MB) y `dist`.
- `api` (`builder`): `npm ci` + `npx prisma generate` y **después** `COPY . .`, que pisa el
  `node_modules` recién instalado — y con él el cliente Prisma generado — con el del host.
- `web` (`builder`): mismo patrón; además copia el `.next/` del host adentro antes de `npm run build`.
- `worker` (`runner`): `npm ci --omit=dev` y luego `COPY . .`, que trae el `node_modules` completo del
  host **y el `dist/`**. `CMD ["npm", "start"]` es `node dist/index.js` y `tsc` es devDependency: sin
  ese `dist/` la imagen no arranca. Es la dependencia de artefacto previo más directa del repo.
- `web`/`api` (`dev`): no copian nada; el `CMD` corre `npm install` en el primer arranque contra el
  bind mount — de ahí los `start_period` de 60s/90s en sus healthchecks.
- `web` (`runner`): copia `/app/public`, `/app/.next/standalone` y `/app/.next/static`;
  `next.config.ts` sí declara `output: 'standalone'`, así que el stage es coherente. Pero
  `bin/npm web run build` **falla hoy** con 11 errores de TypeScript en 4 archivos pre-GraphQL, sin
  `ignoreBuildErrors` → el build de la imagen `web` falla, con o sin artefactos del host. Se resuelve
  en la spec `016-web-build-errors`.

### 4. Bind mounts vs. imagen

`web`, `api` y `worker` montan `./services/<svc>:/app` **incondicionalmente**, sin importar el
`target`. Con `BUILD_TARGET=runner` (`bin/prod`) ese mount tapa lo que el stage copió: para `web`,
`/app/server.js` queda oculto tras el árbol fuente del host; para `api` y `worker`, lo que corre es
el `dist/` del host. **El modo producción actual no ejecuta la imagen que construyó.**

### 5. Variables y secretos

- Ninguna variable se usa hoy como `ARG` de build; no hay `build.args` en compose. Todo llega por
  `environment:` en runtime.
- **Excepción real**: `NEXT_PUBLIC_UPLOAD_URL`
  (`services/web/src/components/import/importFileModal.tsx:95`, único lector). Next inlinea las
  `NEXT_PUBLIC_*` **en tiempo de build**; hoy sólo se pasa como env de runtime. En `dev` funciona; en
  una imagen `runner` quedaría `undefined` y el modal de subida apuntaría a la nada.
- `next.config.ts` lee `DOMAIN` para `allowedDevOrigins` — sólo afecta a `next dev`, no al bundle.
- `services/api/.env` es el único secreto que hoy termina dentro de una imagen. El `.env` de la raíz
  no está en ningún contexto de build, pero existe además un `.env copy` en la raíz que tampoco debe
  entrar nunca.
- `torrent`/`indexer` no reciben secretos en build: `QBITTORRENT_PASSWORD`, `INDEXER_PASSWORD` e
  `INDEXER_API_KEY` los leen sus scripts de init en runtime (`custom-cont-init.d/`,
  `custom-services.d/`). Ese diseño ya es correcto.

### 6. Permisos y usuarios

`api` y `worker` corren con `user: "${PUID}:${PGID}"` + `group_add: ${MEDIA_GID}` en compose, pero
sus stages `runner` declaran `USER nestjs` / `USER workerjs` (uid/gid 1001) y hacen `--chown` a ese
usuario. Compose gana en runtime, así que el árbol de la imagen queda propiedad de un uid que el
proceso no es. Con bind mount no se nota; sin bind mount —que es el objetivo— hay que verificarlo.
`torrent`/`indexer` ya resuelven el bit de ejecución con `COPY --chmod=755`, sin depender de los
permisos del host.

## Decisiones tomadas

| # | Decisión |
| :-- | :-- |
| **D1 — targets y mounts** | Se mantiene `target: ${BUILD_TARGET:-dev}`. Los bind mounts de código y las variables de desarrollo salen de `docker-compose.yaml` y pasan a un overlay **`docker-compose.dev.yaml`**, mismo mecanismo que el ya existente `docker-compose.gpu.yaml`. `bin/dev` suma el overlay con `-f`; `bin/prod` no. Así `bin/prod` corre las imágenes que construyó y `bin/dev` no cambia de comportamiento. |
| **D2 — errores de TypeScript de `web`** | Fuera de esta spec: se corrigen en `016-web-build-errors`, prerequisito de REQ-9. |
| **D3 — `NEXT_PUBLIC_UPLOAD_URL`** | Sale del bundle. La URL se resuelve en el servidor y llega al modal en runtime; la imagen de `web` queda agnóstica del despliegue. |
| **D4 — `.dockerignore`** | Uno por servicio, en `services/web/`, `services/api/` y `services/worker/`. No se mueve el contexto a la raíz. Precedente en el repo: `services/web/.gitignore` existe por una razón análoga (Biome). |

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Build definido)**: Los cinco servicios propios deben tener un `build:` que resuelva a
      un Dockerfile versionado, con contexto explícito, sin líneas `dockerfile:` comentadas apuntando
      a rutas inexistentes.
- [ ] **REQ-2 (Build limpio)**: `bin/prod` debe construir las cinco imágenes desde un checkout sin
      `node_modules`, sin `dist`, sin `.next` y sin `.env` por servicio, sin intervención manual.
- [ ] **REQ-3 (Sin artefactos del host)**: Ninguna imagen debe contener ni depender de archivos
      generados en el host. En particular, el stage de runtime del `worker` debe compilar su propio
      `dist/` dentro del build (nuevo stage `builder`), no recibirlo por `COPY`.
- [ ] **REQ-4 (Contexto acotado)**: Cada servicio Node debe traer su propio `.dockerignore`
      excluyendo `node_modules`, salidas de compilación (`dist`, `.next`, `*.tsbuildinfo`),
      `coverage` y todo `.env*` salvo `.env.example` (D4).
- [ ] **REQ-5 (Sin secretos)**: Ninguna imagen construida debe contener un archivo `.env` ni
      credenciales embebidas.
- [ ] **REQ-6 (Overlay de desarrollo)**: Los bind mounts `./services/<svc>:/app` y las variables que
      sólo aplican a desarrollo (`WATCHPACK_POLLING`) deben vivir en `docker-compose.dev.yaml`, que
      sólo `bin/dev` incluye (D1). `docker-compose.yaml` describe el runtime.
- [ ] **REQ-7 (`bin/build`)**: Debe existir un wrapper que construya sin levantar el stack, con la
      misma pre-configuración que `bin/prod` (lee `.env`, fija `BUILD_TARGET=runner`, respeta los
      flags de `.env`), y que acepte un servicio opcional para construir una sola imagen —
      `bin/build` / `bin/build web`. Es lo que cubre NFR-1 sin pedirle al usuario un
      `docker compose` a mano.
- [ ] **REQ-8 (Stack funcional)**: Tras construir, `bin/prod` debe dar el mismo comportamiento
      funcional que hoy: login, búsqueda TMDB, alta de release, descarga, procesado y biblioteca.
- [ ] **REQ-9 (Build de `web` verde)**: El build de la imagen de `web` debe completar. Depende de
      `016-web-build-errors`, que debe estar implementada antes (D2).
- [ ] **REQ-10 (URL de subida en runtime)**: `web` no debe requerir ninguna variable `NEXT_PUBLIC_*`
      en tiempo de build. La URL del endpoint de subida se resuelve en el servidor (server action en
      `services/web/src/actions/uploads.ts`, que ya existe) y la consume `importFileModal.tsx`, hoy
      su único lector. La variable pasa a llamarse `PUBLIC_UPLOAD_URL` dentro del container — el
      nombre que `.env.example` ya usa en el host (D3).
- [ ] **REQ-11 (Terceros intactos)**: `db`, `redis`, `traefik` y `flaresolverr` siguen usando sus
      imágenes originales, sin `build:`.
- [ ] **REQ-12 (Desarrollo intacto)**: `bin/dev` debe seguir dando bind mount de `./services/<svc>`,
      hot reload (`next dev`, `nest start --watch`, `tsx watch`) y `node_modules` escrito en el
      working copy del host, exactamente como hoy.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Verificación individual)**: Cada imagen debe poder construirse por separado vía
      `bin/build <servicio>`, documentado en `CLAUDE.md`.
- [ ] **NFR-2 (Sin cambio de arquitectura)**: No se cambian tecnologías, topología, contrato GraphQL,
      ni el diseño de los scripts de init de `torrent`/`indexer`. Sólo lo necesario para que los
      builds sean reproducibles.
- [ ] **NFR-3 (Permisos coherentes)**: Sin bind mount, `api` y `worker` corriendo como
      `${PUID}:${PGID}` deben poder leer su propio código y escribir en `${CONTAINER_DOWNLOADS_DIR}` /
      `${CONTAINER_DESTINATIONS_DIR}`.
- [ ] **NFR-4 (Documentación)**: `CLAUDE.md` (raíz, tabla de `bin/`) y `docs/spec/docker/` deben
      reflejar el nuevo overlay, `bin/build`, y qué construye cada target.
- [ ] **NFR-5 (Higiene)**: Se eliminan los bloques de Dockerfile comentados y las líneas
      `#dockerfile: docker/*.Dockerfile` de compose — describen una organización que no existe.

## GraphQL Contract Delta

**None — esta feature no cruza el límite entre servicios.** REQ-10 mueve una lectura de variable de
entorno del bundle del browser al servidor de `web`; no toca el schema de `api` ni ningún consumidor.

## Data Model Changes

**None.**

## Acceptance Criteria

- [ ] **AC-1**: En un clon limpio (`git clone` + `bin/install`), sin `node_modules`, `dist` ni
      `.next` en ningún servicio, `bin/build` termina con exit 0 y `docker images` lista las cinco
      imágenes propias.
- [ ] **AC-2**: `bin/build web` termina con exit 0 (falla hoy: errores de TypeScript, spec 016).
- [ ] **AC-3**: Borrando `services/worker/dist` del host, `bin/build worker` produce igual una imagen
      que arranca — el `dist/index.js` lo compiló el build.
- [ ] **AC-4 (camino de fallo)**: Introducir un error de TypeScript en `services/api/src` hace
      **fallar** `bin/build api`, en vez de producir una imagen que arranca y explota en runtime.
- [ ] **AC-5**: `bin/bash api` sobre el container productivo no encuentra ningún `.env` en `/app`; lo
      mismo para `web` y `worker`.
- [ ] **AC-6**: El contexto enviado al daemon para cada servicio Node baja de cientos de MB a unos
      pocos MB (visible en `transferring context` durante `bin/build`).
- [ ] **AC-7**: `bin/prod` levanta los nueve servicios, todos llegan a `healthy`, y login + búsqueda
      TMDB + alta de un magnet + procesado terminan igual que hoy.
- [ ] **AC-8**: Con el stack levantado por `bin/prod`, el modal de subida de archivo resuelve su
      endpoint correctamente (REQ-10) — la imagen no fue construida con esa URL adentro.
- [ ] **AC-9**: `bin/dev` sigue dando hot reload: editar `services/web/src/app/page.tsx` se refleja
      sin reconstruir la imagen, y `services/*/node_modules` sigue existiendo en el host.
- [ ] **AC-10**: Ningún servicio de terceros (`db`, `redis`, `traefik`, `flaresolverr`) tiene
      `build:`; `bin/build` no intenta construirlos.

## Out of Scope

- **Publicar imágenes / GHCR / GitHub Actions.** Es el paso siguiente; esta feature sólo garantiza
  que haya algo publicable.
- **Versionado y tags de imágenes** (`image:` en compose, semver, `latest`). Requiere decidir el
  registry primero.
- **Optimizar tamaño de imagen** más allá de lo que exige la reproducibilidad. El `worker` gana un
  stage `builder` porque hoy no compila nada, no por estética; no se persiguen `distroless`/`slim`.
- **Cambiar servicios de terceros** ni los scripts de init de `torrent`/`indexer`, ya reproducibles.
- **Los 11 errores de TypeScript de `web`** — spec `016-web-build-errors`.
- **La estrategia de GPU del `worker`** (`vulkan-loader`/`mesa-vulkan-intel`, `USE_GPU`,
  `docker-compose.gpu.yaml`) — spec `017-worker-gpu-strategy`.
- **La deuda conocida** del DSN hardcodeado en `prisma.service.ts` y del `datasource db` sin `url`:
  no afecta al build.
- **La unificación de `movieId`/`mediaId`** (deuda registrada aparte).
- **Migraciones/seed de Prisma al arrancar `runner`.** El stage corre `node dist/main.js` sin
  `prisma migrate deploy`; quién aplica migraciones en producción es una pregunta de despliegue, no
  de build.
