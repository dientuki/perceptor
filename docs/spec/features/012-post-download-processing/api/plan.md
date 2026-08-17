---
title: Post-Download Processing — api slice
service: api
last_updated: 2026-08-17
status: Approved            # Draft | Approved | Implemented
---

# PLAN: Post-Download Processing — `api` (`api/plan.md`)

## Scope

This slice is small on purpose: expose one new field on `EncodeJobDetails` so the worker can perform
the containment check of REQ-12, and correct one stale schema comment. Everything else in this
feature — the cleanup branching, the error isolation, the deletion itself — belongs to `worker`,
because `api` has neither media volume mounted and cannot touch a file under the downloads root.

`api` explicitly does **not**: change `downloadRemove` (its `omitido: …` response and its
`deleteFiles: true` both stay exactly as they are, per `../plan.md` § Contract Freeze), add a
mutation for reporting cleanup results, or touch `DownloadsService`/`MediaSourcesService`, whose
behaviour this feature documents but does not modify.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report
(`.claude/agents/api.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/process-jobs/entities/encode-job-details.entity.ts` | Modified | Add `downloadsRoot: string` as `@Field()`, non-null, with a comment saying why it is the root and not `path_downloads` |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `getEncodeJobDetails` resolves `downloadsRoot` into `base`, so both the MOVIE and EPISODE branches carry it |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | New `describe` block for `downloadsRoot` (see § Tests) |
| `services/api/prisma/schema.prisma` | Modified | Comment above `SourceFile.filePath` corrected — **comment only, no migration** |
| `services/api/src/schema.gql` | Regenerated | Never hand-edited; it is rewritten on boot (Constitution, Article IV) |

## Existing code to reuse

- `services/api/src/media-roots/media-roots.service.ts` — `resolveFromRoot(rootId, relPath)` is the
  single owner of "resolve a path against a declared root". Call it as
  `resolveFromRoot('downloads', '.')`. It already throws the exact
  `La raíz "<label>" no está montada …` message when the volume is missing, which is the behaviour
  the contract delta promises. Do not add a second resolution path and do not read
  `CONTAINER_DOWNLOADS_DIR` directly.
- `services/api/src/process-jobs/process-jobs.service.ts` — `resolveOutputRoot(settingKey)` is the
  shape to follow, but **not** the method to extend: it takes a settings key and this does not.
  A sibling private helper (or an inline call, given it is one line) is right; adding a
  `'path_downloads'` value to `resolveOutputRoot`'s union is wrong for the reason in
  `../plan.md` § Contract Freeze.
- The `base` object literal in `getEncodeJobDetails` — `downloadsRoot` belongs there, alongside
  `downloadPath` and `sourceKind`, not duplicated into each of the two branches. `outputRoot` is
  per-branch because it depends on `kind`; this one does not.
- `services/api/src/process-jobs/process-jobs.service.spec.ts` — the existing suite already mocks
  `PrismaService`, `SettingsService` and `MediaRootsService` and injects `QbittorrentClient` and
  `MediaServerService` as `{}`. Extend that setup; do not build a second harness.

## Steps

1. Add `downloadsRoot: string` to `EncodeJobDetails`
   (`entities/encode-job-details.entity.ts`) as a non-null `@Field()`, placed next to `outputRoot`,
   with a comment recording that it is the downloads **root** — not `path_downloads` — because
   torrents save under `<root>/<path_downloads>/<hash>` while uploads stage under
   `<root>/imports/<uploadId>`, and the worker's containment check has to cover both.
2. In `getEncodeJobDetails`, resolve it once and put it in `base`:
   `downloadsRoot: this.mediaRoots.resolveFromRoot('downloads', '.')`. Both return branches inherit
   it through the spread — verify neither branch shadows it.
3. Correct the comment above `SourceFile.filePath` in `prisma/schema.prisma`: the original **is**
   deleted after a successful encode (REQ-10), for torrents today and for every source kind after
   this feature. Do not run `prisma migrate dev` — a comment produces no migration, and an empty
   migration directory must not be committed.
4. Extend `process-jobs.service.spec.ts` with the `downloadsRoot` block described below.
5. Run the typecheck and the suite; confirm `src/schema.gql` regenerated with the new field.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, which is read-only:

```graphql
type EncodeJobDetails {
  # …every existing field, unchanged…
  downloadsRoot: String!
}
```

- Non-null. If the downloads root is not mounted, `resolveFromRoot` throws and the whole
  `processJob(id)` query fails with the existing
  `La raíz "Descargas" no está montada en este container — revisá HOST_DOWNLOADS_DIR en el .env y
  volvé a levantar el stack.` That is the intended outcome, not something to catch and soften.
- `processJob(id)` keeps `@AllowService()`. No new operation, no changed signature, no new argument.
- Every other error string this operation can produce is unchanged and must not be reworded:
  `El processJob <id> no existe`, `Falta la setting "path_movies" — configurala en Settings antes de
  encodear.`, `El processJob <id> no tiene movie ni episode asociado`.

If the delta turns out to be wrong, stop and report — do not adapt it locally.

## Tests

- `services/api/src/process-jobs/process-jobs.service.spec.ts` — a new `describe` block for
  `downloadsRoot`, opening with a header comment naming the silent failure: resolving the wrong root
  makes every uploaded file fail the worker's containment check, so cleanup skips it forever with no
  error in any log and the disk fills. Cases:
  - asserts `mediaRoots.resolveFromRoot` is called with exactly `('downloads', '.')` — **verify this
    case fails when the argument is switched to the `path_downloads` setting**, the way
    `011-av1-transcode`'s `iso3`/`iso2` case was verified;
  - asserts the resolved value reaches the returned payload for a `MOVIE`;
  - asserts the same for an `EPISODE`, so a future edit that moves the field into one branch is
    caught.

Not owed a test: the `schema.prisma` comment (documentation), and the entity decorator itself (a
missing `@Field` is caught by the generated `schema.gql`, which `../plan.md` § Verification greps).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/cli api cat src/schema.gql | grep 'downloadsRoot'
```

0 typecheck errors; the suite green with no fewer than its current 13 suites and one more `describe`
block in `process-jobs.service.spec.ts`; `migrate status` reporting no drift and no new migration;
the grep printing `downloadsRoot: String!`.
