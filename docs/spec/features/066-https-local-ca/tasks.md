---
title: HTTPS Through Traefik With a Local Certificate Authority — Tasks
last_updated: 2026-09-19
status: In Progress
---

# TASKS: HTTPS Through Traefik With a Local Certificate Authority (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation, repo-root prose/config outside every agent's territory (`.gitignore`), and the manual pass. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory — `bin/`, `docker-compose.yaml`, `.env.example`, `install.sh`, `services/*/Dockerfile`. Executable config, so these carry a real *Done when*. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

A task is one coherent change an agent can finish and verify on its own. If it cannot be checked off
without also doing something in another service, it is scoped wrong — split it.

## Tasks

### Group 1 — contract, stack wiring and the scheme-agnostic `web` groundwork

The contract delta is one additive field, frozen in `spec.md`. `api`, `infra` and the part of `web`
that does not consume it can start together.

- [x] **T001** `[docs] [P]` Add `certs/` to the root `.gitignore`, under the "Environment &
      Sensitive configs" block, with a one-line note that it holds the local CA's private key
      (`066`, NFR-2). Must land before anyone runs `certs` in this checkout.
      *Done when:* `mkdir -p certs && touch certs/ca.key && git status --short --ignored certs` shows
      `!! certs/`; the scratch file is removed afterwards.
- [x] **T002** `[api] [P]` Implement `api/plan.md` Steps 1–6: `useHttps` in
      `environment.types.ts`, the factory in `environment.module.ts` (`USE_HTTPS === 'true'`,
      allowlist comment → seven names), `@Field() useHttps: boolean` after `useTraefik` in
      `entities/environment-info.entity.ts`, the in-effect rule and the scheme in
      `environment.service.ts` (reuse `canDeriveUrls` and `buildUrl`, do not add a second builder),
      and `https://${DOMAIN}` added unconditionally to the CORS origins in `src/main.ts`. Do not
      touch `src/uploads/`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; after one boot,
      `git diff services/api/src/schema.gql` shows exactly one added line, `useHttps: Boolean!`,
      inside `type EnvironmentInfo`, after `useTraefik`; `git status --short services/api/prisma`
      is empty.
- [x] **T003** `[api]` Extend `src/environment/environment.service.spec.ts` per `api/plan.md` §
      Tests: one added sentence in the Article IX header (the raw-flag `useHttps` failure), the four
      new cases, the allowlist key set gaining exactly `useHttps`, and `useHttps: false` added to the
      existing fixtures. Fault-inject: make the service return `this.config.useHttps` raw and watch
      the port-mode and null-domain cases fail. → T002
      *Done when:* `bin/npm api test -- environment` is green; `bin/npm api test` is green with totals
      reported against the 603 tests / 50 suites baseline (`062`); the fault-injected run's failing
      case names are pasted and the injection reverted (`git diff` of the service shows only T002's
      change).
- [x] **T004** `[infra] [P]` Implement `infra/plan.md` Steps 1–5 in `docker-compose.yaml` and
      `.env.example`: the `certs` service (`mariadb:12.3.2`, `profiles: [https]`, `restart: "no"`,
      inline script — CA create-or-verify with the name-constraint check and its loud failure, leaf
      reissue on missing / < 30 days / SAN mismatch / not signed by the current CA, atomic `mv`,
      `dynamic.yml` with the four `*-secure` routers → `<name>@docker`, `chown`/`chmod`, REQ-7
      message on first CA creation); `traefik`'s `sh -c` entrypoint wrapper, `USE_HTTPS` env,
      `traefik_tls:/tls:ro`, `depends_on: certs` with `required: false`; `USE_HTTPS` on `api` only;
      the `traefik_tls` volume; `USE_HTTPS=false` and the updated comments in `.env.example`. Do not
      change any label on `web`/`api`/`torrent`/`indexer`. → T001
      *Done when:* `docker compose -f docker-compose.yaml config -q` exits 0; with `USE_HTTPS` unset,
      `docker compose config` shows `traefik` running the same `--…` flags as `master` and no
      `providers.file` flag; `docker compose config | grep -A40 '^  api:' | grep USE_HTTPS` prints one
      line and the same grep on `web:` prints none; `git diff docker-compose.yaml | grep '^[-+].*traefik\.http\.routers'`
      prints nothing.
- [x] **T005** `[infra]` Implement `infra/plan.md` Step 8 in `bin/dev` and `bin/prod`: prepend
      `certs` to `SERVICES` when `USE_TRAEFIK=true` and `USE_HTTPS=true`; update the header comments.
      → T004
      *Done when:* with `USE_TRAEFIK=true`, `USE_HTTPS=true`, `DOMAIN=perceptor.local` in `.env`,
      `bin/dev -d` then `docker compose ps -a certs traefik` shows `certs` exited `(0)` and `traefik`
      running; `docker compose logs certs` prints the REQ-7 handoff on the first run and not on a
      second `bin/dev -d`; `stat -c '%a %U' certs/ca.key` prints `600` and the host user.
- [x] **T006** `[infra]` Implement `infra/plan.md` Steps 6–7 in `install.sh` and `bin/install`: the
      HTTPS question inside the Traefik arm only, `USE_HTTPS`, `COMPOSE_PROFILES=traefik,https` (in
      `install.sh` only), `PUBLIC_UPLOAD_URL` scheme, and `install.sh`'s closing summary (https URL
      plus the absolute `certs/ca.crt` path and trust instruction). → T004
      *Done when:* `bash -n install.sh && bash -n bin/install` exit 0; `bin/install` run in a scratch
      copy of the repo with answers `y`, `perceptor.local`, `y` writes `USE_HTTPS=true` and
      `PUBLIC_UPLOAD_URL=https://api.perceptor.local/uploads`, and with `y`, `perceptor.local`, `n`
      writes `USE_HTTPS=false` and `http://…`; answering `n` to Traefik asks no HTTPS question.
      `install.sh`'s new branch is shown in the report as a diff (it downloads `docker-compose.yaml`
      from GitHub, so a full live run is only possible after release — see T010).
- [x] **T007** `[web] [P]` Implement `web/plan.md` Steps 1–3: create
      `src/lib/request-scheme.ts` with `isSecureRequest()` moved verbatim from
      `src/actions/auth.ts` plus `withRequestScheme(url)`; `auth.ts` imports it and loses its local
      copy; `createUploadTicketAction` in `src/actions/uploads.ts` returns
      `await withRequestScheme(endpoint)`. Independent of the contract.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors; `grep -n "function isSecureRequest" -r services/web/src`
      prints exactly one line, in `src/lib/request-scheme.ts`; `src/lib/request-scheme.ts` has no
      `"use server"` directive.

### Group 2 — consumer of the contract

- [x] **T008** `[web]` Implement `web/plan.md` Steps 4–6: `useHttps` in
      `src/types/environment.ts`, the `ENVIRONMENT_INFO_QUERY` selection and its fallback in
      `src/actions/environment.ts`; the HTTPS row, `<li>USE_HTTPS</li>` and the scheme-agnostic
      `uploadConsistent` in `src/components/settings/EnvironmentPanel.tsx`; `httpsLabel`,
      `httpsEnabled`, `httpsDisabled` in `messages/en.json` and `messages/es.json`. → T002, T007
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors; `bin/npm web run build`
      exits 0; `bin/cli web node scripts/check-messages.mjs` reports no drift (the three new keys added to the current count);
      Settings → Environment on the dev stack (HTTPS off) renders the HTTPS row reading "Disabled"
      with no GraphQL error.

### Group 3 — verification and docs

- [x] **T009** `[infra]` Run the certificate-step blocks of `plan.md` § Verification against the
      live stack and paste their output: AC-1's file checks (only `ca.crt` + `ca.key` in `./certs`,
      mode `600`), AC-3 (`curl -sI http://perceptor.local` — no `3xx`), AC-5 (`nameConstraints` on the
      CA, `subjectAltName` on the leaf), the `curl --cacert certs/ca.crt https://…` check on all four
      hosts, AC-6 (leaf deleted and reissued, `sha256sum certs/ca.*` unchanged), AC-7
      (`DOMAIN=perceptor.home` → `certs` fails naming `./certs`, `traefik` not started, CA
      unchanged; domain restored afterwards), the SAN-mismatch reissue trigger (hand-issue a leaf for
      `other.local` from the same CA into `/tls` via `docker compose run --rm --no-deps --entrypoint bash certs`,
      restart, confirm the served leaf is back to `perceptor.local`), and AC-10 (a `.env` with no `USE_HTTPS`:
      no `certs/` directory created, `curl -skI https://perceptor.local` returns Traefik's `404` as on
      `master`). → T003, T005, T006, T008
      *Done when:* every command above has its real output in the report and each matches the
      expectation written in `spec.md`.
- [ ] **T010** `[docs]` Manual pass with the user, on the stack from T009: trust `certs/ca.crt` on
      one PC and open the four `https://` hosts in Chrome (AC-2, "Install app" offered); upload a file
      over `https://` (AC-4, console clean); from a browser profile without the CA, upload over
      `http://` and check the network tab hits `http://api.perceptor.local/uploads` (AC-4b); same
      profile over `https://` shows the certificate error while `http://` works (AC-8); Settings →
      Environment as admin, including both `PUBLIC_UPLOAD_URL` edits (AC-9). AC-1's installer prompt
      is checked through `bin/install` (T006); the `install.sh` end-to-end run happens on the first
      release that carries this feature, and is recorded here as pending until then. → T009
      *Done when:* each AC's outcome is written into this task's report, pass or fail.
- [x] **T011** `[docs] [P]` `docs/spec/graphql-contract.md`: in the `055` section, add
      `useHttps: Boolean!` to the `EnvironmentInfo` SDL and a `066` paragraph — in-effect semantics
      (never the raw variable), scheme flip on non-null URLs only, `web` never reads `USE_HTTPS` and
      compares the upload endpoint scheme-agnostically. → T002
      *Done when:* the SDL in that file matches `schema.gql`'s `type EnvironmentInfo` field for field.
- [x] **T012** `[docs] [P]` Update the `CLAUDE.md` files. Root: § Topology (`:443` now routed when
      `USE_HTTPS=true`, the `certs` one-shot), § Environment (a `USE_HTTPS` bullet: local CA in
      `./certs`, trust per device, HTTP kept, `COMPOSE_PROFILES=traefik,https`, the NFR-3 domain
      constraint and how to rotate), and § Current state (the T003/T008 measurements). No pipeline
      row changes. `services/api/CLAUDE.md`: the `environment/` paragraph's allowlist becomes seven
      names. `services/web/CLAUDE.md`: mention `src/lib/request-scheme.ts` as the one request-scheme
      detector, shared by the login cookie and the upload endpoint. → T009
      *Done when:* `grep -n USE_HTTPS CLAUDE.md services/api/CLAUDE.md` finds the new text and
      `grep -n request-scheme services/web/CLAUDE.md` finds one mention.
- [ ] **T013** `[docs]` Walk every acceptance criterion in `spec.md` against T009/T010's reports,
      tick each box that passed (leave AC-1's `install.sh` half noted as pending release if still
      so), and set `status: Implemented` on `spec.md`, `plan.md`, `infra/plan.md`, `api/plan.md`,
      `web/plan.md`, and `status: Done` here. → T010, T011, T012, T016
      *Done when:* `grep -c '\- \[ \]' docs/spec/features/066-https-local-ca/spec.md` equals the
      number of criteria explicitly recorded as pending, and every plan file reads
      `status: Implemented`.

- [x] **T014** `[infra]` Implement `infra/plan.md` Step 9 (`ca_public` volume, `certs` copy, `web` read-only
      mount). → T009
      *Done when:* the Step 9 checks pass on the live stack and `.env` without `USE_HTTPS` still creates no
      `./certs`.
- [x] **T015** `[web]` Implement `web/plan.md` Steps 7-8 (`/ca.crt` route, `proxy.ts`, panel link, messages). → T008
      *Done when:* `bin/cli web npx --no tsc --noEmit` 0 errors, `bin/npm web run build` exits 0, `check-messages.mjs` no drift.
- [x] **T016** `[docs]` Walk AC-11 live after T014 and T015: `curl -s http://perceptor.local/ca.crt | cmp - certs/ca.crt`,
      the panel link, `404` with HTTPS off. Add the download to `CLAUDE.md`'s `USE_HTTPS` bullet. → T014, T015

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
