---
title: Dependency Update Cadence — web slice
service: web
last_updated: 2026-10-03
status: Implemented
---

# PLAN: Dependency Update Cadence — `web` (`web/plan.md`)

## Scope

One version, on one line: `next` from `16.2.12` to `16.3.8` in `services/web/package.json`, plus the
lockfile that follows. That single move clears all four of `web`'s production advisories — `next`'s
own three RCEs, `postcss` (to the fixed `8.5.23`, which `next@16.3.8` pins directly) and `sharp`
(past the libvips and libheif CVEs) — taking the service's production audit to `found 0
vulnerabilities` (`REQ-5`).

It is explicitly **not** doing: the allowlist, the gate script, `bin/audit`,
`.github/dependabot.yml` or anything under `.github/` (all `infra`), and not `api`'s lockfile. It
adds no component, no route, no server action, no translated string — `services/web/messages/{en,es}.json`
stays at 600 keys, and `next-intl`, `tailwindcss`, `lucide-react`, `@fullcalendar/*`,
`tus-js-client` and `@biomejs/biome` are all left exactly where they are.

Writes are confined to `services/web/`. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/package.json` | Modified | **One line**: `"next": "16.2.12"` → `"next": "16.3.8"` |
| `services/web/package-lock.json` | Modified | `next` and its subtree; `postcss` under `node_modules/next` to `8.5.23`, `sharp` to `0.35.5`+ with all `@img/*` variants |

Nothing under `src/` is expected in the diff. If a source file has to change to make the bump
compile, that is a finding worth reporting, not a quiet fix — it would mean the minor carried a
breaking change for this codebase.

## Existing code to reuse

No new code, so nothing to reuse in the usual sense. Four existing facts constrain how the bump is
done and verified:

- `services/web/package.json` pins `next`, `react`, `react-dom`, `@biomejs/biome` and
  `babel-plugin-react-compiler` **exactly**, with no caret, while everything else uses `^`. Keep
  that style: `"16.3.8"`, not `"^16.3.8"`.
- `services/web/next.config.ts` — `reactCompiler: true`, `output: "standalone"`, and
  `images.remotePatterns` opening `https://image.tmdb.org/t/p/**`. That remote pattern is the whole
  reason the `sharp`/libvips CVEs and the AVIF Image Optimization RCE matter here rather than being
  theoretical. The config needs no change: `next@16.3.8` keeps `react ^19.0.0` and
  `babel-plugin-react-compiler` as peers, unchanged from `16.2.12`.
- `services/web/Dockerfile` — the `builder` stage runs `npm ci` inside `node:24.18.0-alpine` and
  `next build` with `output: standalone`, which bundles `sharp` into `.next/standalone/node_modules`.
  The musl binary is selected at that `npm ci`, from the lockfile. This is why the install for this
  slice must happen inside the `web` container and never on the host (Article I, and the second risk
  in `../plan.md`).
- `services/web/scripts/check-messages.mjs` — the existing `en`/`es` parity gate. Unchanged, but it
  must still pass at 600 keys afterwards.

## Steps

1. Edit the one line in `services/web/package.json`.
2. Install from inside the `web` container (never the host) so the lockfile resolves against
   `node:24.18.0-alpine`: a **targeted** `npm install next@16.3.8`. Do **not** run `npm audit fix`
   — see Tests below for why that is a hard rule in this service and not in `api`.
3. Assert the lockfile carries both musl variants at the new version:
   `@img/sharp-linuxmusl-x64` and `@img/sharp-linuxmusl-arm64` at `0.35.5` or later, alongside the
   rest of the `@img/*` set. Today's lockfile holds all 25 variants; if the new one holds fewer,
   **stop and report** — the published images are the only place that breaks, and only at request
   time (`AC-6`).
4. Read the lockfile diff and confirm every moved package sits inside `next`'s own subtree
   (`next`, `@next/env`, `postcss`, `nanoid`, `@swc/helpers`, `styled-jsx`, `sharp`, `@img/*`).
   Anything outside it — `tailwind-merge`, `lucide-react`, `next-intl`, `@fullcalendar/*`,
   `tus-js-client` — is collateral this service cannot detect and must be reported, not committed.
5. Typecheck, check message parity, and produce a production build.
6. Run the live pass over the six `next/image` call sites. This is step 6 and not optional; it is
   the only check in the repository that can catch a dropped musl `sharp`.

## Contract obligations

`../spec.md` § GraphQL Contract Delta reads **"None — this feature does not cross the service
boundary."** This slice consumes no new field, handles no new error condition, and adds no entry to
`services/web/src/lib/graphql-error.ts`'s vocabulary. Every `fetchGraphQL<T>` type parameter in
`src/actions/` stays exactly as it is.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

**This service has no test suite — 0 spec files — and this slice does not add one.** That is a
statement about where the verification burden lands, not a shrug:

- Article IX asks for tests where failure is silent. The silent failure in this slice is real and
  specific — `sharp`'s musl binary disappearing from the lockfile, which passes `tsc`, passes
  `next build`, builds a clean image, and then returns 500 for every poster in the published
  container, possibly on one architecture only. There is no unit test that catches that, because the
  thing under test is a platform-specific binary resolution in a different libc than the one any
  test would run under. The defence is step 3's lockfile assertion plus step 6's live pass
  (`AC-6`, `AC-14`), which is why both are mandatory steps rather than nice-to-haves.
- The second silent failure is collateral movement in an untested dependency tree. The defence is
  procedural and is the reason this slice's rule differs from `api`'s: **no `npm audit fix` here.**
  `api` can absorb an unconstrained resolve because 903 tests will catch a regression; `web` cannot
  catch anything, so the diff must stay small enough for a human to read. Step 4 is that read.

## Done when

```bash
bin/cli web npx --no tsc --noEmit                     # 0 errors
bin/cli web node scripts/check-messages.mjs           # en/es parity at 600 keys
bin/audit web                                         # found 0 vulnerabilities
bin/stop                                              # before the build — see below
bin/npm web run build                                 # exit 0
```

`bin/npm web run build` must not run while a dev stack is up for this checkout: `next build`
overwrites `.next` and un-hydrates every page of the running dev server until the next `next dev`
rebuild (`NFR-7`). Bring the stack back with `bin/dev -d` for the live pass.

Then the live pass, which closes the slice: `/`, `/movies`, a film's detail page, `/shows`, the user
dropdown, and `/login` — `MediaCard.tsx`, `Movie.tsx`, `Show.tsx`, `UserDropdown.tsx`,
`IndexerSetupGuide.tsx`, `login/page.tsx`. Every poster renders, browser console clean (`AC-14`).

`bin/audit` is `infra`'s deliverable and may not exist when this slice runs. Until it does, the
equivalent is a production audit of `services/web` from inside the `web` container; it must read
`found 0 vulnerabilities`.
