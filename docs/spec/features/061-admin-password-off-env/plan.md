---
title: Admin Password Off .env — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-19
status: Approved
---

# PLAN: Admin Password Off .env (`plan.md`)

## Approach

The one password-set command lives in `api`, and it extends the recovery script that already
exists, `services/api/scripts/reset-password.ts`. Its input handling (a masked prompt on a TTY, an
async-iterator line reader on a pipe) already works from `install.sh`-style piping and is reused
unchanged. After the bcrypt update, when the target username equals `process.env.ADMIN_USER`, the
script also pushes the same credentials to qBittorrent and Prowlarr over their HTTP APIs.

That push logic lives in `services/api/src/shared-login/` as plain functions that take the settings
map, the username, the password and an injectable `fetch`. Two reasons it lives there and not in
`scripts/`. First, the script runs standalone, with no Nest DI, so `QbittorrentClient` and
`SettingsService` cannot be constructed there. Second, jest's `rootDir` is `src`, and this is the
code owed a test. The script reads the settings map with `prisma.setting.findMany()`, the same
shape as `SettingsService.getMap()`. It uses the keys the clients already use: `torrent_host`,
`torrent_port` (`QbittorrentClient.baseUrl()`), `tracker_host`, `tracker_port` and
`tracker_api_key` (the indexer client).

- **qBittorrent.** The script calls `POST /api/v2/app/setPreferences` with `web_ui_username` and
  `web_ui_password`. It reaches the WebUI through the subnet auth bypass already baked into
  `services/torrent/Dockerfile`, the same one the torrent client in `api` relies on, so no login
  is needed. After the write it reads `GET /api/v2/app/preferences` back to confirm the change.
- **Prowlarr.** The script calls `GET` then `PUT /api/v1/config/host` with the `X-Api-Key`
  header. The body transform is the one `10-prowlarr-credentials` already does in jq:
  `authenticationMethod=forms`, `authenticationRequired=enabled`, `username`, `password` and
  `passwordConfirmation`.

The alternative considered was rewriting `qBittorrent.conf` and Prowlarr's config and then
restarting the containers. It was rejected because it needs Docker access from inside `api` or a
host-side script that an end user may not have. The HTTP APIs work against running containers
with no restart.

**Invocation.**
- An end user runs `docker compose exec api node dist/scripts/reset-password.js <username>`, the
  precedent `install.sh` set with `dist/scripts/mint-service-token.js`. The api tsconfig has no
  `include`, so `scripts/` already compiles into `dist/`.
- A developer runs `bin/reset-password <username>`, which keeps running the same source through
  `ts-node`. It is one file, so the two paths cannot diverge (REQ-4).

**Seed (REQ-8).** When `ADMIN_PASSWORD` is empty, `prisma/seeds/users.ts` stores a bcrypt hash of
32 random bytes. No one knows that value, so the existing `bcrypt.compare` in
`src/auth/auth.service.ts` rejects every login with no special case. The `changeme` fallback is
removed.

**Installers.** Both installers set the password by piping it into the command once the stack is
healthy, using `printf '%s\n%s\n' "$pw" "$pw" | docker compose exec -T api …`. `printf` is a bash
builtin, so the password never shows up in a process argument list (NFR-2).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Provides `dist/scripts/reset-password.js`, which the installers call. It depends on nothing new in infra: the qBittorrent and Prowlarr HTTP APIs already exist. |
| 1′ | `infra` (the torrent and indexer init scripts, compose, `.env.example`) | Independent of `api`. Tolerating an unset password (REQ-9/10) can land in parallel. |
| 2 | `infra` (`install.sh`, `bin/install`, `bin/dbreset`) | Calls the command frozen below. Can be written in parallel, but must be verified after step 1. |
| 3 | docs (orch) | `README.md` (the admin credentials, the reset command, the bin table), `services/api/CLAUDE.md` (the reset-password line), and the root `CLAUDE.md` § Environment ("`ADMIN_USER`/`ADMIN_PASSWORD` are canonical"). |

## Contract Freeze

There is no GraphQL delta. The CLI contract between `api` and `infra` is frozen:

- **Path and arguments.** `dist/scripts/reset-password.js <username>` in the `prod` image, and
  `scripts/reset-password.ts` through `ts-node` in dev. There are no flags.
- **Input.** Exactly two stdin lines: the password, then its confirmation. The script rejects an
  empty password or a mismatch before it writes anything.
- **Exit code.** 0 only when every applicable target was updated. Otherwise it is non-zero.
- **Output.** One line per target (app, then qBittorrent and Prowlarr for the admin), in Spanish
  since an operator reads it, each saying whether that target was updated or failed and why. The
  password itself is never printed.
- **The command always writes.** It never skips qBittorrent or Prowlarr because they look
  "already configured". The Prowlarr init script does skip in that case, and an implementer will
  be tempted to copy that. Do not: a reset that skips leaves the old password in place.
- **Scope.** A username other than `ADMIN_USER` touches the app only.

## Migrations

None.

## Risks

- **qBittorrent answers 200 without applying the change.** `setPreferences` ignores a malformed
  or unknown payload and still answers 200. Defence: the script reads the preferences back after
  the write, a mismatch counts as a failure, and there is a unit test for it.
- **Prowlarr's password and confirmation disagree.** Both fields are built from the same value,
  and a unit test asserts it.
- **A partial write reported as success.** For example, the app is updated but Prowlarr is down.
  Defence: each target yields a result, the exit code is the AND of all of them, and a re-run
  converges because each write is idempotent (NFR-3).
- **The dev loop gets locked out.** `bin/dbreset` recreates the admin row, and without
  `ADMIN_PASSWORD` that row has no usable password. So `bin/dbreset` now ends by running
  `bin/reset-password "$ADMIN_USER"`, and `bin/install`, which calls `dbreset`, feeds it the
  password it asked for.
- **The window on a fresh install.** Between `api`'s first boot and the reset step, no one can log
  in, qBittorrent has a temporary password and Prowlarr has no forms auth yet. This is expected
  and lasts seconds. If the reset step fails, the installer exits non-zero and prints the retry
  command (NFR-5).
- **An existing installation.** Compose stops passing the three variables, so the init scripts see
  them unset and leave the stored passwords alone. Logins behave as today (NFR-1, AC-8).

## Verification

```bash
bin/npm api run test
bin/cli api npx --no tsc --noEmit
git status --short services/api/prisma
```

Expected: tests green, including the new `shared-login.spec.ts`; 0 typecheck errors; only
`prisma/seeds/users.ts` modified.

Manual pass:
- AC-1 to AC-3: `install.sh` into an empty directory, then log into all three UIs.
- AC-4: `docker compose restart torrent indexer api`, then check `docker compose logs` for any
  `vacío` line.
- AC-5: `docker compose stop indexer`, run the reset command (expect a non-zero exit that names
  Prowlarr), `docker compose start indexer`, re-run it.
- AC-6 and AC-7: a mismatched or empty password, and a non-admin user.
- AC-8: an old `.env` with the variables still present, then `docker compose pull && up -d`.
- AC-9: `bin/reset-password admin` on the dev stack.
- AC-10: `ps aux` inside `api` while the prompt is waiting.
