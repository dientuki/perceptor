---
title: Post-Download Processing — worker slice
service: worker
last_updated: 2026-08-17
status: Implemented            # Draft | Approved | Implemented
---

# PLAN: Post-Download Processing — `worker` (`worker/plan.md`)

## Scope

This slice owns every behavioural change in the feature. All three defects live in the cleanup block
at the end of `src/jobs/encode.job.ts`: it runs only for torrents (REQ-10), it runs inside the
encode's `try` where a failure demotes a finished job (REQ-11), and it deletes an unchecked path
(REQ-12). The work is to lift that block into a module of its own, branch it on `sourceKind`, guard
it with a containment check, and call it where a failure cannot reach the job's status.

This slice does **not** touch `api`, and does not change what the encode itself produces — the
FFmpeg rules are frozen by `011-av1-transcode`. It also does not change the scan's behaviour; the
scan gets tests (NFR-6) because it has none and its selection rule fails silently, not because this
feature alters it. `api` supplies `downloadsRoot` on `EncodeJobDetails`; this slice consumes it and
resolves nothing itself (NFR-4, NFR-5).

Writes are confined to `services/worker/` and this directory. Anything else is a stop-and-report
(`.claude/agents/worker.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/paths/is-inside-root.ts` | New | Pure containment predicate: is an absolute path inside an absolute root |
| `services/worker/src/paths/is-inside-root.spec.ts` | New | Shared-prefix sibling, traversal, missing root |
| `services/worker/src/jobs/cleanup-source.ts` | New | The whole post-encode cleanup, branching on `sourceKind`, never throwing |
| `services/worker/src/jobs/cleanup-source.spec.ts` | New | Every source kind, the containment refusal, the error isolation |
| `services/worker/src/jobs/encode.job.ts` | Modified | `downloadsRoot` added to the query and to `EncodeJobDetails`; the inline cleanup block replaced by a call placed after the encode's `try/catch` |
| `services/worker/src/scan/scan-folder.spec.ts` | New | The largest-video rule, no-video, single-file |

## Existing code to reuse

- `src/api/graphql-client.ts` — `fetchGraphQL` is the only way this service talks to `api`. The
  cleanup's `downloadRemove` call goes through it. Note it **throws** on `json.errors` by design
  (`services/worker/CLAUDE.md` § Errors must not be swallowed); that is exactly why the cleanup
  module has to catch, rather than the client being made lenient.
- `src/jobs/encode.job.ts` — `EncodeJobDetails` is the hand-retyped mirror of the api entity. Add
  `downloadsRoot: string` there and to the `processJob(id)` query in the same edit; adding it to one
  and not the other is the silent drift NFR-3 names.
- `src/paths/build-output-path.ts` — the house pattern for a small pure module here: a locally
  declared input type that is a *subset* of `EncodeJobDetails` rather than an import of it, so the
  module is testable without the GraphQL shape. `cleanup-source.ts` follows it exactly — take a
  narrow `CleanupInput`, not the whole details object.
- The existing `try`/`catch` in `handleEncode` — do not widen it and do not add a second `catch`
  around the encode. The cleanup call goes **after** it, in its own `try`.
- `src/ffmpeg/runner.ts` — the reference for how this service already deletes things safely
  (`rm(..., { force: true })`, every failure path swallowed with a reason). Match its tone.
- Test structure: `src/ffmpeg/remux-detection.spec.ts` — a header comment naming the class of bug the
  suite defends against, then `describe`/`it` in the indicative. Copy that shape (Constitution,
  Article IX).

**Do not** port `MediaRootsService.resolveFromRoot` from `api`. Its `realpath` work exists to defend
a user-supplied relative segment; here the input is an absolute path `api` wrote itself and the
question is only containment. The relevant piece of prior art is
`MediaRootsService.containerToHostPath`'s guard — a prefix test with the separator appended — and
what is being reused is that reasoning, not the code (the worker's build context cannot see
`../api`).

## Steps

1. **`src/paths/is-inside-root.ts`** — export `isInsideRoot(root: string, candidate: string):
   boolean`. `resolve()` both, then true only when they are equal or the candidate starts with
   `root + sep`. An empty or non-absolute `root` returns **false** — a missing `downloadsRoot`
   (the drift NFR-3 warns about) must refuse, never pass. No filesystem access.
2. **`src/jobs/cleanup-source.ts`** — export `cleanupSource(input: CleanupInput): Promise<void>`,
   with `CleanupInput = { mediaSourceId, sourceKind, infoHash, downloadPath, downloadsRoot }`
   declared locally. Order:
   - When `infoHash` is non-null, call `downloadRemove(mediaSourceId: Int!)` through `fetchGraphQL`
     first, so the client releases the files before anything on disk moves.
   - Return early, logging, when `downloadPath` is null.
   - Refuse and log when `isInsideRoot(downloadsRoot, downloadPath)` is false — delete nothing.
   - Then, by `sourceKind`: `LOCAL_FILE` → `rm(downloadPath, { force: true })` followed by a
     **non-recursive** `rmdir` of its parent directory, whose failure (`ENOTEMPTY`, anything) is
     swallowed; every other kind → `rm(downloadPath, { recursive: true, force: true })`.
   - The function must not throw. Every failure is caught and logged with `[cleanup]` and the
     mediaSource id.
3. **`src/jobs/encode.job.ts`** — add `downloadsRoot` to the `processJob(id)` query selection *and*
   to the local `EncodeJobDetails` type. Delete the `if (details.infoHash) { … }` block from inside
   the `try`. After the `try/catch` closes, call `cleanupSource(...)` — wrapped in its own `try`
   whose `catch` only logs, as a second line of defence should the module ever throw despite step 2.
   Keep the comment explaining that the media-server notification is `api`'s job.
4. **`src/scan/scan-folder.spec.ts`** — cover the rule that has no test today and fails silently.
5. Run the typecheck and the suite.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, which is read-only:

```graphql
type EncodeJobDetails {
  # …every existing field, unchanged…
  downloadsRoot: String!
}
```

- Non-null on the wire, but this service must not *assume* it: until `api` ships the field it
  arrives `undefined`, and a containment helper that reads that as "pass" would delete outside the
  root. Step 1's refuse-on-empty is what makes that safe, and `is-inside-root.spec.ts` covers it.
- It is the downloads **root**, not the `path_downloads` segment. Both a torrent save path and an
  upload staging directory are under it; neither is under the other.
- It is an absolute container path. Do not translate it, do not compare it against any environment
  variable, and do not read `CONTAINER_DOWNLOADS_DIR` (NFR-4, Constitution Article V).
- `downloadRemove(mediaSourceId: Int!): String!` is unchanged. It answers
  `omitido: mediaSource <id> no es un torrent` for a source with no infohash — this service must no
  longer treat that as "nothing to delete", which is why it branches on `sourceKind` for the
  filesystem work and only guards the *mutation* on `infoHash`.
- Errors this service must handle rather than propagate: `fetchGraphQL` throwing on a GraphQL error
  or a non-2xx (an unreachable `api`, a stopped `torrent` container surfacing as a qBittorrent
  failure), and any `rm`/`rmdir` rejection. All of them are logged and swallowed inside the cleanup —
  REQ-11 makes this the one place in the service where swallowing an error is correct, and the
  reason must be written in a comment so it is not "fixed" later against
  `services/worker/CLAUDE.md` § Errors must not be swallowed.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

Article IX bites hard here: every defect in this feature produces a completed job, a correct file
and no error in any log.

- `src/jobs/cleanup-source.spec.ts` — the core suite. Header comment naming the failure: cleanup
  that skips a source kind, or that deletes outside the root, or that lets its own error reach the
  job, is invisible from every log and every table. Cases:
  - `LOCAL_FILE` deletes the file and rmdirs its staging directory — **verify it fails when the
    branch is switched back to `infoHash`**, which is the bug being fixed;
  - `LOCAL_FILE` whose staging directory is not empty keeps the directory and does not throw;
  - `TORRENT_SEARCH`/`TORRENT_FILE` call `downloadRemove` and then delete recursively;
  - `LOCAL_FILE`/`LOCAL_FOLDER` never call `downloadRemove`;
  - a `downloadPath` outside `downloadsRoot` deletes nothing at all;
  - an empty/undefined `downloadsRoot` deletes nothing at all;
  - a throwing `fetchGraphQL` does not propagate;
  - a throwing `rm` does not propagate.
- `src/paths/is-inside-root.spec.ts` — the shared-prefix sibling (`/media/downloads-old` is not
  inside `/media/downloads`), the root itself, a nested path, a `..` traversal that lands outside,
  and a non-absolute or empty root refusing.
- `src/scan/scan-folder.spec.ts` — the largest video wins regardless of name; a non-video larger
  file does not win; a folder with no video yields `matchedFilePath: null`; a single-file
  `downloadPath` is inventoried as one entry. Uses a real `mkdtemp`, the way
  `media-roots.service.spec.ts` does on the api side, because the rule is about real `stat` sizes.

Not owed a test: `handleEncode`'s overall orchestration — a spec for it would be mock choreography
asserting the order of five awaited mutations, which breaks on every refactor and catches nothing
the three suites above miss. The one thing about it that matters — that a cleanup failure cannot
fail the job — is covered by `cleanup-source.spec.ts` not throwing, plus AC-6 live.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

0 typecheck errors; the suite green at 4 suites plus the 3 new ones, with no test removed. Confirm
`grep -n "infoHash" src/jobs/encode.job.ts` no longer shows a filesystem operation guarded by it.
