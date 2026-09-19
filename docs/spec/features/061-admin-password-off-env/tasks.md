---
title: Admin Password Off .env — Tasks
last_updated: 2026-09-19
status: In Progress
---

# TASKS: Admin Password Off .env (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task: a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory: `bin/`, `install.sh`, `docker-compose.yaml`, `.env.example`, and the container config under `services/torrent/` and `services/indexer/`. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is no GraphQL contract. The frozen interface is the CLI contract in `plan.md` § Contract
Freeze:
- `dist/scripts/reset-password.js <username>`;
- two stdin lines;
- exit 0 only when every applicable target was updated;
- one Spanish line per target.

Group 1 produces the command, Group 2 consumes it. The boot-tolerance work in Group 1 is
independent of `api` and runs in parallel.

## Tasks

### Group 1: the command, and boot without a password

- [x] **T001** `[api] [P]` First, record the baseline: `bin/cli api npx --no tsc --noEmit` and
      `bin/npm api run test` (tests/suites). Then create
      `services/api/src/shared-login/shared-login.ts` with `setQbittorrentLogin` and
      `setProwlarrLogin`, plus `shared-login.spec.ts`, per `api/plan.md` § Steps 1–2 and § Tests.
      *Done when:* `bin/npm api run test -- shared-login` passes every case in `api/plan.md`
      § Tests, including the case where qBittorrent answers 200 but the username read back
      differs, and the case asserting `password === passwordConfirmation` in the Prowlarr `PUT`.
      The spec file opens with the Article IX header.
- [x] **T002** `[api]` Wire `services/api/scripts/reset-password.ts` to the shared-login functions
      per `api/plan.md` § Step 3: reject an empty password, one output line per target, exit 1 on
      any failure, and a non-admin user updates the app only. → T001
      *Done when:*
      - `bin/npm api run build` emits `dist/scripts/reset-password.js`.
      - `printf 'x\nx\n' | docker compose exec -T api node dist/scripts/reset-password.js admin`
        on a running stack prints three "actualizado" lines and exits 0.
      - With `docker compose stop indexer`, the same command exits non-zero, and its Prowlarr line
        says "NO actualizado".
      - `printf 'a\nb\n' | …` exits non-zero and changes nothing.
- [x] **T003** `[api] [P]` Change `services/api/prisma/seeds/users.ts`: without `ADMIN_PASSWORD`,
      hash `randomBytes(32)`; remove `changeme`.
      *Done when:* on a fresh db with `ADMIN_PASSWORD` unset in `api`'s environment, the seed
      creates the admin, logging in as `admin`/`changeme` fails, and `git status --short
      services/api/prisma` lists only `seeds/users.ts`.
- [x] **T004** `[infra] [P]` In `services/torrent/custom-cont-init.d/10-qbittorrent-password`, an
      empty `QBITTORRENT_PASSWORD` logs that the stored password is kept and exits 0 (infra/plan.md
      § Step 1).
      *Done when:* with the variable removed from `torrent`'s environment,
      `docker compose up -d torrent` goes healthy, `docker compose logs torrent` has no `ERROR` or
      `vacío` line, and the WebUI password set before still works.
- [x] **T005** `[infra] [P]` In `services/indexer/custom-services.d/10-prowlarr-credentials`, an
      empty `INDEXER_PASSWORD` logs and runs `exec sleep infinity` before any wait (infra/plan.md
      § Step 2).
      *Done when:* with the variable removed, `docker compose restart indexer` shows no crash-loop
      and no `ERROR` line in `docker compose logs indexer`, and the existing Prowlarr login still
      works.
- [x] **T006** `[infra]` Remove `ADMIN_PASSWORD`, `QBITTORRENT_PASSWORD` and `INDEXER_PASSWORD`
      from `docker-compose.yaml` and `.env.example` (infra/plan.md § Step 3). → T004, T005
      *Done when:*
      - `grep -nE 'ADMIN_PASSWORD|QBITTORRENT_PASSWORD|INDEXER_PASSWORD' docker-compose.yaml
        .env.example` prints nothing.
      - `docker compose config -q` exits 0.
      - A stack whose old `.env` still carries the three variables boots all services healthy with
        logins unchanged (AC-8).

### Group 2: installers consume the command

Everything here depends on T002: the installers pipe into the compiled command.

- [x] **T007** `[infra]` `install.sh` per `infra/plan.md` § Step 4:
      - ask for the password and its confirmation, and keep them in a shell variable only;
      - pipe them into `docker compose exec -T api node dist/scripts/reset-password.js
        "$ADMIN_USER"` after the `SERVICE_TOKEN` block;
      - on failure, exit 1 and print the retry command;
      - print the reset command in the final message;
      - repair mode neither asks nor runs it.

      → T002, T003, T006
      *Done when:* `install.sh` run in an empty directory, against images built from this branch,
      finishes and then:
      - `grep -E 'ADMIN_PASSWORD|QBITTORRENT_PASSWORD|INDEXER_PASSWORD' .env` prints nothing
        (AC-1);
      - the typed password logs into the web app, qBittorrent and Prowlarr (AC-2);
      - the last lines contain `docker compose exec api node dist/scripts/reset-password.js
        <ADMIN_USER>` (AC-3);
      - a re-run in the same directory does not ask for a password.
- [x] **T008** `[infra]` `bin/install`, `bin/dbreset` and `bin/reset-password` per `infra/plan.md`
      § Steps 5–7:
      - `bin/install` asks once and sets the password after `dbreset`, before `docker compose
        stop`;
      - `bin/dbreset` ends by prompting through `bin/reset-password "$ADMIN_USER"`, skipped when
        called from `bin/install`;
      - `bin/install` prints the reset command.

      → T002, T003, T006
      *Done when:*
      - `bin/install` on a dev checkout prompts for the password exactly once, and afterwards that
        password works in all three UIs.
      - `bin/dbreset` alone prompts once, and the new password works everywhere.
      - `bin/reset-password admin` behaves like the compiled command (AC-9).
      - `.env` has no password line.

### Group 3: verification and docs

- [x] **T009** `[docs]` Update the docs that name the password in `.env`:
      - root `CLAUDE.md` § Environment: the "`ADMIN_USER`/`ADMIN_PASSWORD` are canonical" bullet,
        and the `bin/reset-password` row;
      - `services/api/CLAUDE.md` (the reset-password line);
      - `README.md` (the admin-credentials line, sign-in step 5, the `bin/reset-password` table
        row, plus the end-user reset command);
      - `.claude/agents/infra.md` if it names `ADMIN_PASSWORD`.

      → T007, T008
      *Done when:* `grep -rn 'ADMIN_PASSWORD' CLAUDE.md README.md services/api/CLAUDE.md
      .claude/agents` matches only lines describing it as optional or legacy, and every
      reset-command mention uses the frozen invocation.
- [ ] **T010** `[docs]` Walk AC-1 to AC-10 in `spec.md` against a running stack, tick each box,
      and record the api test and typecheck numbers in the root `CLAUDE.md` § Current state. Then
      set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `infra/plan.md`, and
      `status: Done` here. → T009
      *Done when:* every AC box is ticked or listed under Blocked with a reason. The ACs map to
      tasks as follows:

      | AC | Task |
      | :-- | :-- |
      | AC-1, AC-2, AC-3 | T007 |
      | AC-4 | T004, T005, T006 |
      | AC-5, AC-6, AC-7 | T002 |
      | AC-8 | T006 |
      | AC-9 | T008 |
      | AC-10 | T002, checked here with `ps aux` in `api` while the prompt waits |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
