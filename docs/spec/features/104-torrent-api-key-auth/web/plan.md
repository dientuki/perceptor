---
title: qBittorrent Authenticated by API Key, Not by Subnet — web slice
service: web
last_updated: 2026-10-25
status: Approved
---

# PLAN: qBittorrent Authenticated by API Key, Not by Subnet — `web` (`web/plan.md`)

## Scope

`web` translates `error.download.torrent_client_unauthorized` in both locales. It adds no component,
action or state: the key reaches the screen through the same generic path every keyed error already
takes. `web` does not decide when the key is raised; `api` does.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/messages/en.json` | Modified | `error.download.torrent_client_unauthorized`, beside `torrent_client_rejected` |
| `services/web/messages/es.json` | Modified | Same key, Rioplatense text |

## Existing code to reuse

- `src/lib/graphql-error.ts`: `translateGraphQLError` and `translateErrorKey` strip the `error.`
  prefix and look the rest up in the catalog. A key present in the catalog renders wherever any
  action already shows a translated error: the `/downloads` controls, the detail pages' download
  panels, and the torrent and magnet modals of films, episodes and seasons. Nothing else needs
  wiring.

## Steps

1. Add the two entries, text copied verbatim from `../spec.md` § GraphQL Contract Delta:
   - en: `The torrent client rejected Perceptor's credential: an administrator needs to check TORRENT_API_KEY`
   - es: `El cliente de torrents rechazó la credencial de Perceptor: un administrador tiene que revisar TORRENT_API_KEY`
2. Check that both catalogs still parse and carry the same key set under `error.download`.

## Contract obligations

Consume `error.download.torrent_client_unauthorized` (no params) wherever a torrent-client error is
shown today. Also make sure the six acquisition modals render the newly keyed
`error.download.torrent_client_rejected` (`{status}`): its catalog entry already exists, so this is a
check, not a change. There is no retry and no special flow for either key.

## Tests

None owed. A missing catalog entry is not silent: `translateErrorKey` falls back to `api`'s English
message, so the user still sees a meaningful sentence. The parse-and-parity check in step 2 is the
whole verification.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
```

The typecheck reports 0 errors, and running `node -e` inside the `web` container over the two
catalogs prints the same `error.download` key list for both.
