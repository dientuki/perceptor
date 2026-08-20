---
title: ffprobe Log — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-20
status: Implemented
---

# PLAN: ffprobe Log (`plan.md`)

## Approach

`api` grows one more domain module in the shape every other one already has —
`src/ffprobe-logs/` with `ffprobe-logs.module.ts` + `.resolver.ts` + `.service.ts` and one
`@ObjectType` under `entities/` — plus a Prisma model and its migration. Nothing about it is novel:
the resolver takes plain `@Args` scalars the way `process-jobs.resolver.ts` does rather than
inventing a DTO for two strings, throws through `i18nError.notFound`/`i18nError.badRequest`
(`src/i18n/i18n-error.ts`) with two new constants in `src/i18n/error-keys.ts` and their English
templates in `src/i18n/messages.en.ts`, and reads and writes through the shared `PrismaService`.

The authorization split is the one thing that cannot be copied from a neighbour. `UsersResolver`
puts `@UseGuards(AdminGuard)` at **class** level; that is wrong here, because `AdminGuard`
(`src/auth/guards/admin.guard.ts`) rejects any principal whose `type !== 'user'` — a class-level
guard would reject the worker's `SERVICE_TOKEN` on `recordFfprobe` too. So `AdminGuard` goes on the
three admin methods individually and `@AllowService()` on `recordFfprobe` alone. `JwtAuthGuard` is
already `APP_GUARD`, so the three unguarded-by-`AllowService` methods reject a service principal on
their own; `AdminGuard` is what turns "any signed-in user" into "an administrator".

On the `worker` side the probe already happens in exactly one place: `getMetadata` in
`src/ffmpeg/metadata.ts`, called by `encode.ffmpeg.ts` before it builds the FFmpeg command. The
recording is a GraphQL call, and the encode driver is explicitly a **no-GraphQL, no-database** seam
(its own header comment, and `services/worker/CLAUDE.md` § "The encode driver seam"). Calling
`fetchGraphQL` from inside `encode.ffmpeg.ts` would put a network write behind the FFmpeg-only
driver, where the mock cannot exercise it and no test can reach it without FFmpeg.

The alternative that was rejected is returning the probe out of the driver for `encode.job.ts` to
record: the driver only returns once the encode has finished, which is precisely what REQ-1 forbids.

So the plan **reuses the `onProgress` pattern**: `EncodeFn` (`src/encode/types.ts`) gains a second
callback, `onProbe(file, ffprobe)`, supplied by `handleEncode` and invoked by `encode.ffmpeg.ts`
immediately after `getMetadata` returns and before `buildFfmpegCommand`. The GraphQL call stays in
`jobs/encode.job.ts` next to `encodeStarted`/`encodeProgress`, the driver stays free of network
calls, and the callback is stubbable in a spec with no FFmpeg. `encodeMock` never calls it — it runs
no `ffprobe`, and REQ-1 is scoped to probes that produced output.

`onProbe` receives the **raw stdout string**, not the parsed object. `getMetadata` currently
`JSON.parse`s and discards the string, so it must return both, or the caller must re-serialize.
Re-serializing loses key order and formatting, and the corpus in `services/worker/ffmpeg/` is
verbatim `ffprobe` output — so `getMetadata` returns `{ metadata, raw }` and `encode.ffmpeg.ts`
passes `raw` through untouched (spec REQ-1, AC-2).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration and the mutation the worker calls. Until `recordFfprobe` exists, every worker call fails — and by NFR-1 fails *silently*, so a worker-first order produces a feature that looks finished and stores nothing. |
| 2 | `worker` | Calls the mutation. Its code can be **written** in parallel with step 1 (the contract is frozen below, and `worker` retypes it by hand anyway), but it cannot be verified until `api` is running with the migration applied. |
| 3 | `docs` | `docs/spec/graphql-contract.md` gains a `023` section and the two new keys in its vocabulary table; the root `CLAUDE.md` and `services/*/CLAUDE.md` get their notes. Last, once the shipped shape is known. |

Steps 1 and 2 may overlap for authoring. **Verification cannot**: every acceptance criterion in
`spec.md` needs both sides running.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved`. Things an implementer will
be tempted to change, and must not:

- **`ffprobe: String!`, not a JSON scalar.** It will look like an obvious improvement from inside
  `api`. This repo has no custom scalars, `errorParams` already travels as a hand-encoded `String`,
  and AC-2 requires the stored bytes to be the verbatim probe — a scalar that round-trips through
  `JSON.parse`/`JSON.stringify` reorders keys and reformats numbers.
- **`recordFfprobe` returns `FfprobeLog!`, and the worker ignores it.** Do not narrow it to
  `Boolean!` because the only caller discards it; do not make the worker read a field off it.
- **No `processJobId` argument, no relation.** Adding one is a contract change and, worse, invites
  the `onDelete: Cascade` that `spec.md` § Data Model Changes explicitly refuses.
- **No update mutation.** `spec.md` § Out of Scope says why. "A normal CRUD has one" is not a reason
  (Constitution, Article X).
- **`error.auth.admin_required`'s English text is `You do not have permission to manage users`.**
  It reads oddly outside `users/`, but it is an existing frozen key with an existing `web`
  translation. Do not add a second admin key for this feature and do not reword the template.

## Migrations

Owned by `api`, generated through `bin/npm api run prisma:migrate` (never a hand-written `.sql`,
never SQL run against the live database — Constitution, Article III).

1. `add_ffprobe_logs` — creates `ffprobe_logs` with `id` (autoincrement PK), `file`
   `VARCHAR(500) NOT NULL`, `ffprobe` `MEDIUMTEXT NOT NULL`, `createdAt` `DATETIME` defaulting to
   now, and a non-unique index on `file`.
2. Backfill: **none.** New table, no existing rows, no other model touched.

Reversibility: dropping the table loses only diagnostic data — no other model references it, so
nothing dangles. A rolled-back `api` running against a migrated database is also harmless: the
table simply stops being written.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `AdminGuard` applied at **class** level, copying `UsersResolver` | The guard rejects the service principal, `recordFfprobe` 403s, and the worker — correctly, per NFR-1 — swallows it. The feature ships, every encode runs fine, and the table stays empty forever. No error anywhere except one `console.error` in the worker log. | `api` spec asserting the guard is on the three admin methods and **not** on `recordFfprobe`; AC-1 is a live check that a row actually appears. |
| NFR-1's `try/catch` is written too wide | Wrapping the probe itself, not just the recording, turns a real `ffprobe` failure into a silent skip — `error.encode.probe_failed` stops being reported and the encode proceeds with no metadata. | The `catch` goes around the `recordFfprobe` call **only**, inside `handleEncode`'s `onProbe`, exactly like the existing `onProgress` catch. `worker` spec covers "probe throws → encode still fails". |
| `ffprobe` column created as `TEXT` instead of `MEDIUMTEXT` | 64 KB truncation or a rejected insert on exactly the multi-track files worth studying; the worker swallows the error, so only the *interesting* rows are missing. | Named in the migration step above; AC-2 is run against a real multi-audio/multi-subtitle file, not a two-stream one. |
| Recording moved to after the encode (simpler to write, reads the same in a happy-path test) | A killed or failing encode leaves no row — the case REQ-1 exists for. | AC-1 is checked **mid-encode**, while the `ProcessJob` is still `ENCODING`; AC-4 kills a transcode and asserts the row survives. |
| `getMetadata` re-serializes instead of returning raw stdout | Payload parses fine and looks right; key order and formatting differ from real `ffprobe` output, so a case copied into `services/worker/ffmpeg/` is no longer verbatim and the corpus quietly drifts from reality. | `getMetadata` returns `{ metadata, raw }`; AC-2 compares against `ffprobe` run by hand. |
| `onProbe` added as an optional callback | An implementer forgets to pass it from `handleEncode` and TypeScript says nothing. Nothing is ever recorded. | `onProbe` is a **required** parameter of `EncodeFn`, so `index.ts`, `encode.mock.ts` and every call site fail to compile until they are updated. |
| `recordFfprobe` fired without `await` | The container is killed mid-encode with the request still in flight and the row never lands — again, the case the feature is for. | `await` it inside `onProbe`, before the driver continues to `buildFfmpegCommand`, matching the awaited `onProgress` reasoning already documented in `encode.job.ts`. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli api npx prisma migrate status
```

Then the manual pass, with `ENCODE_DRIVER=ffmpeg`:

1. Start an encode on a movie with several audio and subtitle tracks. While it is still running,
   `bin/mysql -e 'select id, file, length(ffprobe), createdAt from ffprobe_logs order by id desc limit 1'`
   — the row is already there (AC-1).
2. `bin/mysql -N -e 'select ffprobe from ffprobe_logs order by id desc limit 1' | jq '.streams | length'`
   against the same count from `ffprobe` run by hand on that file (AC-2).
3. Re-run the same encode; the table holds two rows for that path (AC-3).
4. `docker compose restart worker` mid-transcode; the row is still there (AC-4).
5. `docker compose stop api`, run an encode, read `docker compose logs worker` for the swallowed
   recording error, confirm the job still reaches `COMPLETED` (AC-5). Bring `api` back up.
6. In the GraphQL playground as an administrator: `ffprobeLog(id: 999999)` (AC-6), `ffprobeLogs`
   paging with `take`/`skip` (AC-8), `deleteFfprobeLog` twice on the same id (AC-9). Repeat
   `ffprobeLogs` as a non-admin user and with the `SERVICE_TOKEN` — both rejected (AC-7).
