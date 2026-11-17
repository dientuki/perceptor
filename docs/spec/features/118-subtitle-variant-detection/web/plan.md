---
title: Subtitle Variant Detection — web slice
service: web
last_updated: 2026-11-15
status: Implemented
---

# PLAN: Subtitle Variant Detection — `web` (`web/plan.md`)

## Scope

`web` widens when the existing `audioVariantDetection` checkbox in `/preferences` is enabled,
rewords its three strings, and adds the catalog entry for the new subtitle-search rejection key.

It does **not** add a field, action, query or component. `UserPreferences.audioVariantDetection`,
`setAudioVariantDetection` and `Language.hasRegionalVariants` are consumed exactly as `110` left
them. `SubtitleSearchStatus` already translates any `reasonKey` generically, so the new key needs
only its catalog entry. Every scoring and rejection decision belongs to `worker` and `api`.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/components/preferences/PreferencesForm.tsx` | Modified | `variantDetectionAvailable` also counts the subtitle tags |
| `messages/es.json`, `messages/en.json` | Modified | New values for the three `preferences.form.audioVariantDetection*` keys, plus `error.subtitleSearch.wrong_variant` |

## Existing code to reuse

- `src/components/preferences/PreferencesForm.tsx` — `variantDetectionAvailable` is already
  computed from `languages`, `audioTags` and `hasRegionalVariants`. `subtitleTags` sits beside it
  in the same component state, so the condition grows by one `||` over the same predicate. Keep
  the existing revert-on-error handling for `setAudioVariantDetectionAction` as it is.
- `src/components/media/SubtitleSearchStatus.tsx` — `reasonOf` resolves `error.subtitleSearch.*`
  keys from the catalog with a fallback, so there is no code change for REQ-18.
- `scripts/check-messages.mjs` — the parity check between `es` and `en`.

## Steps

1. In `PreferencesForm.tsx`, make `variantDetectionAvailable` true when any language with
   `hasRegionalVariants` is in `audioTags` **or** in `subtitleTags`. Because it reads the live
   state, the checkbox enables or disables as the user edits either language list, before saving.
2. Replace the `es` and `en` values of `preferences.form.audioVariantDetectionLabel`,
   `…Help` and `…DisabledHint` with the copy table in `../spec.md`, verbatim. Keep the key names.
3. Add `wrong_variant` under the same `error.subtitleSearch` group that holds `low_score`, with the
   spec's `es` and `en` strings.

## Contract obligations

`web` consumes, unchanged from `110`:

- `UserPreferences.audioVariantDetection: Boolean!`, `Language.hasRegionalVariants: Boolean!`.
- `setAudioVariantDetection(enabled: Boolean!): UserPreferences!`. On any error it reverts the
  checkbox and shows the translated key (unauthenticated is the only listed one). `true` with no
  variant language is accepted by `api`, so `web` must not block saving a checked, disabled
  checkbox's stored value either (REQ-2: stored, inert).
- `SubtitleSearchLanguage.reasonKey` may now be `error.subtitleSearch.wrong_variant`. It is shown
  through the existing per-language outcome line.

## Tests

Nothing in this slice fails silently in a way a unit test would catch. The enabling condition is
one boolean over state already on screen, checked live by AC-6/AC-7. The copy is checked by
`check-messages.mjs` for parity and by the manual pass for wording. `web` has no component test
harness for `PreferencesForm`, and adding one for an `||` is not owed under Article IX.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

All pass. In `/preferences`, audio `en` with subtitles `es-419` shows the checkbox enabled, and
removing `es-419` disables it with the new hint, in both locales.
