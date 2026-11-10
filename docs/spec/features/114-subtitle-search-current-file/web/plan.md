---
title: Subtitle search outcome follows the current file — web slice
service: web
last_updated: 2026-10-30
status: Approved         # Draft | Approved | Implemented
---

# PLAN: Subtitle search outcome follows the current file — `web` (`web/plan.md`)

## Scope

`web` renders two new per-language outcomes and drops one (REQ-6). It does not decide anything:
`api` sends the final outcome and `web` only colours and labels it. No new query, field, action or
component.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/media.ts` | Modified | `SubtitleSearchLanguageOutcome`: `"EMBEDDED"` → `"RESOLVED"`, add `"MISSING"` |
| `services/web/src/components/media/SubtitleSearchStatus.tsx` | Modified | `OUTCOME_TEXT_CLASS`: `RESOLVED` green, `MISSING` red |
| `services/web/messages/es.json` | Modified | `media.subtitleSearch.outcome`: drop `EMBEDDED`, add `RESOLVED` "Resuelto", `MISSING` "Falta en el archivo" |
| `services/web/messages/en.json` | Modified | same keys: "Resolved", "Missing from file" |

## Existing code to reuse

- `SubtitleSearchStatus.tsx`'s `OUTCOME_TEXT_CLASS` and `label("outcome", …)`: colour and label
  already come from these two lookups. Add entries; don't add a branch. `RESOLVED` takes the
  `text-green-500` that `EMBEDDED` had. `MISSING` takes `text-error-500`, the class
  `FAILED`/`REJECTED` use.
- `label()` already falls back to the raw value for an unknown key. That fallback is the
  mixed-version behaviour the contract relies on; leave it alone.

## Steps

1. `types/media.ts`: update the union.
2. `SubtitleSearchStatus.tsx`: rename the `EMBEDDED` entry to `RESOLVED` and add `MISSING`.
3. `messages/es.json` and `messages/en.json`: rename `EMBEDDED` → `RESOLVED` with the new copy and
   add `MISSING`, keeping the two catalogs key-identical.

## Contract obligations

Consumes `SubtitleSearchLanguageOutcome` exactly as `../spec.md` lists it. `reasonKey` is `null` for
`RESOLVED`/`MISSING`, so those lines render through `languageLine` (no reason), which the component
already does when `reasonKey` is null. No error conditions are added. An unknown outcome string
renders raw in the neutral colour.

## Tests

None owed. The slice is two lookup-table entries and two catalog strings with no branch.
`check-messages.mjs` already catches a key present in one catalog and missing in the other, and the
type union makes a leftover `"EMBEDDED"` reference a compile error.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

All exit 0, and `grep -rn EMBEDDED services/web/src services/web/messages` matches only
`SubtitleSearchStatus` values (`EMBEDDING`), never the outcome.
