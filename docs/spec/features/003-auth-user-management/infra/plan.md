---
title: Admin User Management — infra slice
service: infra
last_updated: 2026-08-10
status: Implemented
---

# PLAN: Admin User Management — `infra` (`infra/plan.md`)

## Scope

This slice is one file: `bin/reset-password`, the wrapper REQ-7 requires (`bin/` wrapper table in
the root `CLAUDE.md`). It does not touch `services/api/scripts/reset-password.ts` itself — that
script belongs to `api/plan.md` and must exist and work non-interactively (see that plan's
§ Remaining work) before this wrapper can be verified end-to-end.

This is also the first task this feature's own agent, `infra`, implements — see `../spec.md`'s
§ *Process note: `bin/` has no owner*, resolved by creating that agent.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `bin/reset-password` | New | Wraps `scripts/reset-password.ts` through the running `api` container |

## Existing code to reuse

- `bin/cli` — `docker compose exec -it "$CONTAINER" "$@"`. Every wrapper in `bin/` that needs an
  interactive session inside a container goes through this, unmodified.
- `bin/npm` — the closest sibling in shape (a thin `bin/cli` wrapper with argument forwarding), for
  style: no flag-parsing framework, a `#!/bin/bash` shebang, executable bit set.

## Steps

1. Write `bin/reset-password`:
   ```bash
   #!/bin/bash
   bin/cli api npx ts-node scripts/reset-password.ts "$@"
   ```
2. `chmod +x bin/reset-password`.
3. Verify against a live stack (see Done when) — this cannot be signed off with a dry read of the
   script; `api/plan.md`'s open issue is exactly that a version of this script hung silently
   instead of erroring, so the wrapper is only trustworthy once actually exercised.

## Contract obligations

None — this slice does not touch GraphQL. `bin/reset-password` talks to the database directly
through the `api` container's Prisma client, the same way `bin/mysql` talks to it directly for
inspection (Constitution, Article III: hand-written SQL/scripts against a running database are for
operational use, not schema changes — this is a data write to an existing row, not a migration).

## Tests

None owed. A one-line shell wrapper with no branching has no silent-failure surface of its own
(Article IX) — any bug here is either "the command doesn't run" (loud) or a bug in
`scripts/reset-password.ts` (owned and tested, in whatever sense that script is tested, by `api`).

## Done when

```bash
bin/reset-password admin
```

prompts for a new password twice, confirms them, writes `Contraseña actualizada para "admin".`, and
that password then works at `/login` (AC-10). Then:

```bash
bin/reset-password doesnotexist
```

prints `Usuario "doesnotexist" no encontrado` to stderr, exits non-zero, and
`bin/mysql -e 'select password from users'` shows no change (AC-11).
