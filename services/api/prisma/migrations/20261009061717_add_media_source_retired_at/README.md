Spec 090 (`A Replaced Source Is Not An Error`).

Adds `MediaSource.retiredAt` and backfills every pre-existing `ERROR` /
`error.source.replaced` row that was already *delivered* (at least one `COMPLETED`
`ProcessJob` via its `SourceFile`, none still `WAITING`/`QUEUED`/`ENCODING`) to
`status = 'SCANNED'`, `retiredAt = updatedAt`, with its replacement error fields cleared.
A row that fails that test (a race loser, or one replaced mid-encode) is left untouched.

**Not safely reversible.** Dropping `retiredAt` is clean schema-wise but lossy
behaviourally: the rows this migration corrected would come back as `SCANNED` with no
error key and nothing marking them replaced — indistinguishable from a live delivered
source — and `087`'s force guard would start refusing replacements for titles the user
already replaced. A rollback must also restore those exact rows to
`ERROR` / `error.source.replaced` (and clear `retiredAt`), not just drop the column.
