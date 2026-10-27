---
title: OpenSubtitles Direct — web slice
service: web
last_updated: 2026-10-26
status: Approved
---

# PLAN: OpenSubtitles Direct — `web` (`web/plan.md`)

## Scope

`web` adds an OpenSubtitles block with two fields (username, password) to the existing Settings →
General tab, and changes the `/preferences` availability hint. It also adds catalog copy for the new
keys and rewords two existing ones that name Jellyfin. No new GraphQL read:
`mediaCapabilities.subtitleSearchAvailable` keeps its name and type, and the two settings travel
through the existing `settings`/`updateSettings`.

`web` never asks for, shows or sends an OpenSubtitles API key. Perceptor ships its own (spec
REQ-13), and OpenSubtitles bans an application that asks its users for one. There is no key field,
not even a hidden or optional one.

`web` does **not** show the remaining quota or add a "test connection" button (spec Out of Scope).
It does not change `106`'s dialog logic, because it already renders any error key through
`translateErrorKey`. It does not touch the subtitle search panel's status labels (`WAITING` keeps
`En espera`, REQ-12).

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/components/settings/GeneralPanel.tsx` | Modified | an OpenSubtitles block: two inputs + help text + sign-up link; two new props |
| `src/components/settings/SettingsForm.tsx` | Modified | passes the two values to `GeneralPanel` with `getSettingValue`; no new tab |
| `src/actions/settings.ts` | Modified | the two keys sent even when blank |
| `src/components/preferences/PreferencesForm.tsx` | Modified | hint key renamed |
| `messages/es.json`, `messages/en.json` | Modified | new tab, panel, hint, error copy |

## Existing code to reuse

- `src/components/settings/MediaManagerPanel.tsx`: the `movie_db_api_key` field is the pattern for
  a secret: `<Label>` + `<Input type="password" name=… defaultValue=…>`. The username is a plain
  `type="text"` input.
- `src/components/settings/GeneralPanel.tsx`: the panel the block goes in, below its existing
  fields; follow its own layout for a heading and spacing. `SettingsForm.tsx`'s `getSettingValue`
  feeds the props, as it already does for `ui_locale`/`date_month_first`.
- `src/actions/settings.ts`: `EDITABLE_KEYS` drops blank values, which would make AC-7 ("emptying
  `opensubtitles_username`") impossible from the UI. `LIST_KEYS` already sends a present string even
  when empty. Add the two keys to a group that behaves like `LIST_KEYS`, not to `EDITABLE_KEYS`.
  `api`'s `updateMany` accepts `""` for `secret`/`string` kinds (only `path`/`enum`/`int` reject it).
- `translateErrorKey` + the `errors.subtitleSearch.*` catalog: `SearchSubtitlesButton.tsx` and the
  preferences save already render any key, so the new keys need catalog entries only.

## Steps

1. **Action.** In `src/actions/settings.ts`, add `CLEARABLE_KEYS = ["opensubtitles_username",
   "opensubtitles_password"]`, sent whenever `formData.get(key)` is a string, trimmed, blank included.
2. **Block.** In `GeneralPanel.tsx`, an OpenSubtitles heading followed by:
   - fields `opensubtitles_username` (text, `autoComplete="off"`) and `opensubtitles_password`
     (password, `autoComplete="new-password"`, so the browser does not offer the admin's Perceptor
     login);
   - one paragraph saying the account is an opensubtitles.com one (an opensubtitles.org account
     does not work), that both fields are required, and that the account's daily download limit is
     what limits the search;
   - a link to opensubtitles.com's account sign-up page (confirm the exact URL when implementing;
     do not link the API consumers page, which is for registering an application key).
3. **Wiring.** `SettingsForm.tsx` passes `opensubtitles_username` and `opensubtitles_password` to
   `GeneralPanel`. `TABS` is unchanged.
4. **Preferences hint.**
   - Rename the message key `subtitleSearchRequiresJellyfin` → `subtitleSearchRequiresProvider`.
   - es: `Un administrador tiene que cargar una cuenta de OpenSubtitles en Ajustes → General.`
   - en: `An administrator has to enter an OpenSubtitles account in Settings → General.`
   - The disabled checkbox and the revert-on-error path stay exactly as they are.
5. **Catalog.** In both `messages/{es,en}.json`:
   - the block's strings under the General panel's existing namespace (heading `OpenSubtitles`, the
     two labels, the paragraph, the link text);
   - `errors.subtitleSearch`:

     | Key | es |
     | :-- | :-- |
     | `provider_not_configured` | `La búsqueda de subtítulos requiere una cuenta de OpenSubtitles en Ajustes → General.` |
     | `no_library_path` | `Perceptor no sabe dónde está el archivo de este título.` |
     | `provider_unauthorized` | `OpenSubtitles rechazó el usuario o la contraseña.` |
     | `provider_unavailable` | `No se pudo contactar a OpenSubtitles.` |
     | `quota_exhausted` | `Se agotaron las descargas diarias de OpenSubtitles.` |
     | `probe_failed` | `No se pudo leer el archivo para ver qué subtítulos tiene.` |
     | `probe_not_found` | `No se encontró la búsqueda de subtítulos.` (never shown in practice; present so the key never renders raw) |

   - `media_server_unavailable` es copy becomes
     `No se pudo contactar al servidor de medios para ubicar el archivo.`;
   - keep `unsupported_media_server` and `item_not_found` unchanged (retired keys, old rows);
   - `errors.subtitleEmbed.jellyfin_refresh_failed`: reword to name the media server, not Jellyfin,
     since a search's embed can now notify Plex (es: `Subtítulos incrustados, pero no se pudo avisar
     al servidor de medios. Aparecerán en su próximo escaneo.`). The key name stays.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta:

- `mediaCapabilities.subtitleSearchAvailable: Boolean!`: unchanged read. `false` disables the
  checkbox, shows the new hint, and hides `106`'s button (already the case).
- `setSubtitleSearch(true)` can now fail with `error.subtitleSearch.provider_not_configured`. Show
  it and revert the checkbox (the existing branch).
- `106`'s dialog can now receive:
  - `provider_not_configured`;
  - `no_library_path`;
  - `media_server_unavailable`.

  It shows each inline and stays open (the existing non-`in_progress` branch). The panel can now
  show the four new outcome keys as a language's or search's reason, through the catalog alone.
- `settings` returns `opensubtitles_password` in clear to an admin, as every `secret` setting today
  (spec 0.2.0). Render it in a password input, never as text. `settings` never contains the API key.

## Tests

`web` has no test runner (`package.json` has no `test` script). Nothing here can fail silently in a
way a unit test in this service would catch. A missing catalog key renders the raw key, visibly, and
a dropped blank value is caught by AC-7 in the manual pass. Verification is typecheck, lint and the
manual pass in `../plan.md`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit   # 0 errors
bin/npm web run lint
bin/comments web
```

Then, live:

- Settings → General saves the two values;
- emptying the username and saving makes `/preferences` show the disabled checkbox with the new hint
  (AC-7).
