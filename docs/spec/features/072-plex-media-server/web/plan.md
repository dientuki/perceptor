---
title: Plex media server client — web slice
service: web
last_updated: 2026-09-26
status: Approved
---

# PLAN: Plex media server client — `web` (`web/plan.md`)

## Scope

`web` makes Settings → Media server describe whichever client is selected instead of describing
Jellyfin: the credential field takes the selected client's own name for it and links to its docs,
and changing the combo swaps the port to that client's default.

It is explicitly **not** doing: adding `Plex` to any list (the combo already renders from
`mediaServerClients` and must keep doing so — no client id may be written by hand in this service),
touching the index panel's behaviour, or changing how settings are saved. `EDITABLE_KEYS` in
`src/actions/settings.ts` already carries the four `media_server_*` keys and needs no change.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/media-server.ts` | Modified | Three optional fields on `MediaServerOption` |
| `services/web/src/actions/media-server.ts` | Modified | The three fields in `MEDIA_SERVER_CLIENTS_QUERY` |
| `services/web/src/components/settings/MediaServerFields.tsx` | Modified | Controlled port input, per-client credential label and help link |
| `services/web/messages/en.json`, `messages/es.json` | Modified | The credential help-link copy |

## Existing code to reuse

- `src/components/settings/PathPicker.tsx` — the precedent for a **controlled** input in this
  service: a raw `<input>` with `InputField`'s Tailwind classes copied in. The port input must switch
  to this shape, because `src/components/form/input/InputField.tsx`'s props accept `defaultValue` and
  **not** `value` (`services/web/CLAUDE.md`). Host and API key stay on `Input`/`defaultValue` — only
  the port becomes controlled.
- `src/components/settings/MediaServerFields.tsx` — its existing `useState(client || NONE)` already
  drives the show/hide of the connection block; the port now derives from the same state. Keep the
  `NONE` constant and the "fields are not rendered → not submitted → previous values preserved"
  behaviour documented in its comment; that is load-bearing and must survive.
- `src/components/form/Select.tsx` and `src/components/form/Label.tsx` — unchanged, already used here.
- `src/types/media-server.ts` — note its existing comment on why `state` is a loose `string`. The same
  reasoning applies to the new fields: keep them optional so an older `api` that omits them renders
  rather than crashes.

## Steps

1. **`types/media-server.ts`** — add `defaultPort?: number | null`,
   `credentialLabel?: string | null`, `credentialHelpUrl?: string | null` to `MediaServerOption`.
2. **`actions/media-server.ts`** — add the three fields to `MEDIA_SERVER_CLIENTS_QUERY`. Nothing else
   in this file changes; `getMediaServerOptions` is already called from the Settings page's render
   pass and already handles the redirect-on-error case.
3. **`MediaServerFields.tsx`**:
   - Hold the port in state, seeded from the `port` prop.
   - On combo change, set the selection **and** replace the port with the newly selected option's
     `defaultPort` when it is non-null; leave the port untouched when it is null (REQ-3). Nothing is
     persisted until the form's Save — this is a pre-save convenience, not a write.
   - Render the credential `<Label>` from the selected option's `credentialLabel`, falling back to
     the existing `t("apiKeyLabel")` when it is absent.
   - When `credentialHelpUrl` is present, render a link beside the credential field
     (`target="_blank"`, `rel="noopener noreferrer"`), labelled from a new message key.
   - The port input becomes a raw `<input>` per PathPicker; keep `name="media_server_port"` so the
     FormData contract is unchanged.
4. **`messages/{en,es}.json`** — one new key for the help-link text (e.g.
   `settings.mediaServer.credentialHelp`). `es` in the existing Rioplatense register.
   `credentialLabel` itself is **not** a message key — it arrives from `api` as a literal, like the
   existing `label`.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type MediaServerOption { id: ID!  label: String!  defaultPort: Int  credentialLabel: String  credentialHelpUrl: String }
```

- All three new fields are **nullable**, because `none` is a real row. Treat a null `defaultPort` as
  "leave the port alone" and a null `credentialLabel` as "use the existing generic label". Do not
  assume a client always has them.
- **Error conditions this consumer owns** — both already handled, and both must keep working:
  - `error.mediaServer.not_configured` — returned by `resyncMediaServerIndex` when there is no client
    or no host. Surfaced by the index panel's local `error` state via `toActionError`; unchanged.
  - `error.mediaServer.unknown` — returned by `updateSettings` for a client id in no registry entry.
    Surfaced by the existing settings-form error path; unchanged. Unreachable through the UI, since
    the combo only offers ids `api` sent.
- `web` does **not** consume `EncodeJobDetails.libraryLayout`. It is a worker-only field; do not add
  it to any query in this service.

If the contract looks wrong from inside `web`, stop and report (Article VIII).

## Tests

**None, and deliberately.** This service has no test suite (`services/web/CLAUDE.md`), and nothing in
this slice fails silently: a missing field is a visible wrong label or a wrong port in the input, and
both are covered by AC-1 and AC-2 in the manual pass. `scripts/check-messages.mjs` is the mechanical
check that the two catalogs did not drift.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

All three clean, with `check-messages` reporting no `en`/`es` drift at the new key count.
