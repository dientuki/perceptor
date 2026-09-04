---
title: Settings Screen Polish — web slice
service: web
last_updated: 2026-09-04
status: Implemented
---

# PLAN: Settings Screen Polish — `web` (`web/plan.md`)

## Scope

This slice owns every screen change in the feature: the six adjustments to `/settings`
(`src/components/settings/`) and the retype of `/preferences` forced by the contract change `api`
makes. It is the larger slice by file count and the smaller one by risk — with one exception, the
Compression control, where the current code's failure mode is to look like it worked.

It does **not** own the schema, the migration, the setting key's validation, or the error copy `api`
produces. `compression_resolution` is validated on the api side against four values; this slice
submits one of them and renders the rejection if it does not. The two catalog mutations are called
from here and implemented there.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/components/settings/SettingsForm.tsx` | Modified | Three tab icons; save/error state cleared on tab change |
| `src/components/settings/GeneralPanel.tsx` | Modified | Chevron wrapper around the locale `Select` |
| `src/components/settings/MediaServerFields.tsx` | Modified | Chevron wrapper around the client `Select` |
| `src/components/settings/MediaManagerPanel.tsx` | Modified | `CheckboxField` → `Switch`; the two folder pickers gated by their switch |
| `src/components/settings/PathPicker.tsx` | Modified | Accepts `disabled`; the visible input becomes read-only, the hidden input keeps carrying the stored value |
| `src/components/settings/CompressionPanel.tsx` | Modified | Preset → Resolution, four values, actually submitted as `compression_resolution` |
| `src/components/settings/TorrentManagerPanel.tsx` | Modified | The group ABM: input, badge list, inline error |
| `src/components/settings/CheckboxField.tsx` | Possibly deleted | Delete only if nothing else imports it after step 4 — grep first |
| `src/components/form/SelectWithChevron.tsx` (name at implementer's discretion) | New | The `relative` wrapper + positioned `ChevronDown`, so the pattern exists once rather than twice |
| `src/components/form/form-elements/` | **Deleted** | Uncommitted TailAdmin sample gallery; imports a `@/icons` alias this project does not define (NFR-4) |
| `src/actions/settings.ts` | Modified | `compression_resolution` added to `EDITABLE_KEYS` |
| `src/actions/preferences.ts` | Modified | `scope` dropped from every `TorrentGroup` selection set; `torrentGroups` split into the two fields; `createTorrentGroup` / `deleteTorrentGroup` actions added |
| `src/types/preferences.ts` | Modified | `TorrentGroup.scope` removed; `UserPreferences` gains the two lists |
| `src/components/preferences/PreferencesForm.tsx` | Modified | `idsFrom` and the two catalog filters stop keying on `group.scope` |
| `src/components/preferences/TorrentGroupPickerField.tsx` | Modified | Only if it reads `scope` — check; it may need no change at all |
| `src/app/(dashboard)/settings/page.tsx` | Modified | Fetches the group catalog and passes it into the form |
| `messages/en.json`, `messages/es.json` | Modified | New copy; `errors.torrent_group.wrong_scope` removed, `name_taken` and the name-required key added |

## Existing code to reuse

- `src/components/form/switch/Switch.tsx` — the control REQ-3 asks for, already used by
  `CompressionPanel`. It is uncontrolled (`defaultChecked` + `onChange`) and renders no `name`d
  input, which is exactly why `CompressionPanel` pairs it with a hidden input. Copy that pairing;
  do not make `Switch` controlled.
- `src/components/settings/PathPicker.tsx` and `CheckboxField.tsx` — both already implement "a
  controlled widget with no `name`, plus one hidden input beside it carrying the submitted value".
  This is the idiom for every new control in this slice, including the Resolution radios.
- `src/components/form/Select.tsx` — already has `appearance-none` and already carries `name`. REQ-2
  is a wrapper around it, **not** a replacement for it. The sample in
  `form/form-elements/SelectInputs.tsx` shows the wrapper shape (`div.relative` + an absolutely
  positioned span, `pointer-events-none`, `right-3 top-1/2 -translate-y-1/2`); take the shape, take
  `ChevronDown` from `lucide-react`, and delete the sample.
- `src/components/preferences/LanguagePickerField.tsx` — the badge-with-an-X block at the bottom
  (`Badge` from `components/ui/badge/Badge`, `color="primary"`, `endIcon` holding a `<button>` with
  an `X` from `lucide-react` and an `aria-label`). REQ-8 asks for visually the same thing; reuse the
  markup, not a new badge component.
- `src/actions/settings.ts`'s `updateSettingsAction` — `compression_resolution` is a plain string
  key: adding it to `EDITABLE_KEYS` is the whole change. It is **not** a `BOOLEAN_KEYS` entry.
- `src/lib/graphql-error.ts`'s `translateGraphQLError` — every new action derives its error text
  through it. Never render `errors[0].message` raw.

## Steps

1. **Icons (REQ-1).** In `SettingsForm.tsx`'s `tabItems`: Media Server → `Cast`, Compression →
   `FileVideoCamera`, Media Manager → `Library`, all from `lucide-react` (all three verified as real
   exports of the installed version). The other three tabs keep `Globe`, `Cloud` and `Clock`.
2. **Save message (REQ-7).** `useActionState`'s `state` survives a tab change because the component
   does not unmount. Clear it when `activeTab` changes — the simplest correct shape is a piece of
   state the tab handler resets, gating the render of both the success and the error paragraph.
   Do not conditionally render the panels to force a remount: `SettingsForm.tsx`'s header comment
   explains why every panel stays mounted, and breaking that silently drops fields from the save.
3. **Chevron (REQ-2).** Add the wrapper component and use it in `GeneralPanel.tsx` and
   `MediaServerFields.tsx`. `name`, `defaultValue`/`value`, `onChange` and `disabled` must pass
   through untouched — the media-server select drives conditional rendering of host/port/apiKey, and
   `SettingsResolver` treats an absent key as "unchanged", so a select that stops submitting its
   value fails quietly.
4. **Switches and gating (REQ-3, REQ-4).** Replace the two `CheckboxField` uses in
   `MediaManagerPanel.tsx` with `Switch` + hidden input, mirroring `CompressionPanel`. Lift the two
   booleans into the panel's state and pass `disabled` into the matching `PathPicker`. In
   `PathPicker.tsx`, `disabled` makes the visible input read-only and greys the row — **the hidden
   input keeps submitting the stored value unchanged**. Do not blank it, do not drop it, do not fall
   back to `'.'` because the control is disabled: `'.'` means "the media root itself", and writing it
   silently repoints the library. Then grep for remaining `CheckboxField` importers; delete the file
   if there are none.
5. **Resolution (REQ-6).** In `CompressionPanel.tsx`, replace the three presets with
   `['4k', '1080p', '720p', '360p']`, relabel to Resolution, seed the state from a new
   `compressionResolution` prop (fed by `SettingsForm` from `getSettingValue("compression_resolution")`,
   falling back to `1080p`), and add a hidden `name="compression_resolution"` input carrying the
   selection. The radios keep `name=""` — that part of the current code is right, and the header
   comment explaining why is worth keeping. Add `compression_resolution` to `EDITABLE_KEYS`. The
   radios stay disabled while compression is off, as they are today.
6. **Preferences retype (NFR-3).** With `api` landed: drop `scope` from `TorrentGroup` in
   `src/types/preferences.ts`, add `movieTorrentGroups` / `showTorrentGroups` to `UserPreferences`,
   and remove `scope` from every selection set in `src/actions/preferences.ts` — it appears in four
   documents (`PREFERENCES_QUERY`, `TORRENT_GROUPS_QUERY`, and the two `setAllow…`/`setAudio…`
   mutation payloads) plus `SET_PREFERRED_TORRENT_GROUPS_MUTATION`. In `PreferencesForm.tsx`,
   `idsFrom(...)` is replaced by reading the two new lists directly, and `movieCatalog`/`showCatalog`
   both become the whole catalog — every group is now offerable for either scope, which is REQ-9.
   `setPreferredTorrentGroupsAction` keeps its `scope` argument and its `Number(id)` conversion.
7. **Catalog actions.** Add `createTorrentGroupAction(name)` and `deleteTorrentGroupAction(id)` to
   `src/actions/preferences.ts`, following the file's own two conventions: module-level
   SCREAMING_SNAKE document, `redirectIfUnauthenticated` then `translateGraphQLError` on errors,
   returning `{ error: string } | { success: true; ... }` rather than throwing — the panel needs to
   render the duplicate message inline, and a `throw` from a server action loses it.
8. **Torrent Manager ABM (REQ-8, REQ-10).** `TorrentManagerPanel.tsx` takes the catalog as a prop,
   holds it in state, and renders: the existing downloads picker and indexer key, then a labelled
   text input with an add affordance (Enter and a button both submit — but **not** as a nested
   `<form>`; this panel lives inside the settings `<form>`, so the add handler must
   `preventDefault`), then the badge list below it. Add and remove call the actions and only mutate
   local state after the action reports success — never optimistically. A returned error renders
   inline next to the input and leaves the list untouched.
9. **Page wiring.** `src/app/(dashboard)/settings/page.tsx` adds `getTorrentGroups()` to its existing
   `Promise.all` (the action already exists) and passes the result into `SettingsForm`, which passes
   it to `TorrentManagerPanel`.
10. **Copy.** Every new string into both `messages/en.json` and `messages/es.json` — `es` in the
    existing Rioplatense register. Under `errors.torrent_group`: add `name_taken`, delete
    `wrong_scope`; add the validation key for the empty name. Under `settings.compression`: rename
    `presetLabel` to a resolution label and replace the three preset names with the four values
    (these are literal resolution names — they need no translation, but they still need catalog
    entries, or `check-messages.mjs` will not see them at all). Run
    `bin/cli web node scripts/check-messages.mjs` before calling this done.
11. **Delete the sample gallery.** `rm -r src/components/form/form-elements/`. It is untracked
    reference material that does not compile.

## Contract obligations

This slice **consumes** `../spec.md` § GraphQL Contract Delta. Read it, do not restate it. What
matters here is that three of the changes are breaking and none of them produce a TypeScript error:

- `TorrentGroup.scope` is gone. A document still selecting it fails the whole operation with
  "Cannot query field scope on type TorrentGroup" — loud, but it takes out `/preferences` entirely.
  Find every occurrence with
  `grep -rn "scope" services/web/src/actions/preferences.ts services/web/src/types/preferences.ts`.
- `torrentGroups` no longer accepts `scope`. `getTorrentGroups()` already calls it without one, so
  this needs no change — verify rather than assume.
- `UserPreferences.torrentGroups` no longer exists. The two replacement fields must be selected in
  `PREFERENCES_QUERY` **and** in the `setAllowCinemaReleases` / `setAudioMandatory` payloads, which
  both return a full `UserPreferences`.

Errors this slice must handle, and what it does with each:

| Key on `extensions.i18n.key` | Where it comes from | What `web` renders |
| :-- | :-- | :-- |
| `error.torrent_group.name_taken` | `createTorrentGroup` | Inline beside the group input; no badge added |
| `error.validation.torrent_group_name_required` | `createTorrentGroup` | Inline beside the group input |
| `error.torrent_group.not_found` | `deleteTorrentGroup` | Inline beside the group input; the badge stays |
| `error.auth.admin_required` | either mutation | Unreachable from `/settings` (admin-only route); falls through to the generic banner |
| `error.setting.expected_enum` | `updateSettings` | The main form's existing error paragraph |

All five are read through `translateGraphQLError`, never by matching message text.

## Tests

**Nothing in this slice is owed a test, and the reason is structural**: `services/web` has no test
runner and no test suite at all (`services/web/CLAUDE.md`). The verification this service has is
`bin/npm web run build`, `biome check`, and `scripts/check-messages.mjs` for catalog drift.

That is a real gap for exactly one thing in this feature — the Resolution control, whose failure
mode (a value the user picks, sees confirmed, and which never reaches the database) is silent by
construction and is the state the code is in today. It is covered instead by **AC-5**, which reads
the `settings` row directly rather than trusting the screen. Treat that criterion as the test.

## Done when

```bash
bin/npm web run build
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
```

The build exits 0 with `src/components/form/form-elements/` gone, `biome check` is clean, the
message catalogs do not drift, and `grep -rn "\.scope" src/components/preferences/` finds no read of
a group's scope.
