---
title: Audio Variant Detection — web slice
service: web
last_updated: 2026-10-29
status: Approved
---

# PLAN: Audio Variant Detection — `web` (`web/plan.md`)

## Scope

`web` adds one checkbox to `/preferences` → the download-languages panel, under the audio
`LanguagePickerField`. The checkbox is always rendered, enabled only while the **currently picked**
audio languages include one whose `Language.hasRegionalVariants` is true. It saves with the rest of
the form through a new `setAudioVariantDetectionAction`. `web` also adds the three copy keys to both
catalogs.

`web` does **not** decide which languages have variants. It reads `hasRegionalVariants` and never
checks for `es` or `spa` itself (REQ-3). It never shows a verdict anywhere (Out of Scope). Writes
are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/languages.ts` | Modified | `Language.hasRegionalVariants: boolean` |
| `src/types/preferences.ts` | Modified | `UserPreferences.audioVariantDetection: boolean` |
| `src/actions/languages.ts` | Modified | `LANGUAGES_QUERY` selects `hasRegionalVariants` |
| `src/actions/preferences.ts` | Modified | Every `UserPreferences` selection adds `audioVariantDetection`; the fallback object gets `audioVariantDetection: false`; new `SET_AUDIO_VARIANT_DETECTION_MUTATION` and `setAudioVariantDetectionAction` |
| `src/components/preferences/PreferencesForm.tsx` | Modified | State, enablement, `Checkbox`, hint, inclusion in the save batch and its error revert |
| `messages/es.json`, `messages/en.json` | Modified | `preferences.form.audioVariantDetection{Label,Help,DisabledHint}` |

Other files that select `languages { … }` (`src/actions/movies.ts`, `src/actions/shows.ts`) and
feed the per-title language modals may leave the new field unselected. Nothing there reads it. Add
it only if `tsc` demands it through the shared `Language` type; in that case make the type field
optional **only** there, never in the preferences path.

## Existing code to reuse

- `PreferencesForm.tsx`'s `subtitleSearch` control, line for line, as the template: the `useState`
  seeded from `preferences`, `Checkbox` with `disabled`, the gray hint paragraph, its slot in the
  save batch and its revert-on-error (`setSubtitleSearch(preferences.subtitleSearch)`).
- `setSubtitleSearchAction` in `src/actions/preferences.ts` — copy its try/catch,
  `redirectIfUnauthenticated` and `translateGraphQLError` exactly.
- `audioTags` (already form state) and `languages` (the catalog prop the pickers already receive).
  Enablement is
  `languages.some((l) => audioTags.includes(l.tag) && l.hasRegionalVariants)`, so it reacts to
  picks the user has **not saved yet**. That is what AC-8 exercises.
- `scripts/check-messages.mjs` — keeps `es`/`en` in lockstep.

## Steps

1. Types: `hasRegionalVariants` on `Language`, `audioVariantDetection` on `UserPreferences`.
2. Actions: select both fields, add the fallback value, and add the mutation and
   `setAudioVariantDetectionAction(enabled)`.
3. Form:
   - Add `const [audioVariantDetection, set…] = useState(preferences.audioVariantDetection)`.
   - Add `const variantDetectionAvailable = …` using the expression above.
   - Under the `audio-mandatory` checkbox, render `<Checkbox id="audio-variant-detection"
     checked={audioVariantDetection} disabled={!variantDetectionAvailable} …/>` with the help text
     below it. While disabled, also show the disabled hint. The checkbox shows the **stored** state
     while disabled (REQ-2). It is not forced to unchecked the way `subtitleSearch` is.
   - Include `setAudioVariantDetectionAction(audioVariantDetection)` in the save batch
     unconditionally. On error, push the message and revert to `preferences.audioVariantDetection`.
4. Catalogs: copy the `es`/`en` strings verbatim from `../spec.md`.
5. Run `tsc`, `check-messages` and `bin/comments web`.

## Contract obligations

`web` consumes the following from `../spec.md`:

- `languages { hasRegionalVariants }` and `preferences { audioVariantDetection }`.
- `setAudioVariantDetection(enabled: Boolean!): UserPreferences!`.

Errors from `setAudioVariantDetection`:

- **Unauthenticated:** `redirectIfUnauthenticated`, as today.
- **Any other error:** show the translated message and revert the checkbox.

There is no "no variant language" error to handle: `api` accepts that call by contract.

## Tests

`web` has no unit test runner (`package.json` has no `test` script). The silent failure in this
slice would be enablement reading the wrong source, for example `preferences.audioLanguages`
(saved) instead of `audioTags` (live). The live AC-8 pass in `../plan.md` § Verification covers it:
add `es-419` without saving and watch the checkbox enable. A forgotten `hasRegionalVariants` in
`LANGUAGES_QUERY` would leave the checkbox disabled for everyone. `tsc` cannot catch that, since the
field would read `undefined`, so the same live step covers it too.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

All three are clean, and AC-8 passes live on the dev stack.
