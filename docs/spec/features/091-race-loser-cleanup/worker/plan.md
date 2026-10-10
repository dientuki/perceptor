---
title: The Race Loser Sweep Actually Sweeps — worker slice
service: worker
last_updated: 2026-10-08
status: Approved
---

# PLAN: The Race Loser Sweep Actually Sweeps — `worker` (`worker/plan.md`)

## Scope

One term comes out of one condition, and one test is inverted to match. `cleanup-source.ts` calls
`downloadRemove` only `if (removeTorrent && infoHash)`; the second term is what stops the loser
sweep from ever running for a winner that is an uploaded file. Removing it is the whole slice.

This is small and it is not cosmetic: it is the bug that shipped past `022-download-status-tags`,
whose own prose warned about it, and the reason it survived is a test that asserts it as correct.
Inverting that test is as much the deliverable as the line itself.

The worker is **not** gaining any new knowledge about races, siblings or losers. It does not know
what `downloadRemove` does internally and must not start caring: `api` decides what to remove.
`CleanupInput` gains no field, `EncodeJobDetails` is unchanged, and the mutation document, its
arguments and its name stay exactly as they are.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/jobs/cleanup-source.ts` | Modified | `if (removeTorrent && infoHash)` → `if (removeTorrent)` |
| `services/worker/src/jobs/cleanup-source.spec.ts` | Modified | the `LOCAL_FILE` assertion inverted; a `LOCAL_FOLDER` case added |

## Existing code to reuse

- `src/jobs/cleanup-source.ts`'s own structure — the `try { fetchGraphQL(...) } catch { log }` around
  the mutation already matches the house posture for a call to `api` that must not fail the cleanup.
  Nothing moves; only the condition narrows.
- The existing `// Spec 013, REQ-8` locator above that condition — it is the locator that has always
  been wrong about this line. `013` REQ-8's text is that cleanup fires by how many episodes a source
  carries, "never on whether it was a torrent or a local file", so the removed term contradicted the
  requirement it cited. Keep the `013` locator (the `removeTorrent` flag is still `013`'s) and add
  `091`'s per Article XI exception 4: `// Spec 013, REQ-8; Spec 091, REQ-1`.
- `src/jobs/cleanup-source.spec.ts`'s `fetchGraphQLMock` — the assertion surface. The inverted test
  asserts it **was** called, with the same `mediaSourceId`, not merely that it was called.

## Steps

1. In `src/jobs/cleanup-source.ts`, drop `&& infoHash` from the `removeTorrent` condition and extend
   the locator comment to `// Spec 013, REQ-8; Spec 091, REQ-1`. `infoHash` stays on `CleanupInput`
   and stays destructured — the filesystem branches below still read it.
2. In `src/jobs/cleanup-source.spec.ts`, invert
   `it('never calls downloadRemove for a LOCAL_FILE source')`: rename it to state that a
   `LOCAL_FILE` winner **does** call `downloadRemove`, and assert `fetchGraphQLMock` was called with
   that `mediaSourceId`. Do not delete the case — the rename is the record of the decision.
3. Add the same assertion for the `LOCAL_FOLDER` case in the next `describe` (today it asserts the
   mutation is never called, for the same wrong reason) and keep its folder-deletion assertions as
   they are.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- `downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!` — unchanged in every
  respect. The worker keeps sending `deleteFiles: false`; `api` owns whether the winner has a
  torrent to remove and owns the loser sweep that follows.
- `api` answers `omitido: mediaSource <id> no es un torrent` for a winner with no `infoHash`. That
  string is a **success**, not a failure, and has never meant "cleanup is done"
  (`012-post-download-processing`). The existing `catch` logs transport errors only; do not start
  branching on the response body.
- `removeTorrent` keeps its meaning: `api` sets it when this is the last `ProcessJob` of the source
  to finish. The worker does not re-derive it and does not qualify it.

## Tests

`src/jobs/cleanup-source.spec.ts` is owed the inversion, and it is owed for the Article IX reason
exactly: the failure here produces no error anywhere. An upload wins a race, its encode succeeds,
its own files are cleaned up correctly — and two torrents keep downloading forever with a green
suite, a clean log and a `COMPLETED` title. The two cases above are the only ones in this service
that can detect it.

Nothing else in this slice is owed a test: no new module, no new branch, no new payload field.

## Done when

```bash
bin/npm worker test
bin/cli worker npx tsc --noEmit
bin/comments worker
```
