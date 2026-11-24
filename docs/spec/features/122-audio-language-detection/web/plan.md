---
title: Audio Language Detection — web slice
service: web
last_updated: 2026-11-19
status: Implemented
---

# PLAN: Audio Language Detection — `web` (`web/plan.md`)

## Scope

`web` translates one new worker error key, `error.encode.original_audio_undetermined`, so a failed
download row shows a sentence instead of the English fallback. Nothing else changes: no component,
action, query or route. The detection itself is the `worker` slice's job, and `api` relays the key
unchanged.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/messages/en.json` | Modified | `errors.encode.original_audio_undetermined` |
| `services/web/messages/es.json` | Modified | The same key, in the Rioplatense register |

## Existing code to reuse

- The `errors.encode` namespace in both catalogs, beside `no_original_audio`. The download row
  already renders `lastError` through the catalog by key (`065`), so a new entry is all it needs.
- `scripts/check-messages.mjs` — the drift check between the two catalogs.

## Steps

1. Add `"original_audio_undetermined"` under `errors.encode` in `messages/en.json`, right after
   `no_original_audio`: `No audio track is tagged with the original language ({iso3}) and the
   language of the untagged tracks could not be detected`.
2. Add the same key in `messages/es.json`: `Ninguna pista de audio está marcada en el idioma original
   ({iso3}) y no se pudo detectar el idioma de las pistas sin marcar`.

The copy is verbatim from `../spec.md`. Do not reword it.

## Contract obligations

Consumes `errorKey: 'error.encode.original_audio_undetermined'` with `errorParams: { iso3 }` on a
download's `lastError`, the same envelope as every other `error.encode.*`. The placeholder is
`{iso3}` in both catalogs, matching the one param the worker sends. If the key were missing, `web`
would fall back to the worker's English `errorMessage`, so a mistake here is visible rather than
silent. Play keeps retrying the job as it does for any `ERROR` row; no new handling.

## Tests

None owed. `web` has no test runner. The only failure mode, a key in one catalog but not the other,
is caught by `scripts/check-messages.mjs`. A missing key degrades to the English text, which is
visible.

## Done when

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/web":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c 'node scripts/check-messages.mjs'
```

The script exits 0 with both catalogs carrying the key.
