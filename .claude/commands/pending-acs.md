---
description: Refresh docs/spec/pending-acs.md after an /implement — regenerate the counts, then write the obs a human has to write
argument-hint: [NNN or slug — the feature just implemented; empty refreshes everything]
allowed-tools: Read, Edit, Glob, Grep, Bash
---

Refresh `docs/spec/pending-acs.md` after implementing **$ARGUMENTS** (if empty, refresh the whole
document).

`/implement`'s step 5 invokes this, after it has appended `history.md`'s entry (REQ-11 of
`086-comment-locator-convention`) and after its step 4 ticked every criterion it saw hold. It stays
its own command because it is also worth running on its own — after a verification pass that ticked
boxes without implementing anything, or just to re-read where the backlog stands.

The division of labour: `/implement` closes a feature, this re-states what the project still has
not verified. The two numbers it keeps honest are the only ones that matter — how many acceptance
criteria are open, and what each one is waiting on.

## 1. Regenerate the mechanical half

```
bin/pending-acs
```

That rewrites the four marked blocks — intro, stats, per-spec table, per-blocker rollup — from the
specs themselves. **Never hand-edit those blocks.** The script reports three things; each one is a
job for you:

| It says | You do |
| :-- | :-- |
| `Cerradas al 100% (fila eliminada): NNN` | Nothing — the row is gone because every box is ticked. Mention it in the report. |
| `Nuevas en la tabla (necesitan obs): NNN` | Step 2 for that spec. |
| `Con obs sin escribir: NNN` | Step 2 — a previous run left a placeholder. |

If it reports nothing and says `ya esta al dia`, the implement you just finished ticked no boxes and
opened none. Say so plainly rather than inventing a change.

## 2. Write the `obs` for anything flagged

The `obs` column is the whole point of the document. A bare count is what the spec already said; the
`obs` is why the remaining boxes are not ticked. For each flagged spec, read its `spec.md` — the
open criteria themselves and its `**Verification status**` block if it has one — and write a cell:

```
| NNN | slug | status | 7/15 | 1, 2, 8, 9, 10, 11, 12 | **<Blocker>.** <por que, concreto> |
```

Rules for that cell:

- **The bolded lead is the blocker's name, and it is a grouping key.** Reuse an existing label
  verbatim when it is the same blocker — `**Una corrida de pipeline.**`, `**Sesion admin en un
  browser.**`, `**Una instalacion fresca.**`, `**Un segundo usuario.**`, `**Un token de usuario
  logueado.**` A new label is a new row in the rollup, so only invent one for a genuinely new kind
  of blocker.
- **Name what was measured, not what you assume.** `process_jobs = 0 filas` is a blocker;
  "probablemente falte correr el pipeline" is not. If you have not measured it, measure it or say
  the blocker is unknown.
- **Say what is already proven underneath.** A criterion whose unit half is green and whose live
  half is not is a different problem from one nobody has touched, and the cell should distinguish
  them.
- **Never tick a box from here.** This command writes a document about unticked criteria; ticking
  one is `/implement`'s step 4, and it needs the criterion observed holding.

Then run `bin/pending-acs --check` to confirm the document is consistent.

## 3. Keep the hand-written sections honest

Below the rollup the document carries sections the script does not touch — the cheap group, the
suggested order. They are judgment and they go stale. Re-read them and correct anything the new
numbers contradict: a spec that moved blocker, an AC that is no longer cheap because its
precondition now exists, an ordering that a closed feature made wrong.

## 4. Report

The before/after counts, the rows that disappeared, the `obs` you wrote, and anything in the
hand-written sections you corrected. If a blocker changed character — something that was unreachable
became reachable — say it, because that is the one finding this document exists to surface.

Do not commit unless the user asks.
