---
title: Language Regional Variants — web slice
service: web
last_updated: 2026-08-28
status: Approved
---

# PLAN: Language Regional Variants — `web` (`web/plan.md`)

## Scope

This service owns the screen. It replaces the two divergent language pickers with one component,
groups a language that has variants under a non-selectable heading, shows the chosen set as
removable badges, and switches every hand-retyped GraphQL document from `iso2` to `tag`. It also
adds the Spanish and English copy for the two language errors that today fall through to `api`'s
English message (REQ-11).

It is **not** deciding which rows are pickable — `api` already filtered them out of the `languages`
query — and it is **not** adding a language-name list to either message catalog: display names come
from `Intl.DisplayNames`, which is this service's standing rule
(`services/web/CLAUDE.md` § UI internationalization). Writes are confined to `services/web/` and
this directory; anything else is a stop-and-report.

**Do not start until `api`'s slice is in.** This service has no test runner — its only real gate is
opening the page against a running `api` — so building against the old schema produces work nobody
can verify.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/languages.ts` | Modified | `Language` gains `tag: string` |
| `src/actions/languages.ts` | Modified | `tag` in the query's selection set; both mutations rename `$iso2` → `$tags` and parse a comma-separated field |
| `src/components/media/LanguagePicker.tsx` | Modified | Rewritten as the shared dual-pane picker |
| `src/components/settings/DownloadPanel.tsx` | Modified | Drops `MultiSelect`, renders `LanguagePicker` |
| `src/components/movies/Movie.tsx` | Modified | Prop pass-through only, if the picker's props change |
| `src/components/shows/Show.tsx` | Modified | Same; **stays a Server Component** |
| `src/actions/movies.ts` | Modified | `tag` added to the `preferredLanguages` selection set |
| `src/actions/shows.ts` | Modified | Same |
| `messages/en.json` | Modified | `errors.language.*`, plus any picker copy |
| `messages/es.json` | Modified | Same, Rioplatense register |

`src/components/form/MultiSelect.tsx` is **left in place, unused** — it is TailAdmin template
scaffolding and deleting it is explicitly out of scope (`../spec.md` § Out of Scope).

## Existing code to reuse

- `src/components/ui/badge/Badge.tsx` — already renders a rounded pill with `variant`/`color` and an
  `endIcon` slot. The chosen-set badges are this component; the X goes in `endIcon` as a real
  `<button>` so it is reachable by keyboard. Do not hand-roll a pill.
- `src/components/settings/DownloadPanel.tsx` — the **hidden-input idiom** it already uses is the
  pattern to keep: a controlled control renders no `name`d input a `<form>` can read, so one
  `<input type="hidden" name="default_languages" value={selected.join(",")}>` sits beside it. The
  new picker generalises exactly this, with the input's `name` as a prop.
- `src/components/media/LanguagePicker.tsx` — its `useActionState` wiring, its
  `{ error } | { success: true }` handling and its `Intl.DisplayNames` + `localeCompare(...,
  activeLocale)` display logic all survive the rewrite. Only the control between them changes.
- `src/lib/graphql-error.ts` — `translateGraphQLError` already resolves `extensions.i18n.key`
  against the `errors` namespace. Adding the two `errors.language.*` catalog entries is all REQ-11
  needs; no new plumbing.
- `src/actions/media-server.ts` — the canonical server-action shape, if any action here is rewritten
  rather than edited.
- `lucide-react` — the icon source for the badge's X and the entry's check. Do not paste inline
  `<svg>` path data (`services/web/CLAUDE.md` § UI origin).

## Steps

1. **Type and documents.** Add `tag` to `src/types/languages.ts`, then add `tag` to every
   `Language` selection set: the `languages` query in `src/actions/languages.ts` and the
   `preferredLanguages` blocks in `src/actions/movies.ts` and `src/actions/shows.ts`. A missing
   `tag` here is what makes the picker unable to match its options against the saved selection.

2. **Mutations.** In `src/actions/languages.ts`, rename `$iso2` to `$tags` in **both**
   `SET_MOVIE_PREFERRED_LANGUAGES_MUTATION` and `SET_SHOW_PREFERRED_LANGUAGES_MUTATION`, and in the
   variables object. Both documents live in this one file — do the pair in one pass; the missed-one
   case is in `../plan.md` § Risks.

3. **Form parsing.** Both actions currently read `formData.getAll("iso2")`. The picker emits **one**
   comma-separated hidden input, so they read `formData.get("tags")` and split on `,`, dropping
   empty segments — the same split/trim/filter `api`'s settings branch does, for the same reason: a
   cleared picker must send an empty list, not a list containing `""`.

4. **The picker.** Rewrite `src/components/media/LanguagePicker.tsx` as the dual-pane control:

   - Group the `options` by shared `iso2`. A group of one renders as a single entry; a group of more
     than one renders a non-selectable heading — the base name from `Intl.DisplayNames.of(iso2)` —
     with its rows as entries beneath. The rule is derived from the data, never a hard-coded list of
     which languages have variants (REQ-4).
   - Sort by the base language's display name in the active locale, so a group stays contiguous.
     Sorting by each row's own display name is what scatters "European Spanish" and "Latin American
     Spanish" apart in English (AC-4).
   - Left pane: available entries, click toggles, chosen entries stay visible and marked rather than
     disappearing. Right pane: the chosen set as `Badge`s with a remove control. One state value
     backs both panes so the two can never disagree (REQ-5).
   - Emit one `<input type="hidden" name={name} value={selected.join(",")}>`.
   - Keep the component's own state seeded from `selected`, so `Show.tsx` does not have to become a
     client component to hold it.

5. **Accessibility.** Make each entry a real `<button type="button">` carrying `aria-pressed`, and
   the badge's remove control a real `<button>` with an `aria-label` naming the language. Do **not**
   reach for `role="listbox"`: its children must be `option`s, and buttons inside a listbox is
   invalid ARIA that reads worse than no roles at all. Plain toggle buttons give keyboard operation
   and state announcement for free, which is what NFR-5 asks for.

6. **Settings.** In `DownloadPanel.tsx`, swap `MultiSelect` for the picker, passing
   `name="default_languages"` and the current value split from the setting string. The
   always-sent-explicitly behaviour in `src/actions/settings.ts` (`ALWAYS_SENT_STRING_KEYS`) is
   unchanged and still required — `""` means "no default languages", not "leave the previous value".

7. **Detail pages.** `Movie.tsx` and `Show.tsx` pass `name="tags"`. Neither changes structurally;
   `Show.tsx` stays a Server Component with the picker as its client child.

8. **Copy.** Add `errors.language.unavailable` and `errors.language.duplicate` to both catalogs,
   interpolating `{tag}`. In `es`, prefer wording that cannot be misread as "the release does not
   have this language" — the key's name invites that reading and it is not what it means
   (`../spec.md` § GraphQL Contract Delta). Add any new picker copy (pane labels, empty state) to
   both catalogs, and run the parity script.

## Contract obligations

`web` consumes `../spec.md` § GraphQL Contract Delta exactly. It is read-only here — if it looks
wrong, stop and report rather than working around it locally. **There is no codegen**: every field
name, argument name and error condition below is hand-copied, compiles fine when wrong, and fails at
runtime.

Consumed shape:

- `Language { id tag iso2 iso3 name }` — `tag` is the value submitted and compared; `iso2` is the
  grouping key and the source of the group heading's name; `name` is an English fallback only, never
  the rendered label.
- `Query.languages` — already filtered to pickable rows. Do not re-filter, and do not assume `es`
  will be present.
- `setMoviePreferredLanguages(movieId: Int!, tags: [String!]!)` and
  `setShowPreferredLanguages(showId: Int!, tags: [String!]!)`.

Errors this slice must handle, not just the happy path:

| Key | When | What `web` does |
| :-- | :-- | :-- |
| `error.language.unavailable` | a submitted tag has no row | Render the translated message inline beside the picker, **keeping the user's current selection on screen** so the save is correctable (AC-7/AC-8) |
| `error.language.duplicate` | the same tag submitted twice | Same treatment |
| `error.movie.not_found` / the series equivalent | saving against a title the caller does not own | Existing behaviour, reused verbatim — do not invent new copy for it |
| an auth error | session expired mid-save | `redirectIfUnauthenticated` — these are **form actions**, not render-pass reads, so this is the correct one of the two helpers (`services/web/CLAUDE.md`) |

## Tests

**None, and that is not an omission.** This service has no test file, no runner and no `test`
script, and introducing one is explicitly its own decision requiring its own spec
(`services/web/CLAUDE.md` § Tests). Adding Vitest as a side effect of this feature would be a
violation, not diligence.

What replaces it here: the typecheck, Biome on the files actually touched (never the repo — it
reports ~1598 pre-existing errors), `scripts/check-messages.mjs` for catalog parity, and the manual
pass in `../plan.md` § Verification. Step 3 of that pass — repeating the save on a **series** detail
page, not only a film — is the one that catches the missed second mutation rename, and it is the
only check that covers it anywhere in this feature.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web npx --no biome check src/components/media/LanguagePicker.tsx src/components/settings/DownloadPanel.tsx src/actions/languages.ts
bin/cli web node scripts/check-messages.mjs
```

`tsc` reports 0 errors, `build` exits 0, Biome is clean on the touched files, and the message parity
script exits 0. Then the manual pass in `../plan.md` § Verification, including the series page and
the keyboard walkthrough.
