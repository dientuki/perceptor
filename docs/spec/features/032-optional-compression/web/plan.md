---
title: Optional compression — web slice
service: web
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Optional compression — `web` (`web/plan.md`)

## Scope

`web` turns the Compression tab from markup into a real, persisted control: the enable checkbox
becomes the new `Switch`, its state is saved as the `compression_enabled` setting through the
Settings screen's existing single form and Save button, and while it is off every other control on
that tab is genuinely non-modifiable — disabled, not merely dimmed.

`web` does **not** touch the encode pipeline, does not read `EncodeJobDetails.compressionEnabled` (it
never queries that field at all), and does not make the presets persist — they stay exactly the
decorative local state `029-settings-screen-tabs` shipped. `web` also adds no new GraphQL operation:
`updateSettings` already carries arbitrary catalog keys.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/form/switch/Switch.tsx` | Modified (currently untracked) | Strip its non-conforming comments before it is committed (Article XI) |
| `services/web/src/components/settings/CompressionPanel.tsx` | Modified | `Switch` replaces `Checkbox`; new `compressionEnabled` prop; hidden input; `disabled` on the presets |
| `services/web/src/components/settings/SettingsForm.tsx` | Modified | Pass `compressionEnabled={getSettingValue("compression_enabled") === "true"}` |
| `services/web/src/actions/settings.ts` | Modified | `compression_enabled` joins `BOOLEAN_KEYS` |

No new component, and no new message keys: `settings.compression.enabledLabel` and the preset labels
already exist in both `messages/en.json` and `messages/es.json`.

## Existing code to reuse

- `services/web/src/components/settings/CheckboxField.tsx` — **the idiom to copy.** `Checkbox` and
  `Switch` are both controls that render no `name`d input a `<form>` can read, so the value reaches
  `FormData` through a sibling `<input type="hidden" name={key} value={checked ? "true" : "false"} />`.
  Do not add a `name` to `Switch`; do not reach for an uncontrolled native checkbox.
- `services/web/src/actions/settings.ts` — `BOOLEAN_KEYS` and its loop. Its comment states the rule
  this feature depends on: read the hidden input's **value**, never `formData.has(key)`, because the
  hidden input is always present. Adding the key to that array is the whole action change.
- `services/web/src/components/form/input/Radio.tsx` — already takes `disabled`, already renders the
  disabled state (`text-gray-300`, `cursor-not-allowed`, greyed control) **and** already guards its
  own `onChange`. REQ-3 is satisfied by passing the prop. Do not style around it and do not add a
  wrapper with `pointer-events-none`.
- `services/web/src/components/form/switch/Switch.tsx` — the user's new component. It is
  uncontrolled-with-callback: it seeds from `defaultChecked`, keeps its own `isChecked`, and reports
  through `onChange`. That is enough here — the panel mirrors the state for the hidden input and the
  `disabled` props — so **do not rewrite it into a controlled component** for this feature.
- `services/web/src/components/settings/SettingsForm.tsx` — `getSettingValue(key)` is how every panel
  reads its initial value out of the `settings` array; the `movies_enabled` line beside it is the
  boolean precedent.

## Steps

1. `Switch.tsx`: delete the inline comments (`// Added prop to toggle color theme`,
   `// Default to blue color`, `// Blue version`, `// Gray version`, `// Toggle when the label itself
   is clicked`). Article XI allows no explanatory comments in new code, and this file is being
   committed for the first time as part of this feature. Change nothing else about it — not the props,
   not the markup, not the colour logic.
2. `SettingsForm.tsx`: pass `compressionEnabled={getSettingValue("compression_enabled") === "true"}`
   into `<CompressionPanel />`. The panel stays where it is, inside the main `<form>` and inside the
   always-mounted `hidden`-class layout — do **not** conditionally render it; the whole file's
   structural rule (FormData reads the DOM) applies to this panel too.
3. `CompressionPanel.tsx`:
   - take a `compressionEnabled: boolean` prop and seed the existing `enabled` state from it instead
     of `useState(false)`;
   - replace `<Checkbox …>` with `<Switch label={t("enabledLabel")} defaultChecked={compressionEnabled}
     onChange={setEnabled} />`, and drop the now-unused `Checkbox` import;
   - add `<input type="hidden" name="compression_enabled" value={enabled ? "true" : "false"} />`
     beside it;
   - pass `disabled={!enabled}` to every `<Radio>`, and grey the `presetLabel` heading to match;
   - update the file's header comment, which currently says this tab reaches nothing and adds no
     catalog key — that statement becomes false with this change and a stale comment asserting the
     opposite of the truth is worse than none. Keep it to the facts (the switch persists
     `compression_enabled`; the presets still do not persist).
4. `actions/settings.ts`: add `"compression_enabled"` to `BOOLEAN_KEYS`. Leave
   `updateDefaultLanguagesAction` alone — its whole reason for existing is that it must *not* touch
   the boolean keys.

## Contract obligations

`web` consumes one thing: the settings catalog key `compression_enabled`, kind `boolean`, sent
through the existing

```graphql
mutation UpdateSettings($entries: [SettingInput!]!) {
  updateSettings(entries: $entries) { key value }
}
```

Obligations, all of them already satisfied by the machinery being reused — the point is that they
must not be broken:

- The key is sent on **every** save of the main form, as an explicit `"true"` or `"false"`, whichever
  tab the user was on. Never omitted, never blank. (`EDITABLE_KEYS`' blank-value filter is why this
  belongs in `BOOLEAN_KEYS` and not there.)
- Error handling is the existing one and needs no new branch: `error.setting.expected_boolean` and
  `error.setting.not_editable` arrive as ordinary GraphQL errors and render through
  `translateGraphQLError` into the form's existing error paragraph; `error.auth.admin_required`
  reaches `redirectIfUnauthenticated` like every other settings error.
- `web` reads no new query field. `EncodeJobDetails.compressionEnabled` belongs to `worker`.

The delta in `../spec.md` is read-only. If it looks wrong from here, stop and report.

## Tests

**None owed.** This service has no test runner and no `*.spec.tsx` anywhere in `src/` — the standard
here is `bin/npm web run lint` plus `bin/npm web run build`, and the behaviour is verified through
AC-1/AC-2/AC-3 by hand. The one failure in this slice that would be silent — a boolean key not sent
explicitly, so a save from another tab writes `false` — is caught by AC-3, which exists for exactly
that reason and must actually be performed, not assumed.

## Done when

```bash
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

All three clean (`check-messages` must stay clean: this slice adds no key, so any parity error it
reports is something the slice broke). Then, by hand at `/settings` → Compresión: the control is a
sliding switch; off, the three preset radios do not respond to a click; on, they do; Save, reload,
the switch is still where it was left; and a Save performed from the General tab does not change it.
