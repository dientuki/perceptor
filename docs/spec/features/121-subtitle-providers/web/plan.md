---
title: Subtitle Providers — web slice
service: web
last_updated: 2026-11-17
status: Approved
---

# PLAN: Subtitle Providers — `web` (`web/plan.md`)

## Scope

`web` builds Settings → "Subtítulos": the list of providers, the add/edit modal, removal with
confirmation, the default choice and the language editor. It also removes the OpenSubtitles fields
from Settings → General, stops sending `opensubtitles_*` through `updateSettings`, shows which
provider resolved a language in the subtitle-search status, and rewrites the copy that names
OpenSubtitles or "Ajustes → General" as the place to configure it.

It decides nothing about chains, validity or configuration: every rule lives in `api`, and `web`
renders `SubtitleProviderSettings` as returned. Writes are confined to `services/web/` and this
directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/subtitle-providers.ts` | New | Hand-typed `SubtitleProviderKind`, `SubtitleProvider`, `SubtitleProviderLanguage`, `SubtitleProviderSettings` |
| `src/actions/subtitle-providers.ts` | New | `getSubtitleProviders()` (read, `redirectToClearSession`); `saveSubtitleProviderAction`, `removeSubtitleProviderAction`, `setSubtitleProviderLanguagesAction` returning `{ settings } \| { error, errorKey? }` |
| `src/components/subtitle-providers/SubtitleProvidersPanel.tsx` | New | Owns the `SubtitleProviderSettings` state; lists providers, default select, languages editor, add button |
| `src/components/subtitle-providers/SubtitleProviderRow.tsx` | New | One configured provider: name, secret-set marker, username (OpenSubtitles), Edit, Remove |
| `src/components/subtitle-providers/SubtitleProviderModal.tsx` | New | Add/edit form per kind (OpenSubtitles: username + password; Subdivx: API key), blank secret on edit = keep |
| `src/components/subtitle-providers/RemoveSubtitleProviderModal.tsx` | New | Confirmation naming that its languages are dropped too |
| `src/components/subtitle-providers/SubtitleLanguagesEditor.tsx` | New | Default select (only with two configured) + rows of language tag → provider + Save |
| `src/components/settings/SettingsForm.tsx` | Modified | New `subtitles` tab; panel rendered as a sibling of the `<form>`, which is hidden on this tab like on `environment` |
| `src/components/settings/GeneralPanel.tsx` | Modified | OpenSubtitles block and props removed |
| `src/app/(dashboard)/settings/page.tsx` | Modified | `getSubtitleProviders()` and `getLanguages()` joined into the existing `Promise.all` (after the admin check) |
| `src/actions/settings.ts` | Modified | `CLEARABLE_KEYS` and its loop deleted |
| `src/actions/movies.ts`, `src/actions/shows.ts` | Modified | Select `provider` on every `languages { … }` of `latestSubtitleSearch` |
| `src/types/media.ts` | Modified | `SubtitleSearchLanguage.provider: SubtitleProviderKind \| null` |
| `src/components/media/SubtitleSearchStatus.tsx` | Modified | Shows the provider name beside a `RESOLVED`/`REPLACED` language |
| `messages/en.json`, `messages/es.json` | Modified | `settings.tabs.subtitles`, `subtitleProviders.*`, `errors.subtitleProvider.*`, the two new `errors.subtitleSearch.*` keys; OpenSubtitles keys moved out of `settings.general`; provider-neutral rewording |

## Existing code to reuse

- `src/components/indexers/` (`112`) — the reference for a Settings section that saves through its
  own mutations: result-union actions, inline errors inside the modal, the modal kept open on
  refusal, and `RemoveIndexerModal` for the confirmation. Copy its shape, not its client-side
  fetching: `subtitleProviders` calls nothing external, so it joins the page's `Promise.all`
  after the sequential `getCurrentUser()` admin check, like `getSettings()`.
- `src/components/settings/SettingsForm.tsx`'s `environment` handling (`055`) — a tab whose panel
  is a **sibling** of `StatefulForm` and hides the form. The subtitles panel must not live inside
  the `<form>`: its inputs would be submitted by the shared *Guardar*, and its own buttons would
  submit the form.
- `src/components/ui/modal` + `useModal`, `src/components/ui/button/Button.tsx` (defaults to
  `type="button"`), `src/components/form/Select.tsx`, the raw-`<input>` convention for controlled
  inputs, and `Badge` for the "configured"/"default" markers.
- `src/lib/graphql-error.ts` — `toActionError` for every action (passes `errorKey` through) and
  `translateErrorKey` for the new `reasonKey`s. Add no string matching.
- `src/actions/languages.ts` `getLanguages()` plus `Intl.DisplayNames` for language names (the
  `LanguagePickerField` rule). Never add a language-name list to the catalogs. The language entry row's
  language select offers only the tags in the target provider's `languageTags` (`null` = every
  tag).
- `components/media/SubtitleSearchStatus.tsx` — already renders each language. Add the provider
  label there; do not create a second status component.

## Steps

1. **Types and actions.** Add `types/subtitle-providers.ts` and `actions/subtitle-providers.ts`,
   using the standard server-action shape (`'use server'`, `SCREAMING_SNAKE` documents,
   `fetchGraphQL<T>`).
   - The three mutations return `{ settings: SubtitleProviderSettings } | { error: string;
     errorKey?: string }` and use `redirectIfUnauthenticated`.
   - The read uses `redirectToClearSession`.
2. **Panel.** `SubtitleProvidersPanel` keeps the returned settings in state and replaces it after
   every successful mutation, then calls `router.refresh()` so the layout re-reads
   `mediaCapabilities.subtitleSearchAvailable`.
   - It lists the providers where `configured`.
   - "Agregar proveedor" shows only while some kind has `configured: false`, and offers only
     those kinds.
   - With no provider configured, it shows an empty state explaining that subtitle search stays
     unavailable until one is added.
3. **Modal.** `SubtitleProviderModal` has two modes, add and edit, and shows fields per kind.
   - OpenSubtitles: username plus password. The `openSubtitlesHelp` and sign-up link move here
     from General.
   - Subdivx: the API key, plus a help line linking to SubX's quickstart
     (`https://subx-api.duckdns.org/docs/getting-started/quickstart/`).
   - On edit, the secret field is empty with a "dejá en blanco para mantener" hint (reuse the
     existing `passwordHint` wording style) and is sent as `null` when left blank.
   - Errors render inline and the modal stays open.
4. **Remove.** `RemoveSubtitleProviderModal` → `removeSubtitleProviderAction`. The copy says its
   languages are removed too.
5. **Languages editor.**
   - The default select is rendered only when two providers are configured. With one, show
     "Predeterminado" on it, read-only.
   - Rows are tag → provider. A provider is selectable only when configured and not default.
     The tag select is filtered by that provider's `languageTags`.
   - Add and remove rows locally, and send everything through one
     `setSubtitleProviderLanguagesAction` on "Guardar idiomas".
   - A refusal shows inline and keeps the local edits.
6. **Settings wiring.** Add the `subtitles` tab (`Subtitles`/`Subtítulos`, a lucide `Captions`
   icon) and render the panel as a sibling of the form. Remove the OpenSubtitles block from
   `GeneralPanel` and its two props from `SettingsForm`. Delete `CLEARABLE_KEYS` from
   `actions/settings.ts`, which is required: `api` now refuses those keys.
7. **Status.** Select `provider` in the three `latestSubtitleSearch` queries (two in `movies.ts`,
   two plus the episode list in `shows.ts`: every `languages { languageIso3 … }` selection). Render
   the provider name next to `RESOLVED`/`REPLACED` using a small `subtitleProviders.name.<KIND>`
   catalog entry (`OpenSubtitles`, `Subdivx`, identical in both locales).
8. **Copy.**
   - Add `errors.subtitleProvider.*` (six keys, Spanish copy from the spec's table),
     `errors.subtitleSearch.no_provider` and `errors.subtitleSearch.archive_unusable`.
   - Reword `provider_unauthorized`, `provider_unavailable` and `quota_exhausted` without naming
     OpenSubtitles.
   - Point `provider_not_configured` and `preferences…subtitleSearchRequiresProvider` at
     "Ajustes → Subtítulos".
   - Keep `en`/`es` in parity (`check-messages.mjs`).

## Contract obligations

`web` consumes, exactly as in `../spec.md`:

- `Query.subtitleProviders`: `providers { kind configured isDefault username secretSet
  languageTags }`, `languages { languageTag provider }`.
- `saveSubtitleProvider(input: { kind, username?, secret? })`, `removeSubtitleProvider(kind)` and
  `setSubtitleProviderLanguages(defaultProvider, languages)`. All three return the same
  `SubtitleProviderSettings` selection.
- `SubtitleSearchLanguage.provider` (nullable).
- `MediaCapabilities.subtitleSearchAvailable`, unchanged in shape.

Every error and what `web` does with it:

| Key | Where it can arrive | What `web` does |
| :-- | :-- | :-- |
| `error.subtitleProvider.incomplete` | save | Inline in the modal, modal stays open |
| `error.subtitleProvider.field_not_allowed` | save | Inline in the modal (should not happen: the form never sends a username for Subdivx) |
| `error.subtitleProvider.app_key_missing` | save (OpenSubtitles) | Inline in the modal |
| `error.subtitleProvider.not_configured` | remove, language configuration | Inline. Remove refreshes the panel by calling `getSubtitleProviders()` again, since another admin may have removed it |
| `error.subtitleProvider.language_unsupported` | language configuration | Inline under the languages editor, local edits kept |
| `error.subtitleProvider.language_invalid` | language configuration | Same |
| `error.subtitleProvider.language_duplicate` | language configuration | Same |
| `error.language.unavailable` | language configuration | Same (existing catalog entry) |
| auth/admin keys | any | Existing handling (`redirectIfUnauthenticated`/`notFound`) |
| `error.subtitleSearch.no_provider`, `archive_unusable` | `reasonKey` in the status | Rendered through `translateErrorKey` like every other outcome key |

The delta is read-only. If it is wrong, stop and report.

## Tests

None, by this service's standing rule (`services/web/CLAUDE.md` § Tests: no runner, and none is
added as a side effect). The gates are the typecheck, Biome on the touched files,
`check-messages.mjs` and the manual pass in `../plan.md` § Verification (AC-1, AC-2, AC-8, AC-12
are the `web`-visible ones).

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/cli web npx --no biome check src/components/subtitle-providers src/actions/subtitle-providers.ts src/components/settings/SettingsForm.tsx src/components/settings/GeneralPanel.tsx src/components/media/SubtitleSearchStatus.tsx
bin/comments web
```

The typecheck reports 0 errors, the catalogs are in parity, Biome is clean on the touched files
and `bin/comments` passes. Then open Settings → Subtítulos and walk AC-1, AC-2, AC-8 and AC-12.
