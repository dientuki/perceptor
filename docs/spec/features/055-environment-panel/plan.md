---
title: Environment Panel — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Environment Panel (`plan.md`)

## Approach

The feature is a new read-only query plus a new tab. Nothing is persisted, no pipeline stage moves,
and no existing behaviour changes — which makes the shape of each slice mostly a question of which
existing pattern to copy.

**`api` copies `media-roots/` almost exactly.** That module is the established way this codebase
exposes `.env`-declared infrastructure to the UI: `media-roots.module.ts` builds its config from
`process.env` in a **module factory behind an injection token** (`MEDIA_ROOTS`), and its comment says
why in as many words — so `media-roots.service.spec.ts` can inject a fixture instead of mutating
`process.env`. That is exactly what NFR-2 and AC-8 need here: a service that derives URLs from
injected config is a pure function of that config, so the allowlist test asserts the payload shape
without touching the environment or booting a container. The new `environment/` module repeats that
structure — factory → token → service → resolver — and the resolver carries `@UseGuards(AdminGuard)`
per method, the `ffprobe-logs.resolver.ts` split, never at class level.

The one deliberate divergence from `media-roots/` is that `EnvironmentEndpoint` carries **no
`label`**. `MediaRoot` has one, and it is a hardcoded Spanish string (`'Descargas'`, `'Biblioteca'`)
predating `018-ui-i18n`. Following that neighbour would put user-facing copy back into `api`. Service
names are keyed off `id` in `web`'s catalog instead.

**`web` adds one tab, and renders it outside the form.** `SettingsForm.tsx` is one `<form>` wrapping
six panels, all mounted at once and switched with `hidden` — a load-bearing rule, since `FormData`
reads the DOM and a conditionally rendered panel would silently drop its fields from a save. The
Environment panel has no fields at all, so it renders as a **sibling of the form, not a child**, and
the form itself gets `hidden` while that tab is active. That satisfies REQ-10 structurally rather
than by discipline: a panel outside the form cannot contribute to a submit, and hiding the form also
hides the *Guardar* button that would otherwise sit under a read-only screen promising to save it.
Hiding — never unmounting — keeps every other tab's unsaved edits intact.

The two values only `web` holds (`PUBLIC_UPLOAD_URL`, its own `DOMAIN`) are read in
`settings/page.tsx`, already a Server Component, and passed down as props. No new server action:
there is no GraphQL round trip to make, and `createUploadTicketAction`'s precedent for reading
`PUBLIC_UPLOAD_URL` server-side exists because that action had a ticket to fetch anyway. Inventing an
action to read two environment variables in a component that is already running on the server would
be ceremony.

**`infra` passes three variables and nothing else.** `api` today receives `DOMAIN`, `WEB_PORT` and
`PORT`; it needs `USE_TRAEFIK`, `QBITTORRENT_WEBUI_PORT` and `INDEXER_PORT`. All three already exist
in `.env.example`, so that file is untouched — this is a three-line change to the `api` service's
`environment:` block in `docker-compose.yaml`. `api`'s own published port is read from the existing
`PORT`, not from a new `API_PORT` passthrough: `PORT=${API_PORT}` is already there and the port
mapping is `${API_PORT}:${API_PORT}`, so a second variable would be a second source for one fact.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `infra` | Three env passthroughs in `docker-compose.yaml`. Smallest slice, and until it lands `api` can be written but not manually verified — `useTraefik` would read `false` on every host regardless of `.env`. |
| 2 | `api` | Owns the contract the panel consumes. Nothing in `web` can be checked against a real response until this exists. |
| 3 | `web` | Renders the tab and supplies the two values the query deliberately does not carry. |
| 4 | `docs` | The `055-environment-panel` section in `docs/spec/graphql-contract.md`, written once the shape is real. |

Steps 2 and 3 **may overlap** once `spec.md` is `Approved`: the delta is frozen, there is no codegen
between them, and `web` retypes the shape by hand either way. What cannot overlap is *verification* —
`web`'s AC-1 through AC-5 all require a running `api` answering `environmentInfo`, so if the two run
in parallel, `web`'s done-check waits for `api`'s. Step 1 is independent of both and can go first or
alongside. Step 4 is last by nature.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Four things an
implementer will be tempted to change and must not:

- **`EnvironmentEndpoint` has no `label`.** It looks like an omission next to `MediaRoot`, which has
  one. It is not: service display names are user-facing copy and belong to `web`'s message catalog
  keyed off `id` (`018-ui-i18n` — `api` never produces display text). `MediaRoot.label` is
  pre-i18n legacy, not the pattern.
- **`endpoints[].url` and `expectedUploadEndpoint` are nullable, and `null` is the correct answer in
  port mode.** From inside `api` this reads like a gap begging for a `?? 'localhost'`. That fallback
  is the single most damaging change anyone could make here — see Risks.
- **`domain` is reported in both modes**, including when `useTraefik` is false. It looks redundant to
  send a value that is not in effect; REQ-3 wants it visible precisely because an administrator about
  to switch modes needs to see what will start applying.
- **`PUBLIC_UPLOAD_URL` is not in the query.** `api` does not have it and must not be given it. The
  value that matters is the one `web` hands the browser, and a second copy in `api`'s environment
  could drift from it — reporting a value this service does not use would defeat the comparison the
  panel exists to make.

If the contract turns out wrong: stop, amend `spec.md`, re-approve, re-brief all three slices. Never
patch it from inside one (Article VIII).

## Migrations

None. No Prisma model, field, enum or migration — every value is read from the process environment
and nothing is persisted. `git status --short services/api/prisma` must stay empty for this feature;
a migration directory appearing here means someone misread the spec.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **A `localhost` fallback for an underivable URL** (NFR-1) | No error anywhere. The panel renders a plausible, confident, wrong answer; an administrator pastes `http://localhost:4000/uploads` into `.env` and uploads break for every device that is not the host — with the panel showing a green, consistent verdict beside it. This is strictly worse than the bug the feature exists to fix. | Unit test asserting `url === null` and `expectedUploadEndpoint === null` for a port-mode config, written fault-injection style: it must fail if the `?? 'localhost'` is added back. |
| **The consistency verdict that is always true** (REQ-6) | Over-normalizing the comparison (trailing slash, case, protocol coercion), or comparing the loaded endpoint against itself, produces "consistent" forever. The original invisible failure returns, now with a checkmark next to it — the panel actively vouches for a broken value. | Test the comparison against the AC-2 fixture (`DOMAIN=ptor.local`, endpoint on `perceptor.local`) and assert it reports *inconsistent* plus the expected value. |
| **Returning `process.env` wholesale, or one extra "useful" field** (NFR-2) | No error, admin-only screen, reviewed once. A `DATABASE_URL` or `JWT_SECRET` sitting in a GraphQL response is invisible until it is not. | AC-8's test asserts the resolver payload keys are *exactly* the allowlist — it fails when a field is added, which is the point. |
| **Conditionally rendering the form instead of hiding it** (`web`) | Visiting the Environment tab unmounts the other six panels; every unsaved edit on them is destroyed with no warning and no error. The existing comment in `SettingsForm.tsx` warns about this exact class of mistake for panels; extending it to the form itself is the new part. | `web/plan.md` states it explicitly; the manual pass includes editing a field, visiting Environment, returning, and saving. |
| **api and web disagreeing is invisible** (REQ-7) | If `web` compares its own `DOMAIN` against nothing, the "you recreated one container and not the other" case stays exactly as undiagnosable as it was. | The comparison is a named requirement with its own acceptance criterion (AC-5) and its own manual step in Verification below. |
| **Catalog drift** | New keys land in `en.json` only; `es` renders the fallback or the raw key, and nobody notices until a Spanish-speaking admin opens the tab. | `bin/cli web node scripts/check-messages.mjs` in the done-check of the `web` slice. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
docker compose config | grep -A 25 'api:' | grep -E 'USE_TRAEFIK|QBITTORRENT_WEBUI_PORT|INDEXER_PORT'
```

Then the manual pass, which is the only way to reach AC-1 through AC-5 — each needs a different
`.env` state and a container recreate, so none of them is reachable from a unit test:

1. **AC-1 (consistent, Traefik mode).** With `USE_TRAEFIK=true`, `DOMAIN` set and `PUBLIC_UPLOAD_URL`
   matching `http://api.<domain>/uploads`, open `/settings` as an administrator and select the last
   tab. It reads *Environment*, carries the `Container` icon, shows routing enabled, the domain, four
   services with ports and URLs, and the upload endpoint marked consistent.
2. **AC-2 (the original bug).** Change `DOMAIN` to something else, leave `PUBLIC_UPLOAD_URL` alone,
   `docker compose up -d --force-recreate api web`, reload. The upload endpoint is flagged
   inconsistent and the expected value is shown.
3. **AC-3 / AC-4 (port mode).** Set `USE_TRAEFIK=false`, recreate, reload. No service URL is rendered
   as an absolute URL built from `localhost` or any invented host, and the host-configuration block is
   present. Flip back to `true`, recreate: the block is gone.
4. **AC-5 (restart needed).** Change `DOMAIN`, recreate **only** `web`
   (`docker compose up -d --force-recreate web`), reload. The panel reports that `api` and `web`
   disagree and names the recreate command.
5. **AC-7 (unset endpoint).** Comment `PUBLIC_UPLOAD_URL` out of `.env`, recreate `web`, reload. The
   endpoint renders as not configured, the string `undefined` appears nowhere, and another tab still
   saves normally.
6. **REQ-10 / the form risk.** Edit a field on the General tab without saving, switch to Environment,
   switch back: the edit is still there. On the Environment tab there is no *Guardar* button.
7. **AC-6.** Sign in as a non-admin: `/settings` still 404s, unchanged.
