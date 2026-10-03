---
title: Comment Locator Convention — web slice
service: web
last_updated: 2026-10-03
status: Approved
---

# PLAN: Comment Locator Convention — `web` (`web/plan.md`)

## Scope

You sweep the comments in `services/web/src`: roughly **78 Spanish comment lines** and **44 ad-hoc
spec references, 39 of them with no spec number on their line**. The smallest of the three slices by
an order of magnitude — and the one most likely to go wrong for a reason the other two do not face,
because this service is full of Spanish that must **not** be touched.

You do **not** build the validator (`infra` owns `tools/comments/`) and you do **not** touch the
root `CLAUDE.md`, `docs/constitution.md` or `docs/spec/history.md`. Writes are confined to
`services/web/`. No Spanish `it(...)` strings here (REQ-12): `web` has no test suite at all, which
`services/web/CLAUDE.md` records deliberately.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/components/import/importFileModal.tsx` | Modified | 13 lines, the heaviest. Includes the bare `(NFR-1)` that resolves to `// Spec 010, NFR-1; Spec 006, NFR-1b`. |
| `src/components/settings/PathPicker.tsx` | Modified | 7 lines, and three of them quote Spanish setting values — see § Existing code to reuse. |
| `src/components/settings/MediaServerFields.tsx` | Modified | 5 lines. |
| `src/components/form/Select.tsx` | Modified | 5 lines. |
| `src/proxy.ts` | Modified | 4 lines. |
| `src/actions/settings.ts` | Modified | 4 lines. |
| `src/actions/auth.ts` | Modified | 4 lines. |
| `src/types/search.ts` | Modified | 3 lines. |
| `src/components/settings/SchedulingPanel.tsx` | Modified | A mixed comment: English prose with a quoted Spanish button label (`"Ejecutar ahora"`). |

## Existing code to reuse

The procedure is the same as the other two slices and is not optional (`../plan.md` § Risks, row 1):
`git blame -L <line>,<line> --porcelain <file> | grep '^summary'` resolves a bare reference to its
`implement NNN spec` commit; the spec's text must then confirm the id describes this code; anything
unresolved is **deleted** under REQ-4, never guessed. This procedure is verified against *your*
service: `src/components/import/importFileModal.tsx:167`'s bare `NFR-1` blames to
`try to implement 010 episode acquisition spec`, and `010-episode-acquisition` NFR-1 is indeed
"`movieId` is not renamed" — the same answer a hand search through eighty-five `spec.md` files
produces, cross-referenced by `006-media-search` NFR-1b.

The constraint specific to `web`, and the one that makes this slice delicate:

- **`services/web/messages/{en,es}.json` is untouchable.** NFR-6. Every user-facing string in this
  service is catalog-driven since `018-ui-i18n`, and the Spanish half of that catalog is the
  product, not debt. `bin/cli web node scripts/check-messages.mjs` must report the same key count
  before and after your slice — 600 keys as of `080-installable-pwa`.
- **A comment that *quotes* a Spanish UI string stays Spanish inside the quotes.** The prose around
  it becomes English or the comment becomes a locator; the quoted literal is copied verbatim
  because it names a real string a reader has to find. `SchedulingPanel.tsx`'s `"Ejecutar ahora"`
  and `PathPicker.tsx`'s `'.'`/`"la raíz misma"` are the cases. If `bin/comments` flags one of
  these *after* you have made the prose English, the detector's quote-stripping is broken — that is
  an `infra` bug to report, not a comment to mangle.
- **`src/lib/graphql-error.ts`** — `059-season-pack-acquisition-ui` fixed a real bug here
  (`extensions.i18n.params` was `JSON.parse`d when `api` sends a plain object) and the comments
  around it carry that history. They resolve to `Spec 018, REQ-7` / `Spec 059` — blame will say
  which. Do not delete the behaviour, only the prose.
- **`services/web/CLAUDE.md`** needs no REQ-13 repair: nothing in it instructs a reader to preserve
  a comment. Read it anyway for § testing (there is no suite, by design) so you do not invent one.

## Steps

1. `bin/comments web`. The output is the worklist, and it is short enough to work top to bottom.
2. Per finding: blame → confirm the requirement sentence → `// Spec NNN, <ref>`; otherwise delete.
   Deletion is the default, not the fallback.
3. `importFileModal.tsx` is the one file to do carefully rather than quickly: its comment is the
   whole reason this feature exists (a bare `NFR-1` resolving to two specs), and the `movieId`
   metadata key it describes is a live item in the root `CLAUDE.md` § *Known debt*. The locator
   replaces the prose; the debt note in `CLAUDE.md` is the orchestrator's, not yours, and it stays.
4. Run the NFR-1 code-change guard from `../plan.md` § Verification over your own diff and account
   for every line it prints. In `.tsx` a deleted comment line sitting inside JSX is the realistic
   way this goes wrong.
5. **Do not run `bin/npm web run build`.** It writes `.next` into the host working copy and
   un-hydrates every page of a running dev stack. The gate for this service is
   `bin/cli web npx --no tsc --noEmit` plus `check-messages`; the orchestrator runs the build, if at
   all, with the stack down.
6. **Report the resolution table**: `file:line`, the blame commit subject, the locator you wrote,
   and the first line of the requirement it points at.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None** — no query, mutation, field or error condition
changes, so there is nothing new for this service to retype and no new error branch to handle. The
existing hand-retyped shapes in `src/lib/graphql-client.ts` and the server actions under
`src/actions/` stay byte-identical; you are editing the comments above them.

**No production code changes.** `bin/cli web npx --no tsc --noEmit` reports 0 errors and
`check-messages` reports no drift at the same key count.

## Tests

**Nothing in this slice is owed a test, and this is the reason, not an omission.** `web` has no test
suite — `services/web/CLAUDE.md` records that as a deliberate standing decision, and this feature is
not the one that reverses it. Article IX asks for tests where failure is silent; the failure mode of
this slice (a wrong locator) is invisible to any test by construction, which is why
`../plan.md` § Risks, row 1 answers it with the blame procedure and the resolution table instead.

If you find a deleted comment whose knowledge is load-bearing and has nowhere to go, **stop and
report it** rather than introducing the first test suite in this service as a side effect of a
comment sweep.

## Done when

```bash
bin/comments web                              # 0
bin/cli web npx --no tsc --noEmit             # 0 errors
bin/cli web node scripts/check-messages.mjs   # no drift, same key count as before
git diff --stat services/web/messages/        # empty
```

Plus the resolution table in your report, and the code-change guard accounted for.
