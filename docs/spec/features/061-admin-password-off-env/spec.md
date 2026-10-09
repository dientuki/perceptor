---
title: Admin Password Off .env
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-19
last_updated: 2026-09-19
status: Approved
services: [infra, api]
---

# SPEC: Admin Password Off .env (`spec.md`)

## Context & Goal

Today the administrator's plaintext password sits in `.env` long after installation finishes.
`install.sh` asks for it and writes it to `ADMIN_PASSWORD`, and `.env.example` interpolates it into
`QBITTORRENT_PASSWORD` and `INDEXER_PASSWORD` so the app, qBittorrent and Prowlarr share one login.
Anyone who can read the installation directory, or a backup of it, can read the password. Each of
the three consumers needs it for a different reason, and only one of them needs it to be there
forever:

- `api`'s seed (`services/api/prisma/seeds/users.ts`) only uses it to create the admin row the first
  time. The `upsert` never overwrites an existing password. But if the row is missing and the
  variable is empty, it silently creates the admin with `changeme`.
- `torrent`'s `services/torrent/custom-cont-init.d/10-qbittorrent-password` rewrites the WebUI
  PBKDF2 hash on every container start, and exits 1 when `QBITTORRENT_PASSWORD` is empty.
- `indexer`'s `services/indexer/custom-services.d/10-prowlarr-credentials` exits 1 when
  `INDEXER_PASSWORD` is empty. That check runs before its own "already configured, touch nothing"
  check, so a configured Prowlarr still crash-loops the service without the variable.

The only way to recover a forgotten password is `bin/reset-password`
(`services/api/scripts/reset-password.ts`). It changes the app login only, so qBittorrent and
Prowlarr fall out of sync with it. It is also a `bin/` wrapper, so an end user who installed with
`install.sh` and has only Docker never has it.

Once this ships, a finished installation keeps no password in `.env`, torrent and indexer boot
without one, and a single command sets the shared password in all three places at once. The
installer uses that same command to set the initial password, and its final message prints it, so a
user who forgets the password knows how to recover it. No pipeline stage in the root `CLAUDE.md`
changes. This is installation and credential plumbing only.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (One reset command, three places)**: Must provide one password-set command, run
      inside the `api` container and invocable as `docker compose exec api <cmd> <username>`. It
      sets the given user's app password. When that user is the installation's shared admin
      (`ADMIN_USER`), it must also set the qBittorrent WebUI password and the Prowlarr forms-auth
      password to the same value, keeping username `ADMIN_USER` on both. For any other username it
      changes the app login only.
- [ ] **REQ-2 (Input)**: Must read the new password with confirmation: masked on a TTY, and
      line-by-line from a pipe. This is the behaviour `reset-password.ts` already has, and it lets
      `install.sh` drive the command non-interactively. Must refuse an empty password.
- [ ] **REQ-3 (Works from published images)**: Must ship compiled in the `prod` `api` image,
      as `mint-service-token` already does (`dist/scripts/…`). It must not depend on `ts-node` or on
      anything under `bin/`.
- [ ] **REQ-4 (bin wrapper)**: `bin/reset-password <username>` must invoke the same command, so the
      developer and end-user paths cannot diverge.
- [ ] **REQ-5 (Installer uses it)**: On a fresh install, `install.sh` must still ask for the admin
      password, but must never write it to `.env`. After the stack is healthy, it must set the
      password by piping it into the REQ-1 command.
- [ ] **REQ-5b (Developer installer too)**: `bin/install` must behave like `install.sh`: never
      write the password to `.env`, and set it through the REQ-1 command once the stack is up.
- [ ] **REQ-6 (No password left in .env)**: After a successful `install.sh`, `.env` must contain
      no `ADMIN_PASSWORD`, `QBITTORRENT_PASSWORD` or `INDEXER_PASSWORD` value, empty or otherwise.
      `.env.example` and `docker-compose.yaml` must stop carrying or interpolating them.
- [ ] **REQ-7 (Recovery hint)**: The installer's final message must print the exact reset command
      for the chosen admin user, in the `docker compose exec …` form an end user can run from the
      install directory.
- [ ] **REQ-8 (Seed without a password)**: When `ADMIN_PASSWORD` is absent or empty, `api`'s seed
      must still create the admin row if it is missing, but with no usable password (no login
      succeeds until REQ-1 sets one). It must never fall back to `changeme`.
- [ ] **REQ-9 (torrent boots without it)**: When `QBITTORRENT_PASSWORD` is unset, the qBittorrent
      init must leave any existing WebUI password untouched and must not fail the container. When it
      is set, the current behaviour (write the hash) is kept for existing installations.
- [ ] **REQ-10 (indexer boots without it)**: When `INDEXER_PASSWORD` is unset, the Prowlarr
      credentials service must not exit or crash-loop, and must leave whatever authentication
      Prowlarr already has untouched. When it is set, the current behaviour is kept.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Existing installations)**: An installation whose `.env` still carries the three
      variables must keep booting and behaving exactly as today after pulling the new images.
      Re-running `install.sh` on it (repair mode) must not ask for a password and must not strip
      them. Repair mode leaves those lines alone. Removing them is a manual step for the user,
      documented only (run the REQ-1 command, then delete the three lines).
- [ ] **NFR-2 (No secret leaks)**: The password must never appear in a process argument list
      (`ps`), a URL, a log line or command output. Only stdin carries it.
- [ ] **NFR-3 (Loud partial failure)**: If the app password is set but qBittorrent or Prowlarr
      cannot be updated (container down, API error), the command must exit non-zero and name which
      of the three were and were not changed. It must never report success over a partial write
      (Article IX). Re-running it once the service is back must converge.
- [ ] **NFR-4 (No new trust)**: qBittorrent is reached through the existing subnet auth bypass,
      the same one the torrent client in `api` already relies on. Prowlarr is reached with the
      `tracker_api_key` setting `api` already holds. No new credential is introduced.
- [ ] **NFR-5 (Installer failure)**: If the REQ-1 step fails during `install.sh`, the installer
      must exit non-zero, print the command to retry it, and leave `.env` without a password.

## GraphQL Contract Delta

None. This feature does not cross the service boundary. The command is a CLI script inside
`api`'s container that talks to the database directly and to qBittorrent and Prowlarr over their own
HTTP APIs. No resolver, type or error key is added. The app's own "change my password" flow, if any,
is unchanged.

## Data Model Changes

None. `User.password` already exists. REQ-8's "no usable password" is a value choice for that
column, not a schema change.

## Acceptance Criteria

**Verification status — 2026-10-09** (pass over 002–071 on `fix/tech-debt`, no code change)

Ten of ten open, and the blocker is not a session: **nine of these ten criteria are about the
installer and the password-reset command, and running them means setting a real credential.**

- **AC-1, AC-2, AC-3, AC-4, AC-8** need a **fresh `curl … | bash` install into an empty directory**
  (AC-8 an upgrade of a pre-`061` install whose `.env` still carries the three removed variables).
  This checkout cannot stand in for either: its `.env` was answered long ago and `bin/install`, not
  `install.sh`, generated it.
- **AC-5, AC-6, AC-7, AC-9, AC-10** drive `scripts/reset-password.ts` — `bin/reset-password` on a dev
  stack for AC-9 and AC-10. That command writes the app, qBittorrent and Prowlarr logins together,
  which is the whole point of the feature and also why it was not run here: it would change the
  admin credential of the user's own working installation, across three services, and nothing in
  this verification pass authorises that. AC-7 (a non-admin username touching only the app login)
  additionally needs a second user, and the `users` table holds exactly one row.

What is established without running any of it: `api/src/shared-login/shared-login.spec.ts` covers the
three-way write, and `api/src/database/seed/production-seed.spec.ts` covers the seed storing an
unusable hash when no `ADMIN_PASSWORD` is present — both green in the 1000 api tests measured this
pass.

**One measured fact that bears directly on AC-8, and the opposite of what AC-1 describes:** this
checkout's `.env` still carries all three removed variables — `ADMIN_PASSWORD`,
`QBITTORRENT_PASSWORD` and `INDEXER_PASSWORD` are each present (checked 2026-10-09; values not
recorded here, and never to be). This is therefore itself a **pre-`061` installation**, i.e. exactly
AC-8's subject rather than AC-1's. What AC-8 asks — that such an installation keeps working with the
variables honoured if present — is weakly in evidence every day this stack runs: `api`, `torrent`
and `indexer` are all healthy with those variables in place. What is *not* in evidence is the
deliberate part of AC-8: that the login still works and that the reset command then takes over
cleanly. Closing AC-8 properly means a login, which means a session; closing AC-1 means a fresh
install directory, which this is not and cannot be made into.

**AC-10 is the one box here that could be closed without touching a credential**: that `ps aux`
inside `api` never shows the password while the reset runs is a property of how the script reads
stdin, and could be established by inspection plus a run against a throwaway username. It is
recorded here as the cheapest path, not as verified.

- [ ] **AC-1**: A fresh `curl … | bash` install finishes, and `grep -E
      'ADMIN_PASSWORD|QBITTORRENT_PASSWORD|INDEXER_PASSWORD' .env` prints nothing.
- [ ] **AC-2**: Right after AC-1, the password typed into the installer logs into the web app, the
      qBittorrent WebUI and the Prowlarr UI, all with username `ADMIN_USER`.
- [ ] **AC-3**: The installer's last lines include `docker compose exec api … <ADMIN_USER>`, and
      running that exact line in the install directory, entering a new password twice, makes the new
      password work (and the old one fail) on all three UIs.
- [ ] **AC-4**: `docker compose restart torrent indexer api` on the AC-1 installation brings all
      three back healthy, with the password from AC-3 still valid everywhere, and no
      `ERROR … vacío` line in `docker compose logs torrent indexer`.
- [ ] **AC-5 (failure)**: With `docker compose stop indexer`, running the reset command exits
      non-zero, states that Prowlarr was not updated, and states what was updated. After
      `docker compose start indexer`, re-running it succeeds and all three logins match.
- [ ] **AC-6 (failure)**: Entering two different values at the confirmation prompt, or an empty
      one, exits non-zero and changes nothing on any of the three.
- [ ] **AC-7**: The reset command for a non-admin username changes only that user's app login,
      and the qBittorrent and Prowlarr passwords stay as they were.
- [ ] **AC-8**: An installation from before this feature, with the three variables still in
      `.env`, keeps working after `docker compose pull && docker compose up -d`, with logins
      unchanged.
- [ ] **AC-9**: `bin/reset-password admin` on a dev stack behaves exactly like AC-3.
- [ ] **AC-10**: While the reset command runs, `ps aux` inside the `api` container never shows the
      password, and neither does `docker compose logs api`.

## Out of Scope

- **Changing the password from the web UI.** A recovery path exists precisely for when nobody can
  sign in. An in-app "change password" that also propagates to qBittorrent and Prowlarr would be a
  separate feature with a GraphQL surface.
- **Separate credentials for qBittorrent and Prowlarr.** The one-shared-login design stays. Only
  the place the password lives changes.
- **Moving other secrets out of `.env`** (`JWT_SECRET`, `SERVICE_TOKEN`, DB passwords). Those are
  machine credentials the containers need at every boot, and each is a different problem.
- **Jellyfin or any external media server credentials.** They are not part of the shared login.
