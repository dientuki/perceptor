# services/worker

Rules that outrank this file: `docs/constitution.md`. Agent brief: `.claude/agents/worker.md`.

BullMQ consumer, TypeScript on Node, `strict: true`. No HTTP ingress, no Prisma, no database — it
reaches `api` over GraphQL and Redis and nothing else. Run everything through `bin/npm worker …`
per the root Docker-first workflow.

## Two queues, two workers, on purpose

`src/index.ts` opens two separate BullMQ `Worker`s, both `concurrency: 1`:

| Queue | Job | Handler |
| :-- | :-- | :-- |
| `process` | `source-ready` | `src/jobs/source-ready.job.ts` — scans the finished download, inventories its files |
| `encode` | `encode` | `src/jobs/encode.job.ts` — transcodes and files the result |

They are not two job names on one queue. An encode can run for hours; sharing a queue at
`concurrency: 1` would either block every scan behind FFmpeg or risk N simultaneous FFmpegs. Each
`Worker` opens its own blocking connection, so the encode side can be busy for hours without
stalling the scan side. The reasoning is in the comments in `index.ts` — don't collapse them.

`process.umask(0o002)` at the top of `index.ts` is load-bearing: the container runs as `PUID:PGID`,
and over the setgid library directories this yields `2775`/`664`, which is what lets a media server
running as a different uid in the same group write its own sidecar files into the folders the
worker creates. It is inherited by the FFmpeg/mkvmerge children, so `runner.ts` doesn't repeat it.

## Layout

Flat capability folders, not Nest-style modules. No path aliases — relative imports only.

```
src/index.ts             the two Workers, the umask, the signal handling
src/queue/types.ts       queue/job names and payload shapes
src/api/graphql-client.ts  fetchGraphQL — throws on json.errors, deliberately
src/jobs/                the two handlers
src/scan/scan-folder.ts  file inventory for source-ready
src/encode/              the driver seam (see below)
src/ffmpeg/              buildCommand · params · metadata · runner · remux-detection · iso639
src/paths/build-output-path.ts   composes the final library path
```

## The encode driver seam

`src/encode/types.ts` declares `EncodeFn`; `encode.mock.ts` and `encode.ffmpeg.ts` implement it;
`src/encode/index.ts` picks one from `ENCODE_DRIVER` (defaults to `mock`, and throws on an unknown
name). New encode behaviour goes behind that interface, never inline in a job handler — the mock
is what makes the surrounding workflow testable without FFmpeg.

`EncodeInput` in `encode/types.ts` is a deliberate *subset* of `EncodeJobDetails`
(`jobs/encode.job.ts`), retyped locally rather than imported, so the driver isn't coupled to the
full shape of the GraphQL query. `paths/build-output-path.ts` does the same with `OutputPathInput`.
That is the house pattern for small pure modules here, not an oversight.

## `src/queue/types.ts` is a deliberate copy

It duplicates `services/api/src/queue/types.ts`, which is the source of truth. The worker's Docker
build context is `./services/worker`, so the image physically cannot see `../api` — a shared import
is impossible without restructuring into workspaces.

**Do not "fix" this by inventing a shared package.** Do keep the two files in sync by hand: this is
a contract with no compiler across it, exactly like the GraphQL one. See
`docs/spec/graphql-contract.md`.

## Paths come from the job, never from env

`outputRoot` arrives already resolved in the `processJob` payload — `api` computes it from the
`path_movies`/`path_shows` settings against the declared roots (`services/api/src/media-roots/`).
The worker only `join()`s and `mkdir()`s on top of it.

The worker does **not** read `DOWNLOADS_DIR`/`DESTINATIONS_DIR`; it never read the former and the
latter was removed. Reintroducing an env lookup for a destination path violates Constitution,
Article V.

## Audio/subtitle/quality rules read a resolved list, never guess (`011-av1-transcode`)

`src/ffmpeg/params.ts`'s `getAudioParams`/`getSubtitleParams` take the allow-list `api` already
merged and resolved (`EncodeInput.allowedLanguagesIso3`, plus the mandatory
`originalLanguageIso3`) — they no longer derive their own `[original, 'spa', 'eng']`. This service
never queries the database and never re-derives that list from an env var (Constitution, Article
III); a missing edit to either `EncodeJobDetails` (`src/jobs/encode.job.ts`) or `EncodeInput`
(`src/encode/types.ts`) means the field silently arrives `undefined`, which reads as "keep the
original language only" with no error anywhere.

Every language comparison in `params.ts` goes through `src/ffmpeg/iso639.ts`'s `normalizeIso3`
first, on both sides. The seeded `languages` table stores ISO-639-2/**B** (`fre`, `ger`, `chi`,
`dut`, `cze`), but Matroska files commonly tag the same languages ISO-639-2/**T** (`fra`, `deu`,
`zho`, `nld`, `ces`) — comparing the raw strings silently drops a track the user actually asked
for.

A missing track in the title's **original** language is a hard failure — `getAudioParams` throws
`El archivo no tiene ninguna pista de audio en el idioma original (<iso3>)`, which propagates out of
`handleEncode`'s existing `try` and is reported through `encodeFailed`, no new plumbing. A missing
track in any other allowed language is not an error; it's logged and skipped.

`src/ffmpeg/remux-detection.ts`'s `isRemux(metadata, filename)` replaced a filename-substring guess
in `buildCommand.ts` with a decision from the `ffprobe` metadata itself: a lossless audio track
(`truehd`/`mlp`/`pcm_*`/`dts` with a `DTS-HD MA` profile), or bits-per-pixel-per-frame ≥ 0.25 — read
from the video stream's `bit_rate`, then its `BPS` tag, then `format.size/duration`. **`ffprobe`
reports `avg_frame_rate` as a rational string** (`"24000/1001"`), never a plain number — parsing it
with `Number(...)` silently misclassifies every file as non-remux, forever, with no error anywhere;
`remux-detection.spec.ts` proves this by asserting the naive implementation gets the case wrong. The
filename substring is the last resort only, reached when no bitrate at all can be computed.

## Errors must not be swallowed

`src/api/graphql-client.ts` throws on `json.errors`, and the comment at the top says why: `web`
renders errors to a user, but a worker that swallowed one would mark the job completed without
having written anything. Preserve that. A caught-and-logged error that lets a job report success is
this service's central failure mode.

Same reasoning applies to long-running work: `ffmpeg/runner.ts` handles signals for the whole
duration and writes through a working path before an atomic move, so a killed container never
leaves a half-written file at the destination.

## Dev loop

| Command | What |
| :-- | :-- |
| `bin/npm worker run dev` | `tsx watch src/index.ts` |
| `bin/cli worker npx --no tsc --noEmit` | typecheck — today the only real gate |
| `bin/npm worker test` | `vitest run` — 4 suites, 31 tests, green (`011-av1-transcode` added the first three real specs) |
| `docker compose logs -f worker` | the job loop |

## Known debt

- **Test coverage is still partial.** `011-av1-transcode` added `vitest.config.ts` and the first
  real specs (`src/ffmpeg/remux-detection.spec.ts`, `src/ffmpeg/params.spec.ts`,
  `src/ffmpeg/buildCommand.spec.ts`, alongside the pre-existing `src/api/graphql-client.spec.ts`) —
  the rule-dense files that decide *what* an encode keeps are now covered. `paths/build-output-path.ts`
  and `ffmpeg/runner.ts` still have none. A wrong FFmpeg argument or a wrong output path on an
  uncovered path still produces a job marked `completed` and a file nobody can find — no error in
  any log (Constitution, Article IX).
- **No linter or formatter.** No ESLint, no Prettier, no Biome — `api` has the first two, `web` has
  Biome, this service has nothing. Match the surrounding file by eye.
- **Dependency skew with `api`**: `ioredis` ^5 here vs ^6 there, `@types/node` ^22 vs ^24. Not
  currently causing trouble; worth knowing before debugging a Redis behaviour difference.
- FFmpeg and mkvtoolnix are installed in the `base` stage of `services/worker/Dockerfile`, shared
  by `dev` and `runner`.
