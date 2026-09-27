---
title: Title Detail Three-Column Layout — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-26
status: Approved
---

# PLAN: Title Detail Three-Column Layout (`plan.md`)

## Approach

One service, `web`, and no wire change. The whole feature is a reorganisation of two components
that already exist — `src/components/movies/Movie.tsx` and `src/components/shows/Show.tsx` — plus
the extraction of two things they will now both need.

The layout itself is a three-column grid replacing the `flex md:flex-row` the two components share
today. Nothing about the poster block changes; the current single right-hand column splits in two.
The centre column keeps the title heading, and on a film keeps the file/magnet buttons above the
synopsis; a series gets the same grid with an empty acquisition row, because acquisition on a
series is season-scoped and lives in `SeasonAccordion.tsx` (`059`). Both pages keep every full-width
row below the header — `DownloadsPanel`, then `SearchTorrent` on a film, then the season accordion
on a series — untouched and in their current order.

Two extractions carry the real weight.

**The effective-language merge becomes a shared helper.** Today it is eight inline `const`s at the
top of `Movie.tsx` — "a title with no languages of its own falls back to the caller's
`/preferences`, independently for audio and subtitles" — feeding `RankingDebugPanel`, which
`process.env.NODE_ENV === "production"` hides. REQ-7 makes that resolution user-facing, and `Show.tsx`
needs it too, so it moves to `src/lib/` under the rule this service already states: a pure helper a
second file would want does not live beside a sibling component (`053-downloads-panel-repair`,
`services/web/CLAUDE.md` § "One renderable component per file"). `RankingDebugPanel` keeps its exact
current props and keeps being dev-only (NFR-5) — it is fed from the helper instead of from inline
locals, and nothing it renders changes.

**`TitleLanguagesForm` moves into a modal and stops being a standing form.** The form itself is
kept as-is in substance: the same two `LanguagePickerField` panes, the same mandatory `Checkbox`,
the same three-action `Promise.all` submit, the same revert-to-props on a refusal. It gains a
success callback so its host can close the dialog and refresh, and its host becomes
`TitleLanguagesModal.tsx` on the existing `Modal`/`useModal` pair — the same pair
`RemoveTitleModal`, `DeleteDownloadModal`, `ImportFileModal` and `ImportMagnetModal` all use. A new
read-only `TitleLanguagesPanel.tsx` renders the summary and owns the button that opens it. The
alternative — a collapsible inline section — was rejected: the spec asks for a modal, and a
disclosure would keep the editing controls mounted, which is exactly the vertical cost the redesign
is removing.

The rejected alternative worth recording is on the data side. `Movie.tsx` fetches `/preferences`
client-side in a `useEffect` today, which was acceptable while the only consumer was a dev-only
panel that could flash empty. For a production panel it would render "no languages" and then
correct itself, and `Show.tsx` is a Server Component that would have to become a client one to copy
it. Both pages instead join `getPreferences()` into the `Promise.all` they already run — the same
call `/preferences/page.tsx` already makes from a render pass, and already safe there because it
ends in `redirectToClearSession`, not the cookie-mutating `redirectIfUnauthenticated`
(`services/web/CLAUDE.md` § "redirectIfUnauthenticated vs redirectToClearSession"). The `useEffect`
is deleted rather than kept alongside.

## Order of Work

One service, so this is a sequence inside `web`, not a cross-service handshake. Nothing here can
run in parallel across services; the two extractions must land before the two consumers are
rewritten, or both consumers grow their own copy of what is being extracted.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `web` | `src/lib/effective-languages.ts` — the merge both detail components consume. Extracted first so neither rewrite reinvents it. |
| 2 | `web` | `TitleLanguagesForm.tsx` gains its success callback; `TitleLanguagesModal.tsx` and `TitleLanguagesPanel.tsx` are added. Independent of step 1. |
| 3 | `web` | The two pages thread `getPreferences()` into their existing `Promise.all`. Must precede step 4 — the panel cannot mark a value inherited without it. |
| 4 | `web` | `Movie.tsx` and `Show.tsx` are relaid out onto the three-column grid and mount the panel. Depends on 1, 2 and 3. |
| 5 | `web` | `messages/en.json` / `messages/es.json`. Can be written alongside step 2/4, must be complete before `check-messages` runs. |

Steps 1 and 2 are genuinely independent of each other and may be done in either order or together.
Step 4 is a single step, not two: `Movie.tsx` and `Show.tsx` must get the same grid, and splitting
them across two passes is how they drift.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is **None — this feature does not cross the service
boundary**, and that is frozen as of `status: Approved`. `services/api/src/schema.gql` must not
appear in the diff; `git diff --stat services/api services/worker` must be empty (NFR-2, AC-11).

What an implementer will be tempted to change and must not:

- **Adding an `effectiveAudioLanguages` field to `Movie`/`Show` on the API.** It looks like the
  right place — the merge is business logic and `api` already performs its own copy of it when
  ranking. It is out of bounds here: it turns a one-service layout change into a contract change,
  and the merge `web` performs is a *display* of the rule, not a second authority for it. If the
  two ever disagree, `api`'s is correct and this panel is the bug.
- **`RankingDebugPanel`'s production gate.** The new panel does not replace it, and the temptation
  to drop `process.env.NODE_ENV === "production"` now that a user-facing panel shows overlapping
  values must be refused (NFR-5). Its vocabulary is ranking internals.
- **Collapsing `Movie.tsx` and `Show.tsx`.** The film/series duplication is a spec-level decision
  (`006-media-search` § Out of Scope) that outranks Article X. Both get the same grid; they do not
  get a shared component.
- **Adding file/magnet buttons to the series header.** REQ-4 is deliberate, and the empty
  acquisition row in the centre column of `/shows/[id]` is the feature, not an oversight.

If any of this turns out to be wrong: stop, amend `spec.md`, re-approve.

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `getPreferences()` rejects and takes the whole detail page with it | Today `Movie.tsx` catches it client-side and degrades to `null`; joined naively into `Promise.all`, a `/preferences` failure turns a working detail page into an error screen — and a title whose downloads are in flight becomes unreachable | The promise is wrapped so a failure yields `null` and the panel renders its title-only values; the wrapper calls `unstable_rethrow` first, per the rule below |
| The wrapper swallows Next's redirect signal | `redirectToClearSession` *throws* to work. A bare `.catch(() => null)` turns an expired session into a permanently "no preferences" panel instead of a bounce to `/login` — no error anywhere, and the user never learns they are signed out. This is the same trap `(dashboard)/page.tsx` documents for `Promise.allSettled` | `unstable_rethrow(error)` (`next/navigation`) is the first statement in the catch, before anything reads the value — named explicitly in `web/plan.md` step 3 and owed a test-free but reviewed diff |
| The panel shows inherited values as if the title owned them | Silent: the user believes the title is configured, edits nothing, and the ranking keeps using whatever `/preferences` says. Changing `/preferences` later silently changes this title | REQ-7's inherited marker is per-category, not per-panel — audio and subtitles resolve independently, which the helper enforces by returning two separate flags rather than one |
| A refused save leaves the panel showing the rejected value | The modal closes optimistically, the panel re-renders from unchanged server props, and the two disagree until a reload | The form only reports success after all three actions resolve without an error; the modal closes on that callback alone, never on the submit click (REQ-11, AC-7) |
| The modal keeps a discarded selection | Reopening shows what the user abandoned, and the next Guardar writes it without them meaning to | Structural, not defensive: `Modal` returns `null` when closed, so the form unmounts and its `useState(() => tagsFrom(...))` initialisers re-read the props on reopen. An implementer who lifts the form's state up to the panel to "avoid remounting" breaks REQ-12 (AC-8) |
| Catalog drift | A new key in `en.json` only renders the raw key path to every `es` user | `bin/cli web node scripts/check-messages.mjs` in Verification, AC-10 |

## Verification

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff --stat services/api services/worker
```

The last command must print nothing (NFR-2, AC-11). `web` has no test runner
(`services/web/CLAUDE.md`), so there is no `bin/npm web test` line here.

Then the manual pass, on a running stack (`bin/dev`):

1. `/movies/<id>` on a registered film at desktop width — three columns; poster left; heading,
   file and magnet, synopsis centre; Refresh, Remove, short switch, content kind, language panel
   right (AC-1). Below them, at full width and in order: downloads, the torrent search, its
   results (AC-2).
2. `/shows/<id>` — same three columns, no file/magnet in the centre, no short switch on the right,
   season accordion below the downloads panel at full width (AC-3).
3. On a film with no audio languages of its own and `/preferences` audio set to `es`: the panel
   reads `es`, marked inherited. Open the modal, set the film's audio to `ja`, save — the modal
   closes and the panel reads `ja`, unmarked, with no manual reload (AC-5).
4. With `/preferences` subtitles empty and the title's empty, the subtitle line reads the
   empty-state text (AC-6).
5. `docker compose stop api`, then save in the modal — the refusal message appears inside the
   still-open modal; close it and the panel still shows the pre-attempt values;
   `docker compose start api` and reload confirms nothing was stored (AC-7, the failure path).
6. Open the modal, change the audio selection, dismiss it, reopen — the stored selection is back
   (AC-8).
7. Toggle the short switch off on a short, reload, it is off (AC-4).
8. Resize to a phone width — poster, centre, right stack in that order with no horizontal scroll
   (AC-9).
9. Switch the UI locale to `es` and re-read the panel and modal — every new label is translated
   (AC-10).
