@AGENTS.md

# services/web

Rules that outrank this file: `docs/constitution.md`. Agent brief: `.claude/agents/web.md`.
Cross-service boundary: `docs/spec/graphql-contract.md`.

Next 16 App Router, React 19, React Compiler (`reactCompiler: true` in `next.config.ts`),
`output: 'standalone'`, Tailwind 4 via PostCSS. Run everything through `bin/npm web …` from the repo
root (bare `web` is also `bin/npm`'s default service).

## Lint/format: Biome, not ESLint/Prettier

This service uses `@biomejs/biome` exclusively (`biome.json`) — no ESLint or Prettier config here,
unlike `services/api`. `bin/npm web run lint` → `biome check`; `run format` → `biome format --write`.

## Data-access rule: GraphQL only, no Prisma in web

Server actions in `src/actions/` talk to the API exclusively through `fetchGraphQL` in
`src/lib/graphql-client.ts` (which reads `INTERNAL_GRAPHQL_URL`). **`services/web` has no Prisma
client and no direct DB access.** Treat any `@prisma/client` import as a bug to flag, not a working
dependency.

### The server-action pattern

Every file in `src/actions/` has the same shape. Copy `src/actions/media-server.ts`; don't invent a
variant.

```ts
'use server'

import { fetchGraphQL } from '@/lib/graphql-client';

const MEDIA_SERVER_CLIENTS_QUERY = `
  query MediaServerClients { mediaServerClients { id label } }
`;

export async function getMediaServerOptions(): Promise<MediaServerOption[]> {
  const { data, errors } = await fetchGraphQL<{ mediaServerClients: MediaServerOption[] }>(
    MEDIA_SERVER_CLIENTS_QUERY,
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al obtener los media servers soportados');
  }

  return data?.mediaServerClients ?? [];
}
```

`'use server'` on line 1; the document as a module-level `const NAME_QUERY`/`NAME_MUTATION` in
SCREAMING_SNAKE; the shape as the `fetchGraphQL<T>` type parameter; errors read from
`errors[0].message` with a Spanish fallback. Read functions `throw`; form actions used with
`useActionState` take `(prevState, formData)` and return `{ error?: string } | { success: true }`
(see `updateSettingsAction` in `src/actions/settings.ts`).

**There is no codegen.** That `<T>` is a hand-copy of `api`'s schema and nothing checks it — a
renamed field, a new non-null argument or an unhandled error condition all compile fine here and fail
at runtime. Read `docs/spec/graphql-contract.md` before changing anything that crosses the boundary.

**A server action can enrich its return value with something that never touched GraphQL.**
`createUploadTicketAction` (`src/actions/uploads.ts`) reads `process.env.PUBLIC_UPLOAD_URL`
server-side and adds it as `endpoint` alongside the ticket. The upload modal reads that instead of a
`NEXT_PUBLIC_*` variable: `NEXT_PUBLIC_*` is inlined into the browser bundle at *build* time, which
would bake whichever `.env` was present during `next build` into the image; resolving at *request*
time keeps the image deployment-agnostic. If the variable is unset the action throws before the modal
constructs the upload, rather than letting `tus.Upload({ endpoint: undefined })` fail silently.

## UI internationalization (`018-ui-i18n`)

`web` owns every string a user reads and is the only service that translates. `src/i18n/request.ts`
(next-intl's `getRequestConfig`) resolves the active locale server-side, once per request, in this
order: `User.uiLocale` (via `getCurrentUserOrNull()`, below) → `defaultUiLocale` (the installation's
default, an admin-only setting set from `/settings`'s General tab — `029-settings-screen-tabs`,
guarded by `isSupportedLocale` and read via `getDefaultUiLocale()`/`redirectToClearSession` since it
runs during render) → the request's `Accept-Language` header, language-range negotiated by
`src/i18n/negotiate.ts` → `en`. This step runs for anonymous requests too — `defaultUiLocale` is
`@Public()` on the `api` side for exactly this reason. `src/i18n/locales.ts`'s
`SUPPORTED_LOCALES`/`DEFAULT_LOCALE` is the **one** list every consumer of the supported set reads
— never hardcode `'es'`/`'en'` anywhere else. `src/app/layout.tsx` is `async`, sets `<html lang>`
from the resolved locale, and wraps the tree in `NextIntlClientProvider` with the server-loaded
catalog. Catalogs live at `messages/en.json`/`messages/es.json`; `es` keeps the existing Rioplatense
register verbatim. `scripts/check-messages.mjs` (a plain script, not a test — this service adds no
test runner) fails non-zero on catalog drift between the two files.

**Every GraphQL/REST error is translated through a key, never rendered as raw API text.**
`src/lib/graphql-error.ts`'s `translateGraphQLError(error)` reads `extensions.i18n.key`, looks it up
in the `errors` catalog namespace (`error.auth.unauthenticated` → `errors.auth.unauthenticated`),
`JSON.parse`s `extensions.i18n.params` when present, and falls back to the error's English `message`
whenever there is no key, no catalog entry, or a parse failure — it must never return the raw key
string. Every `src/actions/*.ts` read/write derives its error text through this helper now; the REST
`/uploads` error body (`services/api/CLAUDE.md`'s uploads section) carries the same `{ message, i18n
}` shape but **not** wrapped in `extensions`, so `importFileModal.tsx` reads it directly rather than
reusing `translateGraphQLError`. See `docs/spec/graphql-contract.md` § "UI internationalization" for
the full envelope and key vocabulary — `api` and `worker` own the keys; `web` never invents one.

**A Server Action `throw` loses `extensions.i18n.key`; branching on the key needs a return value.**
`translateGraphQLError` upgrades the error *text*, but a component that needs to decide *which* UI
to show (e.g. "already completed, offer to replace" versus "busy, offer to retry") needs the key
itself, and the message survives a `throw new Error(...)` while the key does not. Since
`027-replace-completed-media`, the five acquisition actions (`importMagnetAction`,
`addTorrentToMovieAction`, `addTorrentToEpisodeAction`, `addMagnetToEpisodeAction`,
`createUploadTicketAction`) no longer throw on a GraphQL error — they return
`AcquisitionResult` (`src/types/media.ts`): `{ success: true; id; status } | { error: string;
errorKey?: string }`, built with `toActionError(error)` (`src/lib/graphql-error.ts`), a thin wrapper
around `translateGraphQLError` that additionally passes `extensions.i18n.key` through untouched.
Components compare `errorKey` against catalog keys directly — never against a translated message
substring. This replaced a `message.includes(t("conflictMarker"))` pattern that matched `api`'s
**English** error text regardless of the active locale, which meant the "Reemplazar" affordance
never appeared at all when rendering in `es`.

**Language names are not a catalog entry.** `LanguagePickerField.tsx` renders each option through
`Intl.DisplayNames([activeLocale], { type: 'language' })` and sorts with `localeCompare(...,
activeLocale)` — `api`'s `languages` query returns English names only (display authority moved
here); do not add a language-name list to either catalog. This still holds for regional variant
tags since `030-language-regional-variants`: `Intl.DisplayNames.of('es-419')`/`.of('es-ES')` render
"Latin American Spanish"/"European Spanish" (or the `es` locale equivalents) without either string
ever landing in `messages/en.json`/`es.json` — only the two write-path error keys
(`errors.language.unavailable`/`errors.language.duplicate`) did.

## Auth

The cookie name is never a literal at call sites — it comes from `CONFIG.authCookie`
(`src/lib/config.ts`, value `"auth_token"`), defined in one place. `fetchGraphQL` reads that cookie
and forwards it as `Authorization: Bearer …` on every server-action call; a server action that has a
session and skips this is a defect, not a style choice.

`src/lib/auth-session.ts`'s `isAuthError(errors)` matches on `error.extensions.i18n.key` against
`error.auth.unauthenticated`/`error.auth.session_expired` — **not** on `error.message` text. Before
`018-ui-i18n` it string-matched the literal Spanish sentences `api` returned, which meant
translating those sentences would have silently broken session handling; the key is stable across
locales by construction, so this now works identically no matter which language is rendering.

Route gating is in `src/proxy.ts`: a cheap **presence check** on the cookie, redirecting
unauthenticated requests away from protected routes and authenticated ones away from `/login`
(`AUTH_ROUTES`/`PUBLIC_ROUTES` define the exceptions). The real enforcement point is `api`'s global
guard — `src/app/(dashboard)/layout.tsx` calls `getCurrentUser()` (the `me` query) server-side.
Since `033-billboard-and-navigation`, `PUBLIC_ROUTES` is `["/perceptor", "/terms", "/privacy"]` —
the original landing hero moved from `/` to `/perceptor`, out of every route group, so it stays
reachable without a session; `/` is now the billboard, inside `(dashboard)`, behind the same guard
as every other authenticated screen. An authenticated request to `/login` bounces to `/`.

### `redirectIfUnauthenticated` vs `redirectToClearSession` — not interchangeable

Both live in `src/lib/auth-session.ts` and both send an unauthenticated caller to `/login`. The
difference is **cookie mutation, which is legal only from a Server Action or a Route Handler**:

- `redirectIfUnauthenticated` deletes the stale cookie, then redirects. Use it from **form actions**.
- `redirectToClearSession` only calls `redirect()`. The deletion happens in
  `src/app/api/auth/clear-session/route.ts`, the Route Handler it redirects to (exempt from
  `proxy.ts`'s matcher, so it always runs). Use it from **any read function a Server Component
  `await`s during its render pass** — `getCurrentUser`, `getSettings`, `getMediaRoots`,
  `getMediaServerOptions`, `getMovieById`, `getShowById`, `getMovies`, `getShows`, `getLanguages`.

Getting this wrong is not a style bug. Cookie mutation *throws* during a render pass; and without the
real deletion, `proxy.ts`'s presence-only check bounces `/login` straight back to `/` on the
stale cookie — a loop, not a fix. **Pick based on where the call actually happens, not by copying the
nearest example**, and re-derive it if you move a fetch between server and client.

**`Promise.allSettled` needs `unstable_rethrow` on every rejection before you look at it.**
`(dashboard)/page.tsx` (`033-billboard-and-navigation`) fetches both billboard carousels with
`Promise.allSettled([getPopularMedia("movie"), getPopularMedia("show")])`, since one list's TMDB
outage must not blank the other. `redirectToClearSession` (above) throws Next's internal redirect
signal to work — and `allSettled` swallows *any* rejection into a settled `"rejected"` result,
redirect included, which would strand a stale session on a permanent "catalog unavailable" screen
instead of bouncing it to `/login`. Call `unstable_rethrow(result.reason)` (`next/navigation`) on
every rejected settlement first; only a rejection that survives that call is a real catalog
failure, safe to render as `initialError` in that carousel's strip.

## Admin user management

`src/actions/users.ts` (`getUsers`/`createUserAction`/`updateUserAction`/`deleteUserAction`/
`setUserEnabledAction` — all four mutating actions take direct typed arguments, not
`(prevState, formData)`), `src/app/(dashboard)/users/page.tsx`,
`src/components/users/UsersManager.tsx` (table, owns which of the two dialogs below is open and for
whom via `UsersDialogsContext`), `src/components/users/UsersDialogsContext.tsx`
(`UsersDialogsProvider`/`useUsersDialogs` — shares dialog state between the header button and the
table, which live in separate subtrees), `src/components/users/AddUserButton.tsx` (the header
trigger), `src/components/users/UserModal.tsx` (create/edit, modelled on
`src/components/profile/ProfileModal.tsx`), `src/components/users/DeleteUserDialog.tsx` (delete
confirmation), `src/types/users.ts` (`AdminUser`). The `isAdmin`-gated sidebar entry is wired through
`src/layout/AdminShell.tsx` → `AppSidebar.tsx`.

- `page.tsx` checks `getCurrentUser().isAdmin` and calls `notFound()` **before** calling `getUsers()`,
  **sequentially, never via `Promise.all`** — racing them turns `api`'s `AdminGuard` refusal into a
  500 instead of a clean 404. It wraps its output in `UsersDialogsProvider` and passes
  `<AddUserButton />` as `PageBreadcrumb`'s `children` — the header actions slot (§ Small
  conventions below has the shared-component detail), not a button stacked above the table.
- There is no standing create form. Row actions are icons with visible button chrome (background,
  `ring-1` border, hover state) and a visible text label beside the icon, not a bare color-only
  icon — `user-pen` edit, `user-x`/`user-check` disable/enable, `trash-2` delete in red — each also
  carrying a translated `title`/`aria-label`. The actions `<th>`/`<td>` carry `w-px whitespace-nowrap`
  so the table's auto column-sizing doesn't hand that column unclaimed width. The caller's own row
  renders **none** of the three: not disabled buttons, absent entirely. That is a usability
  affordance only; the real enforcement (self-disable, last-admin, session revocation) is
  server-side in `UsersService`.
- `UserModal` shows four fields (name, username, password, password confirmation) in create mode and
  **only name + username** in edit mode — an admin can never set another user's password from this
  screen; the recovery path for a locked-out user stays `bin/reset-password <username>`. Delete goes
  through `DeleteUserDialog`, never `window.confirm()`.
- `updateUserAction({ id, name, username })` sends exactly those three fields — never `password`,
  `isEnabled` or `isAdmin` — built field by field, not by spreading a form object. `updateUser`'s
  duplicate-username check (`api`'s `UsersService.update()`) now matches `create()`/`updateProfile()`,
  so renaming onto a taken username surfaces `error.user.username_taken`, not `error.user.not_found`.
  `setUserEnabledAction(id, isEnabled)` takes the boolean directly; there is no more
  `formData.get('isEnabled') === 'true'` string parsing to get wrong.
- `errors.user.*` has a full entry in both `en.json` and `es.json` — every `api` user-management
  error, including the pre-existing self-delete/last-admin ones, now translates instead of falling
  back to `api`'s English message in `es`.

## Media search

`SearchContainer.tsx` backs both `/movies/add` and `/shows/add`, parameterized by a `type: MediaType`
prop, with `searchAction`/`addAction` passed in by the page (`searchMedia`/`addMedia` from
`src/actions/media.ts`). `handleAdd` never calls `router.push` after a successful add — the user
stays on the search screen and that card changes, tracked in local `addedMediaIds` state until the
next search.

Each `MediaSearchResult` carries `mediaId` (the registered row's id, if *anyone* has registered it,
else `null`) and `inLibrary` (true only for the caller). **The action is owned by
`MediaResultAction.tsx` (`026-multi-search`), shared by `SearchContainer` and `MultiSearchResults`
so there is exactly one place that decides what a card's action looks like.** It treats a card as
owned when `inLibrary` is true or it was added this session — never when `mediaId !== null` alone,
since a title someone else registered is still addable by the caller (that add only links them, it
never re-downloads). The owned branch is now **one shape for both types**: an `Ir` link to
`/movies/<id>` for a film, `/shows/<id>` for a series — the old non-interactive `Agregada` badge for
an owned series is gone.

## Multi-catalog search (`/search`)

Since `026-multi-search`, the header's search box is a real entry point, not inert: submitting it
(`AppHeader.tsx`) pushes `/search?q=<encoded>` via `useRouter()`, even when the box is empty — the
page's empty state handles that case, so there is no special-cased "don't navigate" branch.
`app/(dashboard)/search/page.tsx` is a Server Component that awaits `searchParams` (a `Promise` in
Next 16), calls `searchAllMedia(query)` (`src/actions/media.ts`) in a `try`/`catch`, and passes a
translated error string down as a prop on failure rather than throwing — there is no
`app/(dashboard)/error.tsx`, so an uncaught throw here would show Next's default error screen instead
of a usable page. `MultiSearchResults.tsx` is the client component: it owns `addingId`/
`addedMediaIds` exactly as `SearchContainer` does, calls `addMedia(item.id, item.type)` per card (the
item's own type, not a screen-level one — this is what lets one page add a film and a series), and
renders the shared `MediaList`/`MediaCard` with the type badge turned on.

`MediaCard.tsx` renders a type badge (opaque pill, top-left over the poster; `bg-brand-500` for a
film, `bg-purple-500` for a series; text from the message catalog) only when asked for — the flag is
threaded through `MediaList.tsx` and **defaults off**, so `/movies`, `/shows`, `/movies/add` and
`/shows/add` are unaffected. The badge reads `item.type`, never the `mediaType` prop, since on a
mixed grid that prop is one value for cards of two kinds.

`MediaCard.tsx` also carries a `showMeta` prop since `033-billboard-and-navigation`, default `true`;
`false` hides the whole title/overview/year block. Nothing threads it through `MediaList.tsx` and no
existing call site passes it — only the billboard's carousel cards (poster, badge and action only, no
text) set it `false`.

## The billboard (`/`, `033-billboard-and-navigation`)

`/` is the app's home screen once signed in — `src/app/(dashboard)/page.tsx`, two carousels fetched
via `getPopularMedia(type)` (`src/actions/media.ts`, backing `popularMedia` — `redirectToClearSession`
since it runs during the page's render pass, per the auth section above). `src/components/media/
MediaCarousel.tsx` is a dependency-free, natively-scrolling strip (`overflow-x-auto` + CSS scroll-snap
+ the shared `no-scrollbar` utility) with two arrow buttons that page by whole cards, measured off the
first child, never hardcoded — **do not add a carousel library**; this component and the
`Promise.allSettled`/`unstable_rethrow` pairing above are the two things a future carousel screen
should reuse rather than reinvent. `src/components/billboard/PopularCarousel.tsx` is the client half
per strip: owns `addingId`/`addedMediaIds` exactly as `MultiSearchResults.tsx` does, computes `owned`
the same way (`inLibrary` or added this session, never `mediaId` alone), and renders `MediaCard
showMeta={false} showTypeBadge showLink={false}` per item with the shared `MediaResultAction`. A
failed list renders its translated `errors.media.catalog_unavailable` message in the strip's place
without affecting the other carousel.

`SearchInput.tsx`'s submit button is the shared `Button` (`src/components/ui/button/Button.tsx`,
`bg-brand-500`), not a hand-rolled element — a `bg-primary` class silently compiles to nothing, since
this service's Tailwind 4 `@theme` only defines `--color-brand-*`. Do not reintroduce a `primary`
token; reuse the shared component.

## Detail pages are scoped, with a route-segment 404

`/movies/[id]` and `/shows/[id]` are structural twins. `api` returns `null` both for a nonexistent id
and for a title the caller does not own, and **these pages cannot and must not tell the two apart**.

- Validate the route param (`parseMovieId`, positive integers only) **before** fetching, in both the
  page component and `generateMetadata` — a non-numeric id reaches the API as `NaN` and surfaces as
  an uncaught 500, since it isn't one of the auth-error strings `redirectToClearSession` checks for.
- `generateMetadata` returns a fixed `UNAVAILABLE_METADATA` (Spanish, no title-derived text) for both
  an invalid param and a `null` result, so the browser tab cannot leak a title's existence.
- The unavailable page is a **segment-scoped** `not-found.tsx` per route, rendering
  `Recurso no disponible para este usuario` as a real HTTP 404. Deliberately not an app-wide 404 —
  `/users`'s `notFound()` is untouched.

`/shows/[id]` renders `src/components/shows/Show.tsx` (`Movie.tsx`'s twin minus the acquisition
buttons — a series has none at that level), then one `SeasonAccordion.tsx` per season, the highest
`seasonNumber` expanded by default (computed once via `Math.max`, not per-season inside the loop).
Each episode row carries the same three buttons `Movie.tsx` uses (buscar / importar archivo / añadir
torrent).

Since `022-download-status-tags` both pages also render `src/components/downloads/DownloadsPanel.tsx`
(rows from `getMovieDownloads`/`getShowDownloads` in `src/actions/downloads.ts`, joined into each
page's existing `Promise.all`), with `src/components/downloads/DeleteDownloadModal.tsx` on the
existing `Modal`/`useModal` pair. A row's three buttons (start/stop/delete — no force-start, out of
scope) are gated on `infoHash != null`, never on `kind`: `SourceKind` has two torrent values and
`kind` is hand-retyped with no codegen, so a row for an uploaded `LOCAL_FILE` racing alongside the
show's torrents renders with no buttons at all rather than a wrong one. No polling — a refresh
control re-reads via `router.refresh()`.

## The `AcquisitionTarget` union

`SearchTorrentModal.tsx`, `SearchTorrent.tsx`, `importMagnetModal.tsx` and `importFileModal.tsx` all
take a single `target: AcquisitionTarget | null` prop:

```ts
export type AcquisitionTarget =
  | { kind: "movie"; movie: Movie }
  | { kind: "episode"; episode: Episode; showTitle: string; seasonNumber: number };
```

(`src/types/media.ts`.) This makes illegal states unrepresentable: the old `item`/`mediaType` pair
could disagree — an episode paired with `MEDIA_TYPE.MOVIE` — which is exactly how an episode id
reached a film mutation's `movieId` argument with no compile error. Each caller builds a `target`
locally (`Movie.tsx` for a film, `SeasonAccordion.tsx` for an episode, setting `activeEpisode`
**before** opening a modal — all three modals early-return `null` on a null target). Follow this for
any new acquisition entry point rather than reintroducing a bare id/type pair.

`Episode` is a single type, re-exported from `src/actions/shows.ts`. Import it from there, never
redeclare it.

## Torrent ranking heuristic (`036-torrent-ranking-heuristic`)

`src/lib/torrent-ranking.ts` exports one pure function,
`rankTorrentResults(results: TorrentResult[], requirement?: LanguageRequirement | null)
: RankedTorrentResult[]`, called from `SearchTorrent.tsx`'s "Best candidates" toggle. It never
persists anything and never crosses the GraphQL boundary — it re-ranks the exact list the search
button already fetched, client-side only. Three passes: veto (`av1`/`vp9`, boundary-anchored, **plus dead
swarms** — zero seeders and under five leechers, since nothing will ever finish downloading from
one), tier (keep only the highest surviving resolution tier — bare digits like `1080` match
alongside `1080p`/`1080i`, `10800` must not), then order.

**It is a lexicographic comparator, not a weighted score** — this is the one thing to understand
before touching it. Criteria are ranked, not weighted, and each is consulted only to break a tie in
the one above it: **resolución → grupo preferido → fuente (ajustada, ver abajo) → codec → rango
dinámico → audio → idioma de audio obligatorio → tamaño (desc) → seeders (desc) → leechers (asc)**.
Nothing lower can compensate for a loss higher up, so a UHD BluRay Remux can never be overtaken by a
WEB-DL on size or seeder count at any margin. The original 0–102 weighted sum was replaced precisely
because an additive model cannot express that — every weight is an exchange rate between criteria,
and for these criteria no exchange rate exists. Do not reintroduce a score, and do not "simplify" the
comparator chain into a sum.

**`spec_version` 0.5.0 — the mandatory audio language (`036`).** The second, optional argument is
the target title's audio requirement — `Movie.audioMandatory`/`audioLanguages` for a film, the
parent `Show`'s pair for an episode (an episode has no preference of its own). Absent, `mandatory:
false`, or an empty `languages` list is a complete no-op: the function returns exactly the 0.4.0
ordering. When armed, a release whose name advertises one of the required languages (matched by
`iso3`/`iso2` plus a hardcoded alias table — `esp`/`castellano`/`cast`/`latino`/`lat` for Spanish;
`MULTI`/`DUAL` are deliberately **not** in that table, since they assert "more than one language,
unspecified" rather than evidence of the specific one required) gets **+1 to its source rank,
capped at the ceiling of its own source family** — remux caps at `UHD BluRay Remux` (8), disc
non-remux at `UHD BluRay` (6), web at `WEB-DL` (4), unrecognised never promotes. The cap is not an
optimisation: an uncapped `+1` would let `WEB-DL` (4) reach `BluRay`'s rank (5), smuggling a web
source into disc territory — exactly the additive trade the lexicographic model exists to forbid. A
release already at its family's ceiling is unaffected by the promotion itself, which is what the new
low-priority comparator criterion (advertised-language-first, between audio and size) is for — it
settles the pairs the promotion could not. **That criterion is *not* skipped between two disc
sources**, unlike codec and audio: a disc source implies HEVC and a lossless track, but implies
nothing about which languages are on it, so the tag is real information for a remux too. The
`sourceLabel` shown in the UI is deliberately never adjusted — a promoted `BluRay Remux` still reads
`BluRay Remux`, with a separate `sourcePromoted` marker (rendered as a small arrow icon next to the
source chip in `SearchTorrent.tsx`) so it is never mistaken for a genuine `UHD BluRay Remux`. None of
this reads anything new from `api` — both fields were already fetched by `039-per-title-language-
split`'s `GetMovie`/`GetShow` queries; `AcquisitionTarget`'s episode branch (`src/types/media.ts`)
just needed the series' two fields threaded through `SeasonAccordion.tsx` alongside it.

Several placements are deliberate and easy to get backwards. **The preferred group ranks above
source** — it is a reputation signal standing in for what the release name cannot say, so a
preferred-group WEB-DL beats an unknown-group UHD BluRay Remux. **Resolution both filters and leads
the chain**: it can never actually differ among candidates, since the tier pass already removed the
rest, but it stays in the comparator so the function is correct for a caller that does not filter.
**`HDR` and `HDR10` rank equally** (HDR10 is the baseline every UHD source carries, so the short
spelling must not cost a place) while keeping distinct labels. And **codec and audio are skipped
between two disc sources** — a UHD BluRay is HEVC with the disc's lossless track whether the name
says so or not, so comparing on them would reward a verbose title over an identical terse one; both
still decide between two web sources. That skip cannot leak an AV1 rip: the veto runs in pass 1,
before any source is inspected.

**Match `remux` without a leading word boundary.** `BDRemux` is one token, and requiring `\bremux`
made every `UHD BDRemux` release parse as *unrecognised* — the worst source rank instead of the
best. That was a real bug found against live results, not a hypothetical.

Each candidate carries a `ranking` object with both the numeric rank and a human-readable label per
criterion; `SearchTorrent.tsx` renders the labels as badges under the title so a misparse is visible
against the release name on the same row (a real `DS4K` tag once read as 4K). Those labels are
format identifiers — `HEVC`, `HDR10`, `UHD BluRay Remux` — the same in every locale, and
deliberately not catalog keys; unrecognised reads render `—`. `PREFERRED_GROUPS` and
`STREAMING_SERVICES` are constants that grow as real release names appear — no entry in the latter
may be ambiguous with a non-service token (`ma` collides with DTS-HD MA, `max` with a title word).
Written to be reusable outside this modal — an eventual automatic picker (no user toggle) is meant
to call the same function.

## Language pickers: `LanguagePickerField`, three call sites

`src/actions/languages.ts` follows the standard server-action shape; `getLanguages` uses
`redirectToClearSession`. The four per-title actions
(`set{Movie,Show}PreferredTrackLanguagesAction`) and the two per-title `audioMandatory` actions
(`set{Movie,Show}AudioMandatoryAction`) use `redirectIfUnauthenticated` (see the auth section).
**`src/components/media/LanguagePicker.tsx` is gone as of `039-per-title-language-split`** — its
`<form>`-per-picker, own-submit-button shape stopped fitting once a single *Guardar* needed to fire
several mutations at once (`/preferences` first, `021-user-preferences`; a title's two language
lists plus its `audioMandatory` checkbox since `039`). `src/components/preferences/
LanguagePickerField.tsx` is its controlled replacement and now the **only** picker widget in the
codebase: same dual-pane visual (a scrolling left pane of toggle buttons, grouped by shared `iso2`
into a non-selectable heading with its variant rows beneath whenever more than one row shares it —
the grouping is derived from the `options` array, never a hard-coded list of which languages carry
variants — and a right pane showing the chosen set as removable `ui/badge/Badge.tsx` badges, one
state value backing both so a badge removal and an entry untick can never disagree), but it takes
`value`/`onChange` instead of owning a `<form>`, an action, or a save button of its own — the parent
component's single submit owns all of that. Entries are real `<button type="button" aria-pressed>`,
not `role="listbox"` (NFR-5 of `030-language-regional-variants`).
`src/components/form/MultiSelect.tsx`, the control `030` replaced in Settings, stays in the
repository unused — deleting it was explicitly out of scope then and still is.

**Three call sites, all Client Components, all the same "fire N mutations with one `Promise.all`,
revert only the field that failed" shape** (established by `PreferencesForm.tsx`,
`021-user-preferences`):
- `/preferences`'s `downloadLanguages` tab (`PreferencesForm.tsx`) — two `LanguagePickerField`s
  (audio, subtitle) plus, since `039`, a `Checkbox` for `UserPreferences.audioMandatory` inside the
  audio column, saved together with the rest of that screen's now-seven-entry `Promise.all`.
- `src/components/media/TitleLanguagesForm.tsx` (new in `039`) — the per-title twin: two
  `LanguagePickerField`s under one *Guardar*, plus the same `audioMandatory` `Checkbox` under the
  audio pane's badge list, submitting `set{Movie,Show}PreferredTrackLanguagesAction` (once per kind)
  and `set{Movie,Show}AudioMandatoryAction` together. `Movie.tsx` and `Show.tsx` each render one,
  bound to their own title id; `Show.tsx` stays a Server Component with `TitleLanguagesForm` as its
  client child, same as `LanguagePicker` was before it.

**The installation-wide `default_languages` setting is untouched on the `api` side but has no `web`
editor any more**: `021-user-preferences` REQ-6 deleted `DownloadPanel.tsx`, `SettingsForm`'s Descarga
tab, and `updateDefaultLanguagesAction`/`ALWAYS_SENT_STRING_KEYS` from `src/actions/settings.ts` — the
`default_languages` row in `settings` keeps whatever value it already held and keeps feeding
`getEncodeJobDetails`'s merge (`services/api/CLAUDE.md`'s `process-jobs/`), unsplit by kind even after
`039` split everything downstream of it. `SettingsForm` shows six tabs with no Descarga — a sixth,
*Programación* (`035-scheduled-tasks`), was added after this to hold the four scheduled tasks'
enable toggle and cron field, each saved through the same `updateSettings` as every other tab
(`schedule_<id>_enabled`/`schedule_<id>_cron` in `EDITABLE_KEYS`/`BOOLEAN_KEYS`), plus a
`useTransition` "Ejecutar ahora" per task calling `runScheduledTaskAction` outside the form.

**`Movie`/`Show`'s `audioLanguages`/`subtitleLanguages` replace the single `preferredLanguages`
field** `039-per-title-language-split` removed (not deprecated) — see
`docs/spec/graphql-contract.md` for the full contract delta.

**The Media Server tab's "Re-sync" control is the same kind of exception** (`034-jellyfin-library-reconciliation`),
by a different mechanism: `MediaServerFields.tsx`'s `MediaServerIndexPanel` is not a nested `<form>`
(still invalid HTML) but a plain `useTransition` + `@/components/ui/button/Button` click handler
calling `resyncMediaServerIndexAction()` directly — `Button` already defaults to `type="button"`, so
nothing here can accidentally submit `SettingsForm`'s main form the way a raw `<button>` would
(it defaults to `type="submit"`). `getMediaServerIndexStatus()`/`resyncMediaServerIndexAction()` live
in `src/actions/media-server.ts`, beside the existing `getMediaServerOptions()`. The syncedAt
timestamp is rendered only after mount (`useEffect`-gated) — `toLocaleString()` depends on the
runtime's timezone, and formatting it during SSR produces a hydration mismatch between the container
and the viewer's own timezone.

**The listing queries deliberately do not select `audioLanguages`/`subtitleLanguages`/
`audioMandatory`.** They are `api` field resolvers that only run when selected — `getMovieById`/
`getShowById` select them, `getMovies`/`getShows` must not, or 200 rows become hundreds of extra
queries.

## Two per-user settings screens (`021-user-preferences`)

`/settings` ("Ajustes") is installation-wide config, admin-only since `029-settings-screen-tabs`
(`notFound()` for a non-admin, both the sidebar and page level). `/preferences` ("Preferencias") is
per-user, and **deliberately carries no admin check anywhere** — it renders in full for every
signed-in user, admin or not, because everything on it is scoped to the caller by the `api` resolver
(`Query.preferences`/`Mutation.set*` never take a user id). `src/app/(dashboard)/preferences/page.tsx`
is a Server Component fetching `Promise.all([getCurrentUser(), getPreferences(), getLanguages(),
getTorrentGroups()])` and rendering `PreferencesForm.tsx` — **one tabbed Client Component, one shared
*Guardar*, not the one-card-per-section layout this section used to describe.** Four tabs (`general`,
`downloadLanguages`, `movies`, `shows`), all mounted at once and switched with `hidden` (never
unmounted, so tab-switching never resets unsaved edits); pressing *Guardar* fires every field's
mutation together via one `Promise.all`, reverting only the field whose result carried an error —
seven mutations as of `039-per-title-language-split` (`setUiLocale`, `setPreferredTrackLanguages`
×2, `setAllowCinemaReleases`, `setAudioMandatory`, `setPreferredTorrentGroups` ×2). The `movies` tab
decides between its empty state and `TorrentGroupPickerField` (a sibling of `LanguagePickerField`,
not a generalization of it — bound to one `TorrentGroupScope` at a time) on `options.length === 0`,
**before** the picker is ever referenced in the render tree: an empty catalog must never reach a form
that could submit an empty "clear my selection" write by accident.
Both nav entries — sidebar (`AppSidebar.tsx`'s `baseNavItems`, the array every signed-in user gets,
not the `isAdmin` spread beneath it) and the header (`UserDropdown.tsx`, beside the pre-existing
*Ajustes* item) — show *Preferencias* unconditionally and *Ajustes* only where each surface already
gated it. The header menu's *Ajustes* item was never admin-gated before this feature and still isn't
— a pre-existing inconsistency with the sidebar's admin-gated copy, deliberately left alone.

## Library listings: two parallel screens, not one parameterized one

`/movies` and `/shows` are deliberately **separate** implementations (`getMovies()` +
`components/movies/Movies.tsx`, `getShows()` + `components/shows/Shows.tsx`). This is the opposite of
`SearchContainer` above and is not an oversight: `api` exposes `movies` and `shows` as two sibling
queries with two independent types. Do not merge them; the duplication is cheaper than the parameter.

What *is* shared is the rendering: both pass rows to `src/components/media/MediaList.tsx`, which takes
a `mediaType` prop and already produces the right Spanish empty state for each. Never pass a custom
`emptyMessage`, never fork `MediaList`/`MediaCard`.

**Both list components are Server Components, not client fetches** — `async function` components that
`await` their action during render, no `"use client"`, no `useEffect`. An earlier client-fetching
version served the empty state first and repainted after hydration on every navigation. Consequences:
they call `redirectToClearSession` (see the auth section), and a non-auth error is logged with
`console.error` and swallowed to `[]` rather than thrown — there is no `app/(dashboard)/error.tsx`, so
an uncaught throw would surface Next's default error screen instead of the shared empty state.

**`MediaCard` resolves its detail `href` from the `mediaType` prop, not a payload field.** Neither
`Movie` nor `Show` has ever carried a `type` field; do not add one to solve a routing decision that is
already solved, and do not resolve `href` off `item.type`.

## UI origin: TailAdmin template

`src/layout/`, `src/components/common|form|ui`, and `src/context/` come from the TailAdmin Next.js
template this project was bootstrapped from. A component under those directories that looks unused is
probably template scaffolding, not dead code from this project — check before deleting.

**`src/components/header/UserDropdown.tsx` is no longer template scaffolding** (`019-user-menu`).
Its icons come from `lucide-react` (`UserPen`/`Settings`/`LogOut`, plus `Moon`/`Sun` since
`025-header-redesign`), not inline `<svg>` — do not reintroduce hand-copied SVG path data here.
The trigger button's `.dropdown-toggle` class is load-bearing: `Dropdown.tsx:25`'s outside-click
handler special-cases it so a click on the trigger doesn't immediately re-close the panel it just
opened — losing that class makes the menu appear to never open, with no error anywhere.

**`020-profile-edit`**: *Editar perfil* is now `onItemClick`-wired to open `ProfileModal`
(`src/components/profile/ProfileModal.tsx`), still with no `href` — there is no `/profile` route
and none is planned. `src/actions/profile.ts`'s `updateProfileAction` follows the standard
server-action shape, with one deliberate addition: the two REQ-4 password-pair messages come from
`useTranslations`/`getTranslations("errors")` rather than being hardcoded, since `018-ui-i18n` had
already migrated this component's siblings by the time this feature landed — `translateGraphQLError`
handles every error `api` returns, exactly like `createUserAction`.

**The header (`src/layout/AppHeader.tsx`) is three elements at every breakpoint** since
`025-header-redesign`: sidebar toggle, search form, avatar — no theme button, no notification
bell, no quick-add icons, no mobile logo, no application-menu row. The theme toggle now lives
inside `UserDropdown`'s dropdown, as a fourth `DropdownItem` wired to the same
`useTheme()`/`ThemeContext`; `ThemeToggleButton` and `NotificationDropdown` were deleted as their
last references went with it. `ThemeTogglerTwo` is untouched — the auth layout still renders it on
the login screen, so don't delete it while cleaning up header remnants. Since `026-multi-search`
the search input navigates to `/search?q=…` on submit (see § Multi-catalog search above) — it is no
longer inert.

## Tests: there are none

No test file, no runner, no `test` script. This is the largest maturity gap of the three services.
The quality gate is the typecheck, Biome on the file you touched, and actually opening the page.

Do **not** add Vitest or Playwright as a side effect of a feature task — introducing a test toolchain
here is its own decision and deserves its own spec. `scripts/check-messages.mjs` (`018-ui-i18n`) is
a plain Node script, not an exception to this rule — it has no framework, no assertions, just a
parity check with an exit code.

## Small conventions that are easy to get wrong

- **`PageBreadCrumb.tsx` has no breadcrumb link anymore.** Since `028-users-screen-refactor`'s
  post-implementation amendments, its `<nav>` ("Home" link) was replaced by an optional `children`
  slot next to the page title, for page-specific action buttons — `/users` is the only current
  consumer (`AddUserButton`). Every other page passing `pageTitle` alone now renders an empty slot
  there; that's expected, not a regression, until that page opts into its own actions.
- **Controlled inputs use a raw `<input>`**, not `@/components/form/input/InputField`. That shared
  component's `InputProps` accepts `defaultValue` and *not* `value`; every controlled input
  (`PathPicker`, the import modals) uses a raw element with InputField's Tailwind classes copied in.
  Follow that rather than widening the shared component.
- **`id` is a `string`** in this service's types even where the GraphQL argument is `Int!`. Wrap with
  `Number(...)` at the call site, as `SearchTorrent.tsx` and `importMagnetModal.tsx` do.
- **Errors render inline**, never through `alert()` or `window.confirm()`. The import modals are the
  reference.
- **`text-sm` and `text-theme-sm` are banned.** Since `025-header-redesign`, `body` declares an
  explicit `text-base` (16px) as the site's base size, and both classes were swept out of
  `services/web/src`. The `--text-theme-sm` / `--text-theme-sm--line-height` tokens stay defined in
  `globals.css`'s `@theme` block — `text-theme-xs` and `text-theme-xl` still resolve against that
  scale — only their *use* is gone. Do not reintroduce either class, and do not compensate for a
  page that now reads larger with a one-off `text-[14px]`: that drift is accepted, and each screen
  gets re-tuned as the broader visual pass reaches it.
- **`next build` must run under `NODE_ENV=production`** — `package.json`'s `build` script sets it
  explicitly, because the dev container passes `NODE_ENV=development` in. Building under
  `development` resolves React's development export conditions and produces a mismatched React
  instance, failing prerender with `Cannot read properties of null (reading 'useState')` on every
  client component. Do not "fix" that class of error by opting a page out of prerendering or
  suppressing the compiler.
- **`useSearchParams()` needs a `<Suspense>` boundary** to prerender (`/login` wraps `<LoginForm />`
  that way). Next's documented pattern, not a workaround.

## Current state

As of 2026-09-02 (`021-user-preferences`): `bin/cli web npx --no tsc --noEmit` reports
**0 errors** and `bin/npm web run build` exits 0. Re-run both rather than trusting this — report the
numbers before and after a change to prove you added nothing.

`bin/npm web run lint` is **not** a usable gate: `biome check` reports ~1519 errors and ~65 warnings
across the pre-existing template, with or without any given change. Judge a new file by running Biome
on that file, never on the repo.
