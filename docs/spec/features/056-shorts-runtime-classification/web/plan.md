---
title: Shorts classified by runtime — web slice
service: web
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Shorts classified by runtime — `web` (`web/plan.md`)

## Scope

This slice removes the "Agregar como corto" affordance from every search screen and stops sending
`asShort` on the `addMedia` mutation. It is subtractive only — nothing new is rendered, no new
prop is introduced, no new message key is added.

It goes **first**, before `api` (see `../plan.md` § Order of Work): `asShort` is optional on the
mutation today, so an `api` that still accepts it is happy to be sent nothing, while the reverse
order would break every add button in the window between the two slices.

Read `../spec.md` and `../plan.md` first. Writes are confined to `services/web/`. The derivation
that replaces the removed button lives entirely in `api` — this slice never learns a film's runtime
and never sees one on a search result.

**The one thing this slice must not remove**: the `shortsEnabled` prop on `SearchContainer` and
`MultiSearchResults`, and the `shortsEnabled` both `/movies/add` and `/search` pass into them. It no
longer gates a button, but it still feeds `MediaList`'s `showShortBadge`, which `../spec.md` REQ-2
keeps exactly as it is. Removing it drops the short badge from every search result with no error
anywhere.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/search/MediaResultAction.tsx` | Modified | Drops the `shortsEnabled` / `addingShort` / `onAddAsShort` props, the `showAddAsShort` const and the second `<Button>`; the flex wrapper collapses back to one button |
| `services/web/src/components/search/SearchContainer.tsx` | Modified | Drops `addingShortId` / `handleAddAsShort`; `addItem` loses its `asShort` parameter and folds into `handleAdd`; `addAction`'s prop type loses `asShort?` |
| `services/web/src/components/search/MultiSearchResults.tsx` | Modified | Same removals as `SearchContainer` |
| `services/web/src/actions/media.ts` | Modified | `ADD_MEDIA_MUTATION` loses `$asShort`; `addMedia(tmdbId, type)` loses its third parameter |
| `services/web/messages/en.json` | Modified | Removes `search.container.addShortButton`, `search.container.addingShort`, `errors.media.shorts_not_a_movie` |
| `services/web/messages/es.json` | Modified | The same three keys, so the two stay in parity |

`services/web/src/app/(dashboard)/movies/add/page.tsx` and
`services/web/src/app/(dashboard)/search/page.tsx` are **not** in this list on purpose: both keep
passing `shortsEnabled` down, for the badge. Do not touch them.

## Existing code to reuse

- **`git show 1a1305c~1:services/web/src/components/search/MediaResultAction.tsx`** — the exact
  pre-`048` shape of the non-owned branch, which is what this slice restores: a single
  `<Button size="sm" onClick={() => onAdd(item)} startIcon={<Plus />} className="mt-2"
  disabled={adding}>`, no wrapping `<div>`. Use it rather than inventing a new arrangement; the
  `mt-2` moves from the wrapper onto the button.
- **`handleAdd` in both containers** — already exists; the work is folding `addItem`'s body back
  into it and deleting the `asShort` branch of its `catch`, which reverts to
  `setError(t("errorAdd", { noun }))` unconditionally. Do not leave a one-call `addItem` behind
  (Constitution, Article X).
- **`services/web/src/actions/media.ts`'s other mutation documents** — the shape `ADD_MEDIA_MUTATION`
  returns to: variables declared in the `mutation(...)` header are exactly the arguments passed, with
  no optionals left dangling.
- **`services/web/scripts/check-messages.mjs`** — the `en`/`es` parity check. Run it after editing
  either catalog; it is the only automated gate this service has for that.

## Steps

1. `MediaResultAction.tsx`: delete the three props from `MediaResultActionProps` and from the
   destructured parameter list, delete the `showAddAsShort` const and the conditional `<Button>`, and
   restore the single-button return shown above. Keep the `owned` branch and its `MEDIA_TYPE.SHOW`
   check untouched — `MEDIA_TYPE` is still imported for it. Keep the `026-multi-search` comment above
   the component.
2. `SearchContainer.tsx`: delete `addingShortId` and `handleAddAsShort`; inline `addItem` into
   `handleAdd` and drop the `asShort` ternary in its `catch`; narrow the `addAction` prop type to
   `(id: number, type: MediaType) => Promise<string>`; drop `shortsEnabled` / `addingShort` /
   `onAddAsShort` from the `<MediaResultAction>` call. **Leave the `shortsEnabled` prop on the
   component and its `showShortBadge={shortsEnabled}` on `<MediaList>` alone.**
3. `MultiSearchResults.tsx`: the identical set of removals, including the `err instanceof Error &&
   asShort` ternary. Same caveat about `shortsEnabled` / `showShortBadge`.
4. `actions/media.ts`: `ADD_MEDIA_MUTATION` becomes
   `mutation AddMedia($tmdbId: Int!, $type: String!) { addMedia(tmdbId: $tmdbId, type: $type) { id type } }`,
   and `addMedia` drops `asShort?: boolean` from its signature and from the variables object.
5. `messages/en.json` and `messages/es.json`: remove the three keys listed in § Files from both, in
   the same edit, so the catalogs never diverge.
6. Run the § Done when commands.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta — read-only:

```graphql
type Mutation {
  addMedia(tmdbId: Int!, type: String!): MediaRef!
}
```

Errors this slice must still handle on `addMedia`, all pre-existing and all already handled by the
generic `catch` in both containers (`t("errorAdd", { noun })`):

| Condition | Key on the wire |
| :-- | :-- |
| The media type is disabled system-wide | `error.media.type_disabled` |
| TMDB does not know the `tmdbId` | `error.movie.not_in_catalog` |

There is no new error to handle. `error.media.shorts_not_a_movie` is retired and its catalog entry
goes with it (step 5). `error.media.shorts_disabled` stays in both catalogs — `setMovieShort` on the
film detail page still raises it, and that screen is untouched by this slice.

A runtime that cannot be resolved produces **no error at all**: the registration succeeds as a
feature film. There is nothing for this slice to render for that case.

## Tests

This service has no test runner and this feature does not add one (`services/web/CLAUDE.md` §
"Tests: there are none"). The gates are the typecheck, `check-messages.mjs`, a successful build, and
opening the two screens.

The failure this slice could produce silently — the short badge disappearing along with the button —
is not reachable by a test here. It is covered by the manual pass in `../plan.md` § Verification
(AC-1 and AC-2 are deliberately adjacent: one checks the button is gone, the other that the badge
survived).

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/npm web run build
grep -rn 'asShort\|shorts_not_a_movie\|addShortButton\|addingShort' services/web/src services/web/messages
```

Expected: 0 typecheck errors, `check-messages.mjs` exits 0 with no drift reported, `build` exits 0,
and the `grep` returns **nothing**.

Do not run `bin/npm web run lint` as a gate — `biome check` reports ~1519 pre-existing errors across
this service and tells you nothing about this change.
