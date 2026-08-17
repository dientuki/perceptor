---
title: Post-Download Processing — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-17
status: Approved            # Draft | Approved | Implemented
---

# PLAN: Post-Download Processing (`plan.md`)

## Approach

Most of this feature is documentation of code that already runs. The executable part is small and
sits in one place: the cleanup block at the end of
`services/worker/src/jobs/encode.job.ts`, plus the one field `api` has to hand over so that block
can be made safe.

**`api`** adds `downloadsRoot: String!` to `EncodeJobDetails`, resolved with the existing
`MediaRootsService.resolveFromRoot('downloads', '.')`. This reuses the same helper
`ProcessJobsService.resolveOutputRoot` already calls for `path_movies`/`path_shows`; the only
difference is that it resolves the **root itself** rather than a setting under it, so no new
settings key and no new validation path appears. `api` also corrects the now-false comment above
`SourceFile.filePath` in `prisma/schema.prisma`.

**`worker`** does three things. It extracts the cleanup into its own module,
`src/jobs/cleanup-source.ts`, because a block buried in the middle of `handleEncode` cannot be
tested and that is precisely where all three defects live (NFR-6). It selects the cleanup shape from
`sourceKind` rather than from `infoHash` — the substitution that closes REQ-10, since every
`LOCAL_FILE` has a null infohash by definition. And it calls that module from `encode.job.ts`
*after* the encode's `try/catch`, inside a `try` of its own that only logs, which is REQ-11.

The containment check of REQ-12 becomes a new pure helper, `src/paths/is-inside-root.ts`. It is
deliberately **not** a port of `MediaRootsService.resolveFromRoot`: that method's job is to validate
a user-supplied *relative* segment against a root, resolving symlinks with `realpath` because the
attacker there is a settings value someone typed. Here the input is an absolute path the API wrote
itself, and the question is only "is this under that root" — a `resolve()` plus a prefix test with
the separator appended, the same shape as `MediaRootsService.containerToHostPath`'s own guard. Two
services cannot share code anyway (the worker's build context cannot see `../api`), so the reuse
that matters is of the *reasoning*, and the `+ sep` detail is what stops `/downloads-old` from
passing as inside `/downloads`.

An alternative was considered and rejected: having `api` do the deleting. It cannot — neither media
volume is mounted in the `api` container — and mounting them to move one `rm` would put a
destructive filesystem operation in the service that has no other reason to touch disk.

## Order of Work

`api` first. `worker` cannot query a field the schema does not expose, and since there is no codegen
the failure would be a runtime `undefined` rather than a compile error — exactly the drift Article
VIII exists to prevent.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the schema. `downloadsRoot` must exist on `EncodeJobDetails` before anything queries it, and the value must be the downloads **root**, not `path_downloads`. |
| 2 | `worker` | Consumes the new field for REQ-12, and owns every other change in the feature. |
| 3 | `docs` | `docs/spec/graphql-contract.md` gains the `012` section once the shape is real, not before. |

Steps 1 and 2 have one genuinely parallel seam: the worker's extraction of `cleanup-source.ts`, its
`sourceKind` branching (REQ-10) and its error isolation (REQ-11) depend on nothing `api` does, and
can be written while step 1 is in flight. Only the containment check (REQ-12) needs the new field.
If the two are done by separate agents, the worker agent must still write `downloadsRoot` into its
own `EncodeJobDetails` type and query — the contract is frozen, so it is safe to code against it
before `api` ships it, and the field simply arrives `undefined` until it does.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. One field is added
and nothing else changes. Things an implementer will want to change and must not:

- **`downloadsRoot` resolves the root, not `path_downloads`.** From inside `api` this looks wrong —
  every other path field resolves a settings key, and `path_downloads` is right there. It is not
  wrong: torrents land under `<root>/<path_downloads>/<hash>` but tus uploads are staged under
  `<root>/imports/<uploadId>`, anchored to the root on purpose so the final `rename` never crosses
  a filesystem (`UploadsService.moveUploadedFile`). Resolving the narrower path would make every
  uploaded file fail containment and never be cleaned up — reinstating, silently, the exact bug
  this feature exists to fix.
- **`downloadsRoot` is non-null.** It is tempting to make it nullable so a stack with no downloads
  volume can still encode. It cannot: the encode reads its input from that same root, so an
  unmounted downloads root is already a broken job. Failing loudly in `processJob(id)` with the
  existing "raíz no montada" message beats handing the worker a null it would have to interpret.
- **`downloadRemove` keeps returning `omitido: mediaSource <id> no es un torrent`.** The instinct
  will be to "fix" that string or make the mutation delete local files too. It stays: `api` cannot
  delete files, and the worker no longer reads that response as "nothing to delete" — it branches
  on `sourceKind` before deciding whether to call the mutation at all.
- **No new mutation for cleanup.** Cleanup reports nothing back to `api` by design; a cleanup
  failure must not touch job state (REQ-11), so there is nothing for a mutation to record.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

**None.** No model, field or enum changes.

The one `prisma/schema.prisma` edit is a **comment**: the note above `SourceFile.filePath` claiming
the original is never deleted, which REQ-10 contradicts. Prisma comments are not part of the
database, so this produces no migration — do **not** run `prisma migrate dev` after it, and if a
run is triggered for another reason, an empty migration directory must not be committed. Verify
with `bin/cli api npx prisma migrate status` reporting no drift.

Reversibility: n/a — nothing to roll back.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `downloadsRoot` resolved from `path_downloads` instead of the root | Every uploaded file fails containment; cleanup silently skips forever; no error anywhere, the disk just fills — the original bug, restored | `api` spec case asserting `resolveFromRoot` is called with `('downloads', '.')`, verified to fail when the argument is switched |
| The field is added to the entity but not to the worker's query or its local `EncodeJobDetails` | Arrives `undefined`; a naive containment check reads that as "nothing is inside" and stops deleting anything, or worse, as "check passed" | The containment helper treats a missing/empty root as **refuse**, never as pass; `cleanup-source.spec.ts` covers it explicitly |
| Containment implemented as a bare `startsWith` without the separator | `/media/downloads-old` passes as inside `/media/downloads`; a sibling directory gets deleted | `is-inside-root.spec.ts` has the shared-prefix sibling case, the same one `media-roots.service.spec.ts` defends on the api side |
| Cleanup left inside the encode's `try` | A completed encode flips to `ERROR` on any qBittorrent or filesystem hiccup, permanently — no `attempts` anywhere to retry it | `cleanup-source.spec.ts` asserts a throwing dependency does not propagate; AC-6 checks it live with the `torrent` container stopped |
| Branching on `infoHash` instead of `sourceKind` | Uploads keep being skipped — the change looks done and behaves as before | The spec case enumerates all four `SourceKind` values, not just the torrent pair |
| `rmdir` on the upload staging directory made recursive | An `imports/<uploadId>` that holds an unrelated file is destroyed | Non-recursive `rmdir` only, whose `ENOTEMPTY` is swallowed — a leftover directory is a lesser failure than a deleted file |
| The torrent's files are deleted twice | `downloadRemove` already passes `deleteFiles: true` to qBittorrent and the worker then `rm`s the same path | Accepted and documented, not fixed: `force: true` makes the second one a no-op, and NFR-7 forbids changing torrent behaviour in this feature |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli api npx prisma migrate status
bin/cli api cat src/schema.gql | grep -A2 'downloadPath: String'
```

The last command must show `downloadsRoot: String!` on `EncodeJobDetails` — the schema is generated
on boot, so this is the check that the decorator actually landed.

Then the manual pass, with `ENCODE_DRIVER=mock` for everything except the AV1 checks so a run takes
seconds instead of hours:

1. **Upload path (AC-4)** — from `/movies/<id>`, import a file. Note the `imports/<uploadId>`
   directory that appears under the downloads root. Let the encode finish, then confirm the
   directory is gone. This is the criterion that fails today.
2. **Torrent path (AC-5)** — acquire a film by magnet, let it complete, confirm the torrent is gone
   from qBittorrent's list and its save path no longer exists.
3. **Cleanup isolation (AC-6)** — `docker compose stop torrent`, run a torrent-sourced encode to
   completion, then `bin/mysql -e 'select status, errorMessage from process_jobs order by id desc
   limit 1'`. Must read `COMPLETED` with a null error, the file must be in the library, and
   `docker compose logs worker` must carry the cleanup failure. Fails today.
4. **Containment (AC-7)** — `bin/mysql -e "update media_sources set downloadPath='/tmp/not-a-root'
   where id=<id>"` on a source with a prepared `/tmp/not-a-root` directory, run the encode, confirm
   the directory survives and the refusal is logged. Fails today.
5. **Scan failure (AC-8)** — point a source at a folder holding only a `.nfo`, confirm
   `media_sources.status` and `movies.status` both reach `ERROR` with the exact message, and that
   `process_jobs` gained no row.
6. **Encode failure (AC-9)** — a file with no audio track in the original language: job `ERROR`,
   download still on disk, torrent still in the client.
7. **No media server (AC-11)** — `media_server_client = none`, encode completes, `docker compose
   logs api` shows no outbound request.
