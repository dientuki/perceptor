---
title: Subtitle Translation and Adaptation — web slice
service: web
last_updated: 2026-10-29
status: Approved
---

# PLAN: Subtitle Translation and Adaptation — `web` (`web/plan.md`)

Read first: `../spec.md` (frozen contract), `../plan.md`, `services/web/CLAUDE.md`,
`.claude/agents/web.md`.

## Scope

Two surfaces and one behaviour:

1. **Settings → "Traducción"** (administrators only): list providers, create/edit/delete them,
   add/edit/delete models, press "Probar". Its own server actions; it is not part of the Settings
   form's Save button.
2. **A "Traducir subtítulos" button and modal** on the film's detail page and on each episode of the
   season accordion: pick source, target, model; show "Traducir"/"Adaptar"; confirm; show the
   in-flight translation, its progress, its result, its warning.
3. **A poll** (REQ-16): while the translation on screen is not terminal, re-read just that
   translation every few seconds.

It does **not** decide availability, derive the mode, validate languages or models, name files, or
know anything about providers beyond their display fields. `web` never sees a key or a base URL on
the user-facing side, and never shows a key on the admin side (only `hasApiKey`).

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media.ts` | Modified | `MediaCapabilities.subtitleTranslationAvailable`; `TranslationModel`; `SubtitleTranslationSource`; `SubtitleTranslation` (+ status/mode string unions); `Movie.latestSubtitleTranslation`, `Episode.latestSubtitleTranslation`. |
| `src/types/translation.ts` | New | `LlmProvider`, `LlmModel`, `LlmProviderKind`, `LlmModelTestResult`, input types (admin side only). |
| `src/actions/translation.ts` | New | Server actions: `getLlmProviders`, `createLlmProviderAction`, `updateLlmProviderAction`, `deleteLlmProviderAction`, `createLlmModelAction`, `updateLlmModelAction`, `deleteLlmModelAction`, `testLlmModelAction`, `getTranslationModels`, `getTranslationSourcesAction` (movie/episode), `requestSubtitleTranslationAction`, `getSubtitleTranslationAction` (the poll). |
| `src/actions/movies.ts`, `src/actions/shows.ts` | Modified | Add `latestSubtitleTranslation { … }` to the film and series queries (next to `latestSubtitleSearch`). |
| `src/actions/media.ts` (or wherever `mediaCapabilities` is read) | Modified | Add `subtitleTranslationAvailable` to the capabilities selection. |
| `src/components/settings/TranslationPanel.tsx` | New | Provider list + forms + model rows + "Probar". Client component. |
| `src/components/settings/LlmProviderForm.tsx`, `LlmModelRow.tsx` | New | Kind-driven fields (REQ-1 table), key write-only field with "key is set" indicator and an explicit clear. |
| `src/components/settings/SettingsForm.tsx` | Modified | New tab `translation` (icon `Languages` from `lucide-react`) and panel; the panel gets `providers` as a prop. |
| `src/app/(dashboard)/settings/page.tsx` | Modified | Fetch `getLlmProviders()` inside the existing `Promise.all` (the page is already admin-gated) and pass it down. |
| `src/components/media/TranslateSubtitlesButton.tsx` | New | Button + state (idle / in flight with progress / failed / completed with warning), opens the modal, runs the poll. |
| `src/components/media/TranslateSubtitlesModal.tsx` | New | Source list, target select, model select, mode label, confirm, error line. |
| `src/hooks/useTranslationPoll.ts` | New | The poll (below). |
| `src/components/movies/Movie.tsx` | Modified | Render the button beside `SearchSubtitlesButton`, gated like it. |
| `src/components/shows/SeasonAccordion.tsx` | Modified | Render the button in the "Pistas" cell of each episode, next to `SearchSubtitlesButton`. |
| `messages/en.json`, `messages/es.json` | Modified | `settings.tabs.translation`, `settings.translation.*`, `media.translateSubtitles.*`, and `errors.llm.*` / `errors.subtitleTranslation.*` for **every** key in the spec's tables (thrown and outcome). `es` stays Rioplatense. |

## Existing code to reuse

- `components/media/EmbedSubtitlesButton.tsx` + `EmbedSubtitlesModal.tsx` — the structure of a
  button that shows in-flight/failed/warning states and opens a modal (`useModal`, `translateErrorKey`
  with the `errors` namespace, `router.refresh()` after a terminal state). Follow it; do not invent a
  second modal idiom.
- `components/media/SearchSubtitlesButton.tsx` and the `subtitleSearchAvailable` prop threading
  through `app/(dashboard)/movies/[id]/page.tsx` → `Movie.tsx` and `shows/[id]/page.tsx` →
  `SeasonAccordion.tsx` — thread `subtitleTranslationAvailable` the same way.
- `components/settings/SchedulingPanel.tsx` — a Settings panel with data passed as a prop and its own
  actions, outside `SettingsForm`'s Save.
- `actions/movies.ts`' `searchMovieSubtitlesAction` — the exact action shape: `fetchGraphQL`, the
  `network.connectionFailed` fallback, `redirectIfUnauthenticated`, `toActionError`.
- `lib/graphql-error.ts` `translateErrorKey` and the `errors.*` catalog layout (`errors.subtitleEmbed.*`).
- `components/ui/modal`, `components/ui/button/Button`, `components/ui/badge`, `components/ui/tabs/TabNav`.
- `hooks/useModal.ts`.

## Steps

1. **Types and queries.** Retype by hand from the spec delta (there is no codegen). Add
   `latestSubtitleTranslation { id status mode sourceLanguageIso3 sourceTitle targetTag
   modelDisplayName cuesDone cuesTotal errorKey warningKey outputFileName createdAt finishedAt }` to the
   film query and to the episode selection of the series query; add the capability flag.
2. **Actions** in `actions/translation.ts`. The admin actions return `{ error } | { ok }` shaped like
   the existing settings actions; none may place `apiKey` in a result. The sources action maps `null`
   (never read) distinctly from `[]`. `getSubtitleTranslationAction(id)` calls `subtitleTranslation(id)`
   and returns the row or `null`.
3. **Settings tab.**
   - `TranslationPanel` lists providers (`name`, kind label, enabled switch, "key set" badge) with their
     models; "Add provider" opens `LlmProviderForm`.
   - `LlmProviderForm` renders only the fields REQ-1 allows for the chosen kind: `GEMINI`/`OPENROUTER`/
     `OPENAI` → name + key; `OPENAI_COMPATIBLE` → name + base URL + optional key; `OLLAMA` → name +
     base URL, no key field. Editing shows an empty key input with a "Key is set" indicator and a
     separate "Remove key" action (sends `""`); an untouched input sends `undefined`. Changing the kind
     on an existing provider is not offered.
   - Model rows: model string (free text), optional label, enabled switch, "Probar" (calls
     `testLlmModelAction`, shows success + elapsed ms or the translated `errorKey` inline), delete.
   - Every `error.llm.*` key goes to the form's error line and **keeps the user's input** (spec).
   - Only reachable by administrators (the page already 404s others).
4. **Button and modal.**
   - Visibility: `subtitleTranslationAvailable && status === "COMPLETED"` — the same gate as
     `SearchSubtitlesButton`. (`web` cannot see `filePath`/`mediaServerPresentAt`; this matches `106`.
     A title that reads another status because a replacement is in flight simply hides the button.)
   - On open, fetch `getTranslationSourcesAction` (movie or episode) and `getTranslationModels`.
     Sources `null` → the line `Todavía no se leyó el archivo; probá en un momento.` and confirm disabled.
     Sources `[]` → "no translatable subtitles". A source with `languageIso3 === null` is listed
     greyed and not selectable.
   - Target select lists the user's available languages from the existing languages source used by
     `TitleLanguagesForm` (all `Language` rows, by `tag`, labelled by `name`).
   - **Mode label** is computed for display only: the selected source's `languageIso3` against the
     target's `iso3` (the language list already carries `iso3`). It says "Traducir" or "Adaptar" and
     is never sent — `api` derives it again.
   - Confirm → `requestSubtitleTranslationAction`. Handle per the spec: `busy` / `model_unavailable` →
     show the message and `router.refresh()` (the button then shows the in-flight translation, or the
     refreshed model list); `source_not_found` → message + reload the source list; `no_library_path` /
     `media_server_unavailable` → message and confirm disabled; any other thrown key → the modal's error line.
   - In flight (`QUEUED` / `EXTRACTING` / `TRANSLATING` / `WRITING`): the button is disabled and shows the
     status and, while `TRANSLATING` with `cuesTotal`, `cuesDone / cuesTotal`. `FAILED`: the translated
     `errorKey`. `COMPLETED`: the output file name, plus the `warningKey` text when present.
5. **Poll** (`hooks/useTranslationPoll.ts`): input is the `id` and status of the latest translation
   rendered by the server component. If status is non-terminal, `setInterval` (one exported constant,
   `TRANSLATION_POLL_MS`, ~4000) calls `getSubtitleTranslationAction(id)` and replaces local state; on the
   first terminal status it clears the interval and calls `router.refresh()` once (so the film's
   subtitle box and the sources reflect the new sidecar). The interval is cleared on unmount, when the
   id changes, and never created when the status is already terminal or absent. A poll error leaves the
   state as is and keeps polling. No WebSocket, SSE or subscription.
6. **Catalog.** Add every key to both `en.json` and `es.json`: tab label, panel and form strings, kind
   labels (`Google Gemini`, `OpenRouter`, `OpenAI`, `OpenAI-compatible (LM Studio, vLLM, llama.cpp…)`,
   `Ollama`), status labels, mode labels, the "not read yet" line, and the spec's message for every
   thrown and outcome key under `errors.llm.*` and `errors.subtitleTranslation.*` (`es` uses the
   spec's Spanish text verbatim).
7. `bin/comments web`, biome, typecheck.

## Contract obligations

Consumes exactly `../spec.md` § GraphQL Contract Delta. Every error condition in the spec table has a
planned handling above: thrown keys are shown on the form/modal error line (with the three special
cases listed in step 4); outcome keys (`provider_*`, `invalid_response`, `source_*`, `file_gone`,
`write_failed`, `interrupted`, `notify_failed`) are only ever read from a stored translation's
`errorKey`/`warningKey` and translated through `translateErrorKey`; an unknown key falls back to the
generic message. `latestSubtitleTranslation` may be `null` (never requested).

If the delta looks wrong, stop and report — do not adapt it locally.

## Tests

`web` has no test runner configured in this repository (no `test` script in `package.json`), and
nothing in this slice produces a silent wrong *result* — a bug here is visible on screen. The one
silent failure worth naming is the poll never stopping (a leaked interval hammering `api`
forever); it is covered by the manual pass (leave the page, confirm in the browser's network tab
that polling ends on navigation and on a terminal status) and by keeping the hook to a single
effect with an explicit cleanup. If the plan or the user later adds a unit test runner to `web`,
`useTranslationPoll` is the first unit owed one. State this in the final report.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments web
```

All three exit 0, and both catalogs have identical key sets (`en.json` ↔ `es.json`). Then the
manual pass in `../plan.md` § Verification items 1–4 renders as described.
