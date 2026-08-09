# services/worker

**Stub.** `src/index.ts` currently contains a single line:

```ts
console.log('🚀 Hello World desde el Worker!');
```

There is no BullMQ consumer, no queue wiring, and no FFmpeg invocation yet, despite the
dependencies already being declared in `package.json` (`bullmq`, `ioredis`, plus `ffmpeg` baked
into the Docker image). Don't assume any transcoding logic exists — if you're asked to work on
this service, you're building it from scratch on top of the stub.

## Intended role

Per the pipeline described in the root `CLAUDE.md`, `worker` is meant to be a BullMQ consumer that:

- Listens on the shared Redis queue (`ioredis`, same `redis` container as `api`) for encode jobs
  created against the `ProcessJob` Prisma model (see `services/api/CLAUDE.md`).
- Runs FFmpeg transcodes reading from the bind-mounted downloads directory and writing to the
  bind-mounted library directory (`HOST_DOWNLOADS_DIR`/`HOST_DESTINATIONS_DIR` and
  `CONTAINER_DOWNLOADS_DIR`/`CONTAINER_DESTINATIONS_DIR` in the root `.env`, see
  `docker-compose.yaml`). The worker no longer reads `DOWNLOADS_DIR`/`DESTINATIONS_DIR` env vars —
  it never did read the former, and the latter was removed. The output root now arrives as
  `outputRoot` in the `processJob` GraphQL payload (`services/worker/src/jobs/encode.job.ts`),
  resolved server-side from the `path_movies`/`path_shows` settings against the declared roots —
  see `services/api/src/media-roots/` and `build-output-path.ts` in this service.
- Has no HTTP ingress — it is not routed through Traefik and only talks to Redis (and, once
  implemented, the API and/or database).

## Dev loop

- `npm run dev` → `tsx watch src/index.ts` (hot-reload on save, no separate build step needed for
  dev). Always run through `bin/npm worker run dev` per the root Docker-first workflow.
- `npm test` / `npm run test:watch` → Vitest (`vitest run` / `vitest`), via `bin/npm worker test`.
- `npm run build` → `tsc`, then `npm start` → `node dist/index.js` for the production image.

## Known debt

- **No `tsconfig.json`** in `services/worker` despite the `"build": "tsc"` script — running the
  build as-is has no compiler config to pick up. Documented as debt, not fixed here.
- FFmpeg is installed in the `base` stage of `services/worker/Dockerfile` (`apk add --no-cache
  ffmpeg libc6-compat`), shared by both the `dev` and `runner` stages, so the binary is already
  available in the container — only the code that calls it is missing.
