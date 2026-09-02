---
title: Encode Report Durability — web slice
service: web
last_updated: 2026-09-01
status: Approved
---

# PLAN: Encode Report Durability — `web` (`web/plan.md`)

## Scope

This slice is two catalog lines. `api` starts throwing one new REST error key on the `/uploads`
surface (`error.upload.superseded`); `web` translates it so the upload modal renders it in the
active locale instead of falling back to English.

It does **not** change any component, action, type, route or piece of logic. If this slice touches
a `.tsx` or a `.ts` file, the plan missed something — stop and report. The upload modal's existing
REST-error reader already resolves the top-level `i18n` shape; there is nothing to wire.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/messages/es.json` | Modified | `errors.upload.superseded` |
| `services/web/messages/en.json` | Modified | `errors.upload.superseded` |

## Existing code to reuse

- `services/web/messages/{en,es}.json` — the `errors.upload.*` namespace already holds the four REST
  upload keys (`ticket_expired`, `ticket_wrong_movie`, `ticket_wrong_episode`,
  `metadata_incomplete`). The new entry goes beside them, same shape, same nesting: the catalog
  strips the leading `error.` and nests the rest, so `error.upload.superseded` →
  `errors.upload.superseded`.
- The upload modal's REST-error reader — reads `i18n.key` from the response body directly (the REST
  envelope is **not** wrapped in `extensions`, unlike a GraphQL error). Already handles an unknown
  key by falling back to the English `message`, which is exactly why this slice is only copy.

## Steps

1. Add `superseded` to `errors.upload` in `services/web/messages/es.json`, in the Rioplatense
   register the file already uses: `"Otra subida más nueva reemplazó a esta"`.
2. Add the same key to `services/web/messages/en.json`: `"Superseded by a newer upload"`.

Keep both files' key ordering consistent with each other — the two catalogs are read side by side
when a translation is missing.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta — **read-only**:

- `error.upload.superseded`, HTTP `409`, arriving on the REST `/uploads` response body as
  `{ message, i18n: { key: "error.upload.superseded" } }` — **no `params`**, so the Spanish string
  must not contain an interpolation placeholder.
- No GraphQL surface changes. `web` retypes nothing new; no action file is touched.

The Spanish string is user-facing copy and therefore stays Spanish (root `CLAUDE.md` § Conventions);
everything else committed stays English.

## Tests

**None owed.** `web` has no test suite (`services/web/CLAUDE.md`), and a missing catalog entry does
not fail silently in a way a test could catch here: the documented fallback renders the English
`message` from the wire, which is visible rather than blank. The build is the gate.

## Done when

```bash
bin/npm web run build
```

Exits 0. Then confirm by eye that both JSON files parse and the new key sits inside
`errors.upload`, not at the top level.
