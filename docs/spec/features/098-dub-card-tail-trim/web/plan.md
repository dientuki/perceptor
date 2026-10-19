---
title: Dub-Card Tail Trim — web slice
service: web
last_updated: 2026-10-19
status: Implemented
---

# PLAN: Dub-Card Tail Trim — `web` (`web/plan.md`)

## Scope

`web` renders and saves one switch on Settings → Compression. It adds no page, no query, no server
action and no GraphQL field; it never selects `EncodeJobDetails.dubTrimEnabled`. Detection and the
cut are the worker's; the Setting's storage and validation are `api`'s.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/settings/CompressionPanel.tsx` | Modified | new `dubTrimEnabled` prop, `Switch` + hidden `dub_trim_enabled` input, placed right after the grain switch |
| `services/web/src/components/settings/SettingsForm.tsx` | Modified | passes `getSettingValue("dub_trim_enabled") === "true"` |
| `services/web/src/actions/settings.ts` | Modified | `"dub_trim_enabled"` in `BOOLEAN_KEYS` |
| `services/web/messages/en.json` | Modified | `settings.compression.dubTrimLabel`: `"Trim dubbing credit cards at the end"` |
| `services/web/messages/es.json` | Modified | same key: `"Recortar placas de doblaje al final"` |

## Existing code to reuse

- The grain switch in `CompressionPanel.tsx` (`grainAutoEnabled` prop, `useState`, `Switch` with
  `disabled={!enabled}`, hidden input carrying `"true"`/`"false"`) — copy it one-for-one. The hidden
  input is never disabled, so a save with compression off posts the stored value unchanged: that is
  REQ-4's "disabled, state preserved, never cleared" for free.
- `BOOLEAN_KEYS` in `src/actions/settings.ts` — reads the hidden input's value explicitly; adding the
  key is the whole save path, including error rendering of any `updateSettings` refusal.
- `getSettingValue` in `SettingsForm.tsx` with the `=== "true"` idiom (REQ-2: absent → off).
- The `grainAutoLabel` key's location in both catalogs, for the new label's placement.

## Steps

1. Add the label to `messages/en.json` and `messages/es.json` beside `grainAutoLabel`.
2. Add the `dubTrimEnabled` prop, state, `Switch` and hidden input to `CompressionPanel.tsx`.
3. Pass the prop from `SettingsForm.tsx`.
4. Add `"dub_trim_enabled"` to `BOOLEAN_KEYS`.
5. Run the checks.

## Contract obligations

Consumes nothing new from GraphQL. Writes `dub_trim_enabled` through the existing `updateSettings`.
Possible refusals and what `web` does with them:

- `error.setting.expected_boolean` — cannot happen from this form (the hidden input only carries
  `"true"`/`"false"`); if it does, the tab's existing error rendering shows it.
- `error.setting.not_editable` — only when deployed against an `api` without the catalog entry. It
  fails the whole tab's save, which is why `api` ships first (`../plan.md` § Order of Work).

The delta is read-only — if it is wrong, stop and report.

## Tests

None owed. The switch is a copy of an existing one with no logic of its own; a wrong wiring is
visible immediately (the switch does not persist) rather than silent, and AC-8/AC-9 cover it in the
manual pass. `check-messages.mjs` covers catalog parity.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

all pass, and on the live stack the switch renders off on a fresh/upgraded install, persists across
a save, and is disabled at its stored value while compression is off.
