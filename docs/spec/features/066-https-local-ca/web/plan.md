---
title: HTTPS Through Traefik With a Local Certificate Authority — web slice
service: web
last_updated: 2026-09-19
status: Approved
---

# PLAN: HTTPS Through Traefik With a Local Certificate Authority — `web` (`web/plan.md`)

## Scope

`web` hands the browser an upload endpoint whose scheme matches the page's (REQ-9), and the
Environment tab shows the HTTPS state, lists `USE_HTTPS`, and compares the upload endpoint ignoring
its scheme (REQ-9b, REQ-10).

**Not yours:** `USE_HTTPS` itself — `web` never reads it and `infra` does not pass it to this
container (`../plan.md` § Contract Freeze). Certificates, Traefik, CORS and `environmentInfo`'s
values all belong to `infra`/`api`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/lib/request-scheme.ts` | New | `isSecureRequest()` (moved verbatim from `auth.ts`) + `withRequestScheme(url)` |
| `services/web/src/actions/auth.ts` | Modified | Imports `isSecureRequest` from the new lib; local copy and its docblock removed |
| `services/web/src/actions/uploads.ts` | Modified | `endpoint` = `PUBLIC_UPLOAD_URL` with the request's scheme |
| `services/web/src/types/environment.ts` | Modified | `useHttps: boolean` |
| `services/web/src/actions/environment.ts` | Modified | Query selects `useHttps`; fallback object gets `useHttps: false` |
| `services/web/src/components/settings/EnvironmentPanel.tsx` | Modified | HTTPS row, `USE_HTTPS` in the list, scheme-agnostic comparison |
| `services/web/messages/en.json`, `es.json` | Modified | `settings.environment.httpsLabel`, `httpsEnabled`, `httpsDisabled` |

## Existing code to reuse

- **`isSecureRequest()` in `services/web/src/actions/auth.ts`** — already decides the request's
  scheme from `Origin`, falling back to `x-forwarded-proto`, and the login cookie depends on it.
  Move it; do not write a second detector. It cannot just be `export`ed where it is: every export of
  a `"use server"` file becomes a callable Server Action endpoint. The new lib file is plain
  server-only code (no `"use server"`), like `src/lib/auth-session.ts`. Its existing docblock
  explains a subtle production bug; keep the explanation in the commit message rather than the file
  (Article XI), or keep it only if you judge it a security-guard doc comment — it guards the
  `Secure` cookie, which qualifies.
- **`createUploadTicketAction`** — keeps its `endpointNotConfigured` error path unchanged; only the
  returned `endpoint` changes.
- **`EnvironmentPanel`'s routing-mode row** (`Label` + `Badge`) — the HTTPS row copies it exactly.
- **The existing "how to change" `<ul>`** — `USE_HTTPS` is one more `<li>`, after `DOMAIN`.
- **`scripts/check-messages.mjs`** — the gate that `en`/`es` did not drift.

## Steps

1. Create `src/lib/request-scheme.ts`: move `isSecureRequest()` unchanged; add
   `withRequestScheme(url: string): Promise<string>` that replaces only the leading `http:`/`https:`
   of `url` with the request's scheme and leaves host, port, path and query byte-for-byte. A value
   that does not start with `http://` or `https://` is returned unchanged (never throw — a bad
   `PUBLIC_UPLOAD_URL` must keep failing the way it fails today, in the browser).
2. `auth.ts`: import `isSecureRequest` from `@/lib/request-scheme`; delete the local function.
3. `uploads.ts`: `endpoint: await withRequestScheme(endpoint)` after the existing not-configured
   check.
4. `types/environment.ts` + `actions/environment.ts`: add `useHttps` to the type, the query and the
   fallback (`false`).
5. `EnvironmentPanel.tsx`:
   - HTTPS row right after the routing-mode row: `Badge` `success` + `httpsEnabled` when `useHttps`,
     `light` + `httpsDisabled` otherwise.
   - `uploadConsistent`: compare `expectedUploadEndpoint` and `uploadEndpoint` with the leading
     `http://`/`https://` stripped from both, everything else exact (REQ-9b — no trailing-slash or
     case normalization). A small local function in the component; this file is `"use client"`, so
     it must not import `request-scheme.ts` (it uses `next/headers`).
   - `<li>USE_HTTPS</li>` after `<li>DOMAIN</li>`.
6. `messages/en.json` / `es.json` under `settings.environment`:
   `httpsLabel` "HTTPS" / "HTTPS"; `httpsEnabled` "Enabled (local certificate authority)" /
   "Activado (autoridad certificante local)"; `httpsDisabled` "Disabled" / "Desactivado".

## Contract obligations

Consumes `EnvironmentInfo.useHttps: Boolean!` from `../spec.md` § GraphQL Contract Delta — retyped by
hand in `types/environment.ts`, selected in the query. `endpoints[].url` and
`expectedUploadEndpoint` may now start with `https://`; render them as given. Error handling for
`environmentInfo` is unchanged (`redirectToClearSession` + translated throw, as today). Do not infer
HTTPS from anything else — not from `url` prefixes, not from an env var.

## Tests

`web` has no test runner (`services/web/CLAUDE.md`). The silent failure in this slice is the
upload scheme swap choosing the wrong side (an HTTP page given `https://` fails only on devices
without the CA; an HTTPS page given `http://` fails as mixed content) — covered by AC-4/AC-4b in the
manual pass, run against a live stack.

## Done when

```bash
bin/cli web npx --no tsc --noEmit              # 0 errors
bin/npm web run build                          # exits 0
bin/cli web node scripts/check-messages.mjs    # no en/es drift
```

plus AC-4, AC-4b and AC-9 from `../spec.md`, run live.
