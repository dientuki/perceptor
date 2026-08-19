---
title: User Menu — Tasks
last_updated: 2026-08-19
status: Draft
---

# TASKS: User Menu (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

A task is one coherent change an agent can finish and verify on its own. If it cannot be checked
off without also doing something in another service, it is scoped wrong — split it.

## Tasks

### Group 1 — the component

This feature is one file. `plan.md` § Order of Work says so explicitly: trigger, panel contents and
icons are a single rewrite, and staging them would leave the header half-rewritten between steps.
There is no `api` group because there is no contract delta and no migration — `spec.md` § GraphQL
Contract Delta is **None**.

- [ ] **T001** `[web]` Rewrite `services/web/src/components/header/UserDropdown.tsx` per
      `web/plan.md` § Steps: avatar-only trigger with `aria-label="Menú de usuario"` and the
      `dropdown-toggle` class kept; the user's `name` as non-interactive first element of the panel;
      exactly two `DropdownItem` entries (*Editar perfil* with `User` and **no** `href` — a
      destination-less button that only closes the panel, per REQ-7 as amended 2026-08-19 —
      and *Ajustes* → `/settings` with `Settings`); the existing `<form action={logoutAction}>` relabelled
      *Cerrar sesión* with `LogOut`; all five inline SVGs gone, icons at `size={18}` from
      `lucide-react`. Delete the *Account settings* and *Support* entries and the `username` line.
      Do **not** touch `ME_QUERY`, `CurrentUser`, `logoutAction`, `Dropdown` or `DropdownItem`
      (`plan.md` § Contract Freeze).
      *Done when:* `grep -n "<svg" services/web/src/components/header/UserDropdown.tsx` returns
      nothing (AC-6); `bin/cli web npx --no tsc --noEmit` reports **0 errors** (AC-7) and
      `bin/npm web run build` exits **0** (NFR-3) — both counts reported before **and** after the
      edit; `grep -rn "dropdown-toggle" services/web/src/components/header/UserDropdown.tsx` still
      matches.

### Group 2 — verification and docs

Depends on Group 1: there is nothing to verify or document until the component exists.

- [ ] **T002** `[docs]` Update `services/web/CLAUDE.md`. → T001
      The header user menu is no longer TailAdmin scaffolding, which the "UI origin: TailAdmin
      template" section currently implies of everything under `src/components/`. Record: icons in
      this component come from `lucide-react` (no inline SVG); *Editar perfil* deliberately has no
      destination yet — `020-profile-edit` turns it into the trigger of a modal, and no `/profile`
      route exists or will exist; and the `.dropdown-toggle`
      class on any `Dropdown` trigger is load-bearing for `Dropdown.tsx`'s outside-click handler.
      The root `CLAUDE.md` pipeline table is **not** touched — no stage changed status — and its
      "Current state" counts for `web` are unchanged at 0/0.
      *Done when:* `services/web/CLAUDE.md` names `019-user-menu` and the three facts above, and
      `git diff --stat CLAUDE.md` is empty.
- [ ] **T003** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack
      (`bin/dev`, signed in), following `plan.md` § Verification's five-step manual pass — including
      **AC-5**, where clicking *Editar perfil* is expected to land on a 404. Tick each box, then set
      `status: Implemented` on `spec.md`, `plan.md` and `web/plan.md`. → T001
      *Done when:* all seven AC boxes in `spec.md` are `[x]` and all three files read
      `status: Implemented`.

Nothing here carries `[P]`. Three tasks in one service, two of them documentation gated on the
first — there is no independent pair to overlap.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

One thing that would legitimately land here rather than being worked around: if `018-ui-i18n` has
already migrated `UserDropdown.tsx` to translation keys by the time T001 runs, NFR-1's "Spanish
literals" is stale and re-hardcoding them would silently revert that migration (`plan.md` § Risks).
Stop and report; do not choose.
