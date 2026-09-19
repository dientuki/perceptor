---
title: Admin Password Off .env — infra slice
service: infra
last_updated: 2026-09-19
status: Approved
---

# PLAN: Admin Password Off .env — `infra` (`infra/plan.md`)

## Scope

`infra` does four things in this feature:
- makes torrent and indexer boot with no password in their environment;
- stops `docker-compose.yaml` and `.env.example` from carrying the three password variables;
- makes both installers set the password through `api`'s command instead of `.env`;
- keeps the dev reset loop usable.

It does **not** implement the password push to qBittorrent and Prowlarr. That is `api`'s
`reset-password` command. `infra` only calls it, with the CLI contract frozen in `../plan.md`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/torrent/custom-cont-init.d/10-qbittorrent-password` | Modified | Empty `QBITTORRENT_PASSWORD`: log that the stored password is kept, then `exit 0`. Set: unchanged |
| `services/indexer/custom-services.d/10-prowlarr-credentials` | Modified | Empty `INDEXER_PASSWORD`: log it, then `exec sleep infinity` before any wait loop. Set: unchanged |
| `docker-compose.yaml` | Modified | Drop `ADMIN_PASSWORD` from `api`, `QBITTORRENT_PASSWORD` from `torrent`, `INDEXER_PASSWORD` from `indexer`. `ADMIN_USER` stays on `api` |
| `.env.example` | Modified | Remove `ADMIN_PASSWORD`, `INDEXER_PASSWORD`, `QBITTORRENT_PASSWORD` |
| `install.sh` | Modified | Password kept in a shell variable only; set through the command after `SERVICE_TOKEN`; the final message prints the reset command |
| `bin/install` | Modified | Always asks for the password; sets it after `bin/dbreset`, before `docker compose stop`; prints the reset command |
| `bin/dbreset` | Modified | Ends with `bin/reset-password "$ADMIN_USER"`, run interactively |
| `bin/reset-password` | Unchanged in form | Still `bin/cli api npx ts-node scripts/reset-password.ts "$@"`, the same source as the compiled command. Verify only |

## Existing code to reuse

- `install.sh`:
  - `set_env_var`, `ensure_env_var` and `env_var_is_empty` (never used for the password now).
  - The `SERVICE_TOKEN` block's "error, retry command, exit 1" shape, for NFR-5.
  - The `fresh_install` flag, which gates the question and the reset step so repair mode does
    neither (NFR-1).
- `bin/install`: its `docker compose exec -T api …` pattern for a non-interactive exec, and the
  way it reads `.env` values with `grep | cut`.
- `.claude/agents/infra.md`'s rule: operator-facing prompts and messages are in Spanish.

## Steps

1. **`10-qbittorrent-password`.** Turn the empty-password branch from an error `exit 1` into an
   informational log and `exit 0`. Leave the `CONF_PATH` check and the hashing path as they are.
2. **`10-prowlarr-credentials`.** Move a new empty-password check to the top, before the
   `config.xml` wait. It logs and runs `exec sleep infinity`. The rest is unchanged.
3. **`docker-compose.yaml` and `.env.example`.** Remove the three variables, plus any comment
   that describes the interpolation.
4. **`install.sh`.**
   1. In the `fresh_install` block, keep the `read -rsp` loop that rejects an empty password.
      Also ask for confirmation, since the command needs two lines. Drop `set_env_var
      ADMIN_PASSWORD`.
   2. After the `SERVICE_TOKEN` block, and only when `fresh_install` is true, run
      `printf '%s\n%s\n' "$admin_password" "$admin_password" | docker compose exec -T api node
      dist/scripts/reset-password.js "$ADMIN_USER"`.
   3. On a non-zero exit: print the command's own output, then the retry line `docker compose
      exec api node dist/scripts/reset-password.js <ADMIN_USER>`, then `exit 1`. `.env` still
      has no password.
   4. `unset admin_password` afterwards.
   5. The final message adds a line saying that to change or recover the password, run the exact
      `docker compose exec api node dist/scripts/reset-password.js <ADMIN_USER>` (REQ-7).
   6. Repair mode on an old `.env` that still has the variables: do not strip them, per NFR-1.
5. **`bin/install`.**
   1. Ask for the password (with confirmation) every run, since it always ends with `dbreset`.
   2. After `bin/dbreset` and before `docker compose stop`, pipe it with `printf` into
      `docker compose $COMPOSE_FILES exec -T api npx --no ts-node scripts/reset-password.ts
      "$ADMIN_USER"`.
   3. Abort on failure with the retry command, then print the reset command at the end.
   4. `bin/install` calls `bin/dbreset`, and step 6 makes that prompt too. Add a way to skip it,
      such as an environment variable read by `dbreset`, or have `bin/install` do the reset
      itself rather than through `dbreset`. The implementer picks the simpler of the two, as long
      as the operator is asked for the password once, not twice.
6. **`bin/dbreset`.** After Redis `FLUSHALL`, read `ADMIN_USER` from `.env` and run
   `bin/reset-password "$ADMIN_USER"`, with the skip condition from step 5.4.
7. **`bin/reset-password`.** Run it once against the dev stack to confirm it prompts and reports
   one line per target.

## Contract obligations

This slice consumes the CLI contract frozen in `../plan.md` § Contract Freeze:
- `dist/scripts/reset-password.js <username>` in `prod`, `scripts/reset-password.ts` through
  `ts-node` in dev;
- exactly two stdin lines;
- exit 0 means all three targets updated, and anything else is a failure to report and abort on;
- the command prints its own per-target lines, so the installer shows them rather than
  summarising.

If the contract is wrong, stop and report. Do not adapt it here.

## Tests

There is no shell test suite in this repository, so nothing new is owed a unit test. Coverage is
the manual pass in `../plan.md` § Verification:
- AC-1, AC-2 and AC-3 for `install.sh`;
- AC-4 for boot without the variables;
- AC-8 for an existing installation;
- AC-9 for `bin/reset-password`.

Also run `docker compose config -q` after the compose edit, to confirm no dangling interpolation
is left.
