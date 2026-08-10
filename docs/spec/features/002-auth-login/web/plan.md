---
title: Login and the Authentication Boundary — web slice
service: web
last_updated: 2026-08-10
status: Approved
---

# PLAN: Login and the Authentication Boundary — `web` (`web/plan.md`)

## Scope

`web` becomes a genuine consumer of the auth boundary: it must forward its session token on every
server-action call to `api`, treat an auth failure as "go sign in" rather than an error page, make
"keep me logged in" and sign-out actually work, and mint+send upload tickets. Does not touch
`services/api` or `services/worker`.

Writes confined to `services/web/`.

## Files

| File | New/Mod | What changes |
| :-- | :-- | :-- |
| `src/lib/config.ts` | Mod | Rename `authTtoken` → `authCookie`; value stays `"auth_token"` (no cookie migration needed — only the API's signature check changes under NFR-4) |
| `src/lib/graphql-client.ts` | Mod | Read `cookies()` inside `fetchGraphQL`, forward `Authorization: Bearer <token>` when present; move `...options` ahead of `method`/`headers`/`body` (currently spread last, silently overriding them — no caller hits this today, but it's a live bug); delete both `console.log` calls (REQ-7 — one logs the full request body, including plaintext login passwords); guard against a non-JSON error response so `res.json()` doesn't throw a raw `SyntaxError` |
| `src/lib/auth-session.ts` | New | `redirectIfUnauthenticated(errors)` — matches `No autenticado` / `Tu sesión expiró...`, deletes the cookie, calls `redirect('/signin')`. Called immediately after each `await fetchGraphQL(...)`, never inside a `try` (Next's `redirect()` works by throwing, and `loginAction`'s existing `try/catch` would swallow it as a generic connection error) |
| `src/actions/auth.ts` | Mod | `loginAction` reads `formData.get('rememberMe') === 'on'`, sends it in `LoginInput`, sets cookie `maxAge` to 30 days when checked / omits both `maxAge` and `expires` when not (session cookie); new `logoutAction` (calls `logout` mutation best-effort, deletes cookie, redirects to `/signin`); new `getCurrentUser()` wrapping the `me` query |
| `src/actions/uploads.ts` | New | `createUploadTicketAction(movieId: number)` wrapping `createUploadTicket` |
| `src/actions/movies.ts` | Mod | `redirectIfUnauthenticated(errors)` after each of its 4 `fetchGraphQL` calls |
| `src/actions/settings.ts` | Mod | Same, 2 call sites |
| `src/actions/indexer.ts` | Mod | Same, 2 call sites |
| `src/actions/imports.ts` | Mod | Same, 1 call site |
| `src/actions/media-roots.ts` | Mod | Same, 1 call site |
| `src/actions/media-server.ts` | Mod | Same, 1 call site |
| `src/proxy.ts` | Mod | `CONFIG.authTtoken` → `CONFIG.authCookie` |
| `src/components/form/input/Checkbox.tsx` | Mod | Add optional `name?: string` prop, forwarded to the underlying `<input>` |
| `src/components/auth/SignInForm.tsx` | Mod | `<Checkbox name="rememberMe" .../>`; delete the two stray `console.log`s |
| `src/app/(dashboard)/layout.tsx` | Mod | Becomes a server component: `const user = await getCurrentUser(); return <AdminShell user={user}>{children}</AdminShell>` |
| `src/layout/AdminShell.tsx` | New | `"use client"` — the current body of the dashboard layout (sidebar/header/backdrop wiring), now taking `user` as a prop |
| `src/layout/AppHeader.tsx` | Mod | Accept and forward `user` to `UserDropdown` |
| `src/components/header/UserDropdown.tsx` | Mod | Accept `user`, render real `name`/`username` instead of the hardcoded placeholder; sign-out becomes `<form action={logoutAction}><button type="submit">...</button></form>` instead of a dead `<Link>` |
| `src/components/import/importFileModal.tsx` | Mod | `handleFileChange` becomes async: mint a ticket via `createUploadTicketAction` first, then construct `tus.Upload` with `headers: { Authorization: 'Bearer ' + ticket.token }`. Mint failure sets an inline error, upload never starts |
| `CLAUDE.md` | Mod | The "Auth" section currently instructs future readers that the `authTtoken` typo is "load-bearing, keep it consistent" — rewrite it to describe `CONFIG.authCookie` and the real cookie/bearer flow. This is a blocker for this slice, not follow-up cleanup: an agent reading its own service doc would otherwise have written instruction to refuse REQ-2 |

## Existing code to reuse

- `src/lib/graphql-client.ts`'s existing shape — extend the one function, do not add a second
  `gql()` wrapper. Every action already checks `errors[0].message`, per `services/web/CLAUDE.md`.
- `src/actions/auth.ts`'s existing cookie-write code in `loginAction` — extend for conditional
  `maxAge`, don't rewrite.
- The tus pause/resume mechanics already in `importFileModal.tsx` — `abort()` without `true` keeps
  `upload.url`; `start()` resumes via HEAD+PATCH with no second POST. This is why a 60-second
  ticket surviving only the initial POST is sufficient for AC-13.

## Steps

1. `src/lib/config.ts`: rename `authTtoken` → `authCookie`.
2. `src/lib/graphql-client.ts`: `Authorization` forwarding from `cookies()`, the `...options`
   ordering bug, delete the two `console.log`s, guard the non-JSON error path.
3. `src/lib/auth-session.ts`: `redirectIfUnauthenticated`.
4. Insert `redirectIfUnauthenticated` after each of the 11 `fetchGraphQL` call sites across
   `src/actions/movies.ts` (4), `settings.ts` (2), `indexer.ts` (2), `imports.ts` (1),
   `media-roots.ts` (1), `media-server.ts` (1).
5. `rememberMe` end to end: `Checkbox.tsx` gets `name`, `SignInForm.tsx` renders
   `<Checkbox name="rememberMe">`, `loginAction` reads the form value and sets conditional
   `maxAge`.
6. `logoutAction` in `src/actions/auth.ts`; wire it into `UserDropdown.tsx`'s sign-out button.
7. Dashboard layout restructure: `AdminShell.tsx` (new, takes the current layout body plus `user`
   prop), `(dashboard)/layout.tsx` becomes a server component calling `getCurrentUser()`,
   `AppHeader.tsx` and `UserDropdown.tsx` forward/render `user`.
8. Upload ticket flow in `importFileModal.tsx`: `createUploadTicketAction` before `tus.Upload`,
   bearer header on the upload, inline error on mint failure. New `src/actions/uploads.ts`.
9. `CLAUDE.md`: rewrite the Auth section.

## Contract obligations

This service is a consumer. It must send `LoginInput.rememberMe` (additive, defaulted — but REQ-8
is not observable until `web` actually sends it). It must handle the `me: User!` shape (`id`,
`name`, `username`). It must handle `createUploadTicket(movieId: Int!): UploadTicket!` (`token`,
`expiresAt`). It must treat every operation except `login` as requiring a forwarded credential, and
must handle all five error messages in the spec's error table:

| Condition | Message | Handling |
| :-- | :-- | :-- |
| No credential presented | `No autenticado` | `redirectIfUnauthenticated` |
| Token expired or badly signed | `Tu sesión expiró, iniciá sesión de nuevo` | `redirectIfUnauthenticated` |
| Wrong username or password | `Credenciales inválidas` | Renders inline in `SignInForm` via `state.error`, exactly as it does today |
| Upload ticket missing, expired or already used | `El permiso de subida venció, volvé a intentar` | Renders inline in the upload modal |
| Upload ticket does not match the movie being uploaded | `El permiso de subida no corresponde a esta película` | Renders inline in the upload modal |

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

`services/web` has no test runner configured, by design (per `services/web/CLAUDE.md` / the root
`CLAUDE.md` pipeline table). No tests are owed in this slice — this is not a gap, it's the existing
convention.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
```

Expected: no more than the pre-existing 12 errors across the 5 unrelated pre-GraphQL files
(`importFolderModal.tsx`, `ImportMagnetSeasonModal.tsx`, `SearchTorrentModal.tsx`,
`SearchForm.tsx`, `ResultsForm.tsx`) — none of this slice's new/modified files may introduce a new
error.

Then manual: AC-3, AC-4 (fresh browser profile, both checkbox states, inspect cookie expiry in
devtools), AC-5, AC-6, AC-7 (`docker compose logs web` has no password/token), AC-13 (upload with
pause/resume, network tab shows no second POST on resume).
