---
title: Reconcile a newly registered title against the media server — web slice
service: web
last_updated: 2026-08-31
status: Implemented
---

# PLAN: Reconcile a newly registered title against the media server — `web` (`web/plan.md`)

## Scope

This slice adds one read and one action to the Media Server tab of Settings: the index's state,
timestamp and entry count (REQ-6), and a **Re-sync** button that triggers a rebuild (REQ-3).

It does **not** touch anything about how a title's status is displayed. That is the whole point of
the feature and it needs no work here: `Movie.status`, `Show.status` and `Episode.status` are
unchanged in type and meaning, every listing, detail page and billboard card already renders every
`MediaStatus` value, and nothing in this service reads `filePath` (`grep -rn filePath src` is empty).
A title that comes back `COMPLETED` instead of `MISSING` renders correctly today.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media-server.ts` | Modified | `MediaServerIndexStatus` type beside the existing `MediaServerOption` |
| `src/actions/media-server.ts` | Modified | `getMediaServerIndexStatus()` (read) + `resyncMediaServerIndexAction()` (action) |
| `src/components/settings/MediaServerFields.tsx` | Modified | the status line + the Re-sync button |
| `src/app/(dashboard)/settings/page.tsx` | Modified | fetches the status alongside the other four |
| `src/components/settings/SettingsForm.tsx` | Modified | passes `indexStatus` through to `MediaServerFields` |
| `messages/en.json`, `messages/es.json` | Modified | the panel's new copy + `errors.mediaServer.not_configured` |

## Existing code to reuse

- `src/components/downloads/DownloadsPanel.tsx` — the exact shape for the button:
  `const [isPending, startTransition] = useTransition()`, a `Button` with `onClick`, the action's
  `{ error }` read into a local `useState` and rendered inline, then `router.refresh()` on success.
  Copy this, do not invent a variant.
- `src/actions/downloads.ts` + `toActionError` (`src/lib/graphql-error.ts`) — the action-file shape
  for a mutation that returns `{ error }` instead of throwing.
- `src/actions/media-server.ts` — the read-function shape (`throw` on error), and the file this slice
  extends rather than adding a new one beside.
- `src/components/ui/button/Button.tsx` — already defaults to `type="button"`. Use it (see the trap
  below); do not drop in a raw `<button>`.
- `src/app/(dashboard)/settings/page.tsx` — the existing `Promise.all` of four fetches; add a fifth.

## Steps

1. **Type.** Add to `src/types/media-server.ts`:
   `export type MediaServerIndexStatus = { state: string; itemCount: number; syncedAt: string | null }`.
   `state` is a `string`, mirroring the contract — do not narrow it to a union of the four literals
   here; there is no codegen, and a fifth state added later would then fail to compile against a value
   the api legitimately sends.
2. **Read.** `getMediaServerIndexStatus()` in `src/actions/media-server.ts`, following
   `getMediaServerOptions()` immediately above it.
3. **Action.** `resyncMediaServerIndexAction()` in the same file. Not a `useActionState` form action —
   it takes no arguments and returns `{ error: string; errorKey?: string } | { status: MediaServerIndexStatus }`.
   Route errors through `toActionError` and call `redirectIfUnauthenticated(errors)` first, exactly as
   `src/actions/downloads.ts` does.
4. **Page + form.** Fetch the status in `settings/page.tsx`'s existing `Promise.all` and thread it
   through `SettingsForm` into `MediaServerFields` as `indexStatus`.
5. **Panel.** In `MediaServerFields.tsx`, below the three connection fields and inside the same
   `selected !== NONE` block (there is nothing to sync for `none`), render the status line and the
   button. Show `state`, the entry count and `syncedAt`; disable the button while `state === "syncing"`
   or `isPending`. Render `state === "failed"` as a warning — and note the timestamp shown there is the
   last **successful** rebuild's, which is what the api sends; do not relabel it as "failed at".
   Errors render inline, never `alert()`.

**The one trap in this slice.** The Media Server panel sits *inside* `SettingsForm`'s main
`<form action={formAction}>`. Do **not** wrap the button in its own `<form>` — a nested form is
invalid HTML, which is exactly why `DownloadPanel`'s `LanguagePicker` was moved outside the main form
(see the comment in `SettingsForm.tsx:44-54`). And do not use a raw `<button>`: it defaults to
`type="submit"`, so pressing Re-sync would silently save every setting on every tab. Use `Button` with
`useTransition`, which is neither.

## Contract obligations

Consumed exactly as `../spec.md` § GraphQL Contract Delta freezes it:

```graphql
query    { mediaServerIndexStatus { state itemCount syncedAt } }
mutation { resyncMediaServerIndex { state itemCount syncedAt } }
```

`state` is `String!` (`never` | `syncing` | `ready` | `failed`), `itemCount` is `Int!`, `syncedAt` is
a nullable `DateTime`. **There is no codegen** — a renamed field compiles fine here and fails at
runtime.

Every error condition and what this service does with it:

| Error key | When | What `web` does |
| :-- | :-- | :-- |
| `error.mediaServer.not_configured` | Re-sync pressed with `media_server_client` at `none`, or the chosen client has no host | Render the translated message inline beside the button. Do **not** retry and do **not** touch the form. Needs `errors.mediaServer.not_configured` in **both** catalogs — without it `translateGraphQLError` falls back to api's English string and `es` silently shows English. |
| `error.auth.admin_required` | A non-administrator calls either operation | Same handling every other Settings operation has; the tab is not reachable by a non-admin anyway. |
| `error.mediaServer.unknown` | `media_server_client` names a client not in the registry | Falls through to the generic inline error. No catalog entry is added — it has none today and this feature does not change that. |
| network failure | api unreachable | `t("network.connectionFailed")`, as `updateSettingsAction` does. |

`mediaServerIndexStatus` is a read function and `throw`s, per the read-function convention — the page
is admin-only and already behind the same guard as `settings`.

## Tests

**None, and deliberately.** This service has no test file, no runner and no `test` script
(`services/web/CLAUDE.md` § "Tests: there are none"), and adding a toolchain here is its own decision
deserving its own spec — not a side effect of this feature. The quality gate is `next build`, Biome on
the touched files, `scripts/check-messages.mjs` for catalog parity, and opening the page.

Nothing in this slice can fail silently in the Article IX sense: a wrong field name blanks the status
line on screen, a missing translation key shows English text on a Spanish page, and a broken button
does nothing visible. All three are apparent on the first look at the tab. The one failure that would
have been silent — the button submitting the whole settings form — is designed out in step 5 rather
than tested for.

## Done when

```bash
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/npm web run lint
```

`next build` exits 0 under `NODE_ENV=production` (the `build` script sets it — do not run `next build`
bare), `check-messages.mjs` exits 0 with both catalogs carrying every new key, Biome clean on the
touched files. Then open `/settings` → Media Server and confirm the status line renders, Re-sync
disables while running, and `none` + Re-sync shows the translated error in both locales.
