---
title: Blu-ray Disc Remux — web slice
service: web
last_updated: 2026-10-21
status: Implemented
---

# PLAN: Blu-ray Disc Remux — `web` (`web/plan.md`)

## Scope

`web` translates the two new worker error keys. It adds no page, no component, no query, no server
action and no GraphQL field. Recognising the disc, choosing the playlist and assembling the MKV are
the worker's; storing the keys is `api`'s existing behaviour.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/messages/en.json` | Modified | `errors.source.disc_playlist_ambiguous`, `errors.encode.disc_remux_failed` |
| `services/web/messages/es.json` | Modified | same two keys, Spanish |

## Existing code to reuse

- `src/components/downloads/DownloadErrorLine.tsx` → `translateErrorKey` (`src/lib/graphql-error.ts`)
  already resolves any `error.*` key against the `errors` namespace and interpolates the source's
  `errorParams`. Both `/downloads` and the film's detail page render through it. Nothing to wire.
- `scripts/check-messages.mjs` — the en/es parity check.

## Steps

1. In both catalogs, under `errors.source`, add `disc_playlist_ambiguous`:
   - `en`: `Could not determine the Blu-ray's main playlist ({playlists}). Assemble the MKV manually and import it from the film's page`
   - `es`: `No se pudo determinar la playlist principal del Blu-ray ({playlists}). Armá el MKV a mano e importalo desde la película`
2. In both catalogs, under `errors.encode`, add `disc_remux_failed`:
   - `en`: `Could not assemble the MKV from the Blu-ray (code {code}): {stderr}`
   - `es`: `No se pudo armar el MKV a partir del Blu-ray (código {code}): {stderr}`
3. Run the checks.

## Contract obligations

Consumes the two keys exactly as `../spec.md` freezes them, with params `playlists` (a string) and
`code`/`stderr`. An unknown key or a missing param is handled by `translateErrorKey`'s existing
fallback to the English `errorMessage` — no new handling. The resume control (Play) for a failed
source is the existing one. The delta is read-only; if it is wrong, stop and report.

## Tests

None owed: two catalog strings, with parity enforced by `check-messages.mjs`. A wrong param name
would render a literal placeholder, which the manual pass (`../plan.md` § Verification, steps 5 and
7) observes on a real failure.

## Done when

```bash
bin/cli web node scripts/check-messages.mjs
bin/npm web run lint
```

Both pass. Do not run `bin/npm web run build` while the dev stack is up: it overwrites the dev `.next` and un-hydrates every page.
