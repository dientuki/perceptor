---
title: Environment Panel — web slice
service: web
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Environment Panel — `web` (`web/plan.md`)

## Scope

Add the read-only **Environment** tab to `/settings`: last in the tab list, `Container` icon, showing
how the installation is reachable, whether the upload endpoint is consistent with the routing mode, and
what to edit plus what to recreate for a new value. This slice also supplies the two values the query
deliberately does not carry — `PUBLIC_UPLOAD_URL` and `web`'s own `DOMAIN`, both read server-side — and
owns every string a user reads here.

Explicitly **not** this slice: the `environmentInfo` query (`api`), the compose passthrough (`infra`),
and any ability to edit, save or apply any of these values. Nothing on this tab is writable — see REQ-10
and `../spec.md` § Out of Scope.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/environment.ts` | New | `EnvironmentInfo`/`EnvironmentEndpoint`, hand-mirroring the query |
| `src/actions/environment.ts` | New | `getEnvironmentInfo()` — standard read-action shape |
| `src/components/settings/EnvironmentPanel.tsx` | New | The panel; one renderable component in the file |
| `src/app/(dashboard)/settings/page.tsx` | Modified | Fetch env info; read `PUBLIC_UPLOAD_URL`/`DOMAIN`; pass down |
| `src/components/settings/SettingsForm.tsx` | Modified | Seventh tab; panel rendered outside the `<form>` |
| `messages/en.json`, `messages/es.json` | Modified | `settings.tabs.environment` + a `settings.environment` namespace |

## Existing code to reuse

- **`src/actions/media-roots.ts`** — copy `getEnvironmentInfo` from it almost verbatim. Same situation:
  an admin-only read consumed by `SettingsPage`'s render pass, so it uses **`redirectToClearSession`**
  (never `redirectIfUnauthenticated` — cookie mutation throws during a render pass) followed by
  `throw new Error(await translateGraphQLError(errors[0]))`.
- **`src/components/settings/SettingsForm.tsx`** — the `TABS` const, `TabNavItem[]` with a
  `lucide-react` icon per tab, `tTabs`/`useTranslations("settings.tabs")`, and `panelClass()`. The new
  tab key is `environment`, appended **last** to `TABS` and to `tabItems`; the icon is `Container` from
  `lucide-react` (added to the existing icon import, which already pulls `Cast`/`Clock`/`Cloud`/
  `FileVideoCamera`/`Globe`/`Library`).
- **`src/components/settings/GeneralPanel.tsx`** — the smallest panel, for the file shape: `"use
  client"`, a props interface, `useTranslations("settings.<panel>")`, a `space-y-6` root.
  `EnvironmentPanel` follows it minus every form control.
- **`src/components/ui/badge/Badge.tsx`** and the status-pill habit in
  `src/components/status/StatusBadge.tsx` — for rendering the consistent / inconsistent verdict and the
  routing mode as a pill rather than bare text. Reuse; do not hand-roll a new badge.
- **`src/lib/graphql-error.ts`'s `translateGraphQLError`** — the action's error path, as every read
  action already does.
- **`src/app/(dashboard)/settings/page.tsx`** — already checks `isAdmin` and calls `notFound()`
  **before** its `Promise.all`, sequentially and deliberately. Add `getEnvironmentInfo()` to the
  existing `Promise.all`; do not touch the sequential admin check above it.

## Steps

1. `src/types/environment.ts`: mirror the query by hand, nullability included — `port: number | null`,
   `url: string | null`, `domain: string | null`, `expectedUploadEndpoint: string | null`. There is no
   codegen; a field typed non-null here that arrives `null` is a runtime crash with no compile error.
2. `src/actions/environment.ts`: `getEnvironmentInfo()` on the `getMediaRoots` pattern, selecting every
   field of the delta.
3. `src/app/(dashboard)/settings/page.tsx`: add `getEnvironmentInfo()` to the existing `Promise.all`,
   and read the two `web`-only values **directly in this Server Component** —
   `process.env.PUBLIC_UPLOAD_URL ?? null` and `process.env.DOMAIN ?? null` — passing all three to
   `SettingsForm`. No new server action for these: the component is already on the server and there is
   no GraphQL round trip to make.
4. `src/components/settings/EnvironmentPanel.tsx`, read-only, taking the query payload plus
   `uploadEndpoint: string | null` and `webDomain: string | null`. It renders:
   - **Routing mode** (REQ-2) and the **domain** (REQ-3) — when `useTraefik` is false, the domain is
     shown *marked as not in effect*, not hidden.
   - **The four endpoints** (REQ-4) in the order `api` returned them, each with its port and, when
     present, its URL. A `null` url renders as an em dash or an explicit "not derivable" string — never
     a link, never a fabricated `localhost` URL (NFR-1; `web` must not re-introduce the fallback `api`
     was forbidden from adding).
   - **The upload endpoint** (REQ-5) as its own row, visually distinct from the derived four, with the
     verdict (REQ-6): when `useTraefik` and `expectedUploadEndpoint !== null`, compare it to
     `uploadEndpoint` and render consistent / inconsistent, showing the expected value when they differ.
     Compare the strings as given — no trailing-slash or case normalization (`../plan.md` § Risks,
     row 2). When `expectedUploadEndpoint` is `null` (port mode) there is no verdict to render, only the
     guidance of REQ-9.
   - **The api/web domain disagreement** (REQ-7): when both `domain` (from `api`) and `webDomain` are
     non-null and differ, say so and name `docker compose up -d --force-recreate api web`.
   - **How to change** (REQ-8): which `.env` variables to edit — `USE_TRAEFIK`, `DOMAIN`,
     `COMPOSE_PROFILES`, `PUBLIC_UPLOAD_URL` — and that the edit takes effect only after recreating the
     containers, with the command.
   - **Host guidance, port mode only** (REQ-9): rendered **only** when `useTraefik` is false. It says the
     upload endpoint must carry an address the browser itself can reach — the host's LAN address, not
     `localhost`, since the browser may be another machine — and that no container can determine it, so
     it is set by hand.
   - **Unset endpoint** (REQ-11): `uploadEndpoint === null` renders a "not configured" string. The
     literal `undefined` must never reach the DOM.
5. `SettingsForm.tsx` — the structural part, and the one place this slice can cause a regression:
   render `<EnvironmentPanel>` as a **sibling of the `<form>`, not a child**, shown when
   `activeTab === "environment"`, and give the `<form>` itself `className={activeTab === "environment" ?
   "hidden" : ""}`. **Hide the form; never conditionally render it.** Its six panels are mounted at once
   on purpose — `FormData` reads the DOM, so unmounting the form would destroy every unsaved edit on the
   other tabs with no error anywhere (the file's own comment warns about this for panels; this extends
   it to the form). Hiding also removes the *Guardar* button from a read-only tab, which is REQ-10's
   other half, since that button is the form's last child.
6. Catalog: `settings.tabs.environment` (`en`: `Environment`, `es`: `Entorno`) plus a
   `settings.environment` namespace for every string above, in **both** `en.json` and `es.json`. `es`
   keeps the Rioplatense register the rest of the catalog uses. Service display names are keyed off the
   endpoint `id` here — `api` sends no label, by contract.

## Contract obligations

`web` consumes `environmentInfo` exactly as frozen in `../spec.md` § GraphQL Contract Delta —
read-only. What that means for this slice:

- **Every nullable field is genuinely nullable** and each `null` has a specified rendering (above).
  `endpoints[].url === null` and `expectedUploadEndpoint === null` are the *normal* state in port mode,
  not an error and not a loading state.
- **`endpoints` order is the contract's** (`web`, `api`, `torrent`, `indexer`). Render as given; do not
  sort.
- **No label arrives from `api`** — mapping `id` to a display name is this service's job (`018-ui-i18n`).
- **`PUBLIC_UPLOAD_URL` is never requested from `api`.** It is this container's own value; that is the
  entire point of comparing it against `expectedUploadEndpoint`.

Error conditions: the single one is `error.auth.admin_required` (non-admin or service principal), which
`translateGraphQLError` resolves through the existing `errors.auth.admin_required` catalog entry — no
new key. In practice the page's own `isAdmin`/`notFound()` gate means the UI never reaches it; handle it
anyway in the action, exactly as `getMediaRoots` does, because an action that only knows the happy path
is not implementing the contract.

## Tests

**None, and the reason is structural, not an omission**: this service has no test file, no runner and no
`test` script, and adding Vitest or Playwright as a side effect of a feature task is explicitly
forbidden (`services/web/CLAUDE.md` § Tests: there are none — it is its own decision, deserving its own
spec). The quality gate here is the typecheck, Biome on the files touched, the catalog parity script,
and the manual pass in `../plan.md` § Verification, which is where AC-1 through AC-5, AC-7 and the
form-hiding check are actually proven.

Two things in this slice would otherwise be owed a test under Article IX, so verify them by hand
deliberately rather than incidentally: the comparison must report **inconsistent** for the AC-2 fixture
(a verdict that is always "consistent" reproduces the original invisible bug with a checkmark on it),
and switching to the Environment tab and back must preserve an unsaved edit on another tab.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 typecheck errors, `build` exits 0, and the catalog script exits 0 (no `en`/`es` drift for the new
keys). Run Biome on the files this slice touched — **never** on the repo, which reports ~1519
pre-existing errors with or without any change:

```bash
bin/cli web npx --no biome check src/components/settings/EnvironmentPanel.tsx src/actions/environment.ts src/types/environment.ts
```
