---
title: Worker GPU Strategy
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-18
last_updated: 2026-08-18
status: Draft
services: [infra, worker]
---

# SPEC: Worker GPU Strategy (`spec.md`)

> **Esqueleto deliberado.** Esta spec plantea el problema y las alternativas; los requirements y los
> criterios de aceptación se escriben cuando se la trabaje, una vez elegida la estrategia.

## Context & Goal

La imagen del `worker` está atada al hardware de una máquina concreta. Su stage `base` instala
`vulkan-loader` y `mesa-vulkan-intel` (`services/worker/Dockerfile`) porque el pipeline usa el filtro
**`libplacebo`** para el tonemap de 4K HDR10 y Dolby Vision a 1080p SDR
(`services/worker/src/ffmpeg/params.ts:88` y `:116`). `libplacebo` es un filtro Vulkan: sin un driver
Vulkan usable falla con `VK_ERROR_INCOMPATIBLE_DRIVER`, y `mesa-vulkan-intel` es el driver de
**Intel**. Alrededor de esa decisión hay un overlay (`docker-compose.gpu.yaml`, que mapea `/dev/dri`),
la variable `USE_GPU`, una pregunta en `bin/install` y ramas en `bin/dev` y `bin/prod`.

Eso no es portable. En Windows (Docker Desktop) **no existe `/dev/dri`**: `USE_GPU=true` ni siquiera
levanta el container. En Linux con GPU AMD o NVIDIA, el driver instalado es el de Intel, así que
mapear `/dev/dri` no habilita nada. Y aun con `USE_GPU=false`, la imagen carga igual el loader y el
driver Mesa.

El encode AV1 en sí **ya corre siempre en CPU** — ninguna GPU corriente codifica AV1 en hardware, como
el propio `docker-compose.gpu.yaml` documenta — así que lo único en juego acá es el paso de tonemap de
fuentes 4K HDR/DoVi.

El objetivo es **decidir y ejecutar la estrategia de GPU del `worker` en producción**, de forma que la
misma imagen corra en Windows y en Linux, con o sin GPU. La dirección de partida es CPU-only.

## DECISIÓN PENDIENTE — Estrategia

- **A — CPU-only.** Se quitan `vulkan-loader`/`mesa-vulkan-intel`, `libplacebo` se reemplaza por
  tonemap por software (camino a verificar contra el `ffmpeg` real de Alpine: `zscale` + `tonemap`),
  y se eliminan `docker-compose.gpu.yaml`, `USE_GPU` y sus ramas en `bin/`. Una sola imagen, portable
  y más chica; tonemap más lento y sin lectura del RPU de Dolby Vision (la fuente se trata como su
  capa base HDR10).
- **B — CPU + Vulkan opcional con detección en runtime.** Se conserva `libplacebo` pero el worker
  detecta si hay un driver Vulkan usable y cae a la cadena CPU si no. Una sola imagen que aprovecha la
  GPU donde la haya; más código, más superficie de fallo, imagen más pesada.
- **C — Dos variantes de imagen** (base CPU + una con Vulkan). Descarta el problema del runtime a
  costa de duplicar lo que hay que construir y publicar — chocaría de frente con
  `015-reproducible-image-builds`.

## Alcance (a detallar al trabajar la spec)

- `services/worker/Dockerfile` — paquetes del stage `base`.
- `services/worker/src/ffmpeg/params.ts` — las dos ramas que usan `libplacebo`.
- `docker-compose.gpu.yaml`, `USE_GPU` en `.env.example`, la pregunta de `bin/install`, y las ramas de
  `bin/dev` y `bin/prod`.
- Documentación: `CLAUDE.md` raíz, `services/worker/CLAUDE.md`, `docs/spec/docker/`.

## Fuera de alcance

- **Encode AV1 por hardware**: no existe hoy en GPUs corrientes; no es una alternativa.
- **Cambiar códec, CRF, preset o `-svtav1-params`.** Esta feature decide *dónde* corre el tonemap, no
  la política de calidad.
- **La reproducibilidad del build del `worker`** (stage `builder`, `.dockerignore`) — spec
  `015-reproducible-image-builds`.

## Relación con la spec 015

Ambas tocan `services/worker/Dockerfile`: la 015 le agrega un stage `builder` que compile el `dist/`;
ésta cambia los paquetes del stage `base`. Además, según la alternativa elegida, ésta puede eliminar
`docker-compose.gpu.yaml`, que la 015 toma como precedente para su `docker-compose.dev.yaml`. Son
cambios disjuntos; si esta spec se resuelve primero, la 015 valida su build limpio contra la imagen ya
definitiva y no hay que reconstruir dos veces.
