---
description: Execute a feature's tasks by dispatching each to its service subagent
argument-hint: [NNN or slug — defaults to the most recent feature]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, Skill, TaskCreate, TaskUpdate, AskUserQuestion
---

Implement feature **$ARGUMENTS** (if empty, the highest-numbered directory in
`docs/spec/features/`).

You are the **orchestrator**. You dispatch; the service subagents write code. Your own edits are
limited to `tasks.md`, the `[docs]` tasks, and the feature's own files.

## 1. Load

Read `spec.md`, `plan.md`, every `<svc>/plan.md`, and `tasks.md`. All must be `Approved`. Set
`tasks.md` to `status: In Progress`.

Mirror the task list into the session task tracker so progress is visible.

## 2. Dispatch, respecting the order

Walk the groups in order. Within a group, dispatch every unblocked task; run the `[P]` ones in
parallel by putting multiple Agent calls in a single message.

Route by tag: `[api]` → the `api` agent, `[web]` → `web`, `[worker]` → `worker`, `[infra]` →
`infra`. `[docs]` you do yourself.

**Never dispatch an `[infra]` task to a service agent.** Those tasks live in
`docker-compose.yaml`, `.env.example`, `bin/` and `services/*/Dockerfile` — outside every service
agent's scope. Handing one to the `api` agent because it "looks like api config" is precisely the
boundary violation the agent definitions exist to prevent, and the agent is instructed to stop and
report rather than comply.

**How to actually dispatch.** Try `subagent_type: "<service>"` first. If that fails with
`Agent type '<service>' not found`, the session is hosted in an environment that does not discover
`.claude/agents/` from the filesystem (the Claude Code desktop app does not; the CLI does). Fall
back to `subagent_type: "general-purpose"` and open the prompt with:

> You are acting as the `<service>` subagent for the Perceptor project. Read
> `/home/dientuki/www/perceptor/.claude/agents/<service>.md` FIRST and treat it as your operating
> instructions — it defines your role, your scope, your obligations and your report format. Follow
> it exactly.

This is verified to work: the agent reads its brief and honours the scope boundary. The one thing
the fallback loses is the `tools:` restriction in the frontmatter, so the agent has the full
toolset and its scope rests entirely on the instructions — which makes step 3's verification of
the diff more important, not less.

Every dispatch must also give the agent:

- the feature directory path, and instructions to read `spec.md`, `plan.md` and its own
  `<svc>/plan.md` before starting;
- the exact task IDs it owns in this batch, with their *Done when* lines quoted;
- the reminder that the GraphQL Contract Delta is **read-only** — if it is wrong, stop and report.

Never hand an agent a task tagged for a different service, and never ask one to "also just fix"
something outside its directory. The scope rule in the agent definition is an instruction, not a
sandbox — the real guarantee is that you do not ask.

## 3. After each batch

Read the agent's report and verify it rather than trusting it:

- Do the files it claims to have changed actually differ? (`git status`, `git diff --stat`)
- Did the commands it ran actually pass? If it reported a typecheck count, does it hold?
- Tick the boxes in `tasks.md` only for tasks that are genuinely done.

If an agent reports **blocked**, do not reassign the task to another agent to route around it. Add
a row to the `## Blocked` table in `tasks.md`. If it is a contract problem, **stop the whole
feature** — Constitution, Article VIII. Amending the frozen delta means going back to `spec.md`,
re-approving, and re-briefing every service. Use AskUserQuestion to get the decision.

## 4. Close

When every task is ticked:

- Confirm the regenerated `services/api/src/schema.gql` diff matches the `## GraphQL Contract
  Delta` in `spec.md`. A difference means either an unreported contract change or a stale spec —
  resolve it, do not close over it.
- Walk the acceptance criteria yourself, ticking each one only after seeing it hold.
- Flip `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`; `status: Done` on
  `tasks.md`.
- Do the `[docs]` tasks: the root `CLAUDE.md` pipeline table if a stage changed status, the
  service's own `CLAUDE.md` if a convention changed.

Walking the criteria is where this command earns its keep: a criterion you cannot observe holding
stays unticked, and step 5 is where you write down what it is waiting on. Never tick one because
its task is done — that is exactly the drift `docs/spec/pending-acs.md` exists to measure.

## 5. Record what was measured, and what still is not

Two documents close a feature, and neither one is optional:

- **`docs/spec/history.md`** — append a new entry **at the top**, never edit the root `CLAUDE.md`
  for this (REQ-11 of `086-comment-locator-convention`). Re-measure with the commands at the top of
  that file: the test counts per service, the typechecks, the migrations applied, the GraphQL
  contract diff. Record the real numbers, including a failure.
- **`docs/spec/pending-acs.md`** — run `/pending-acs <NNN>`. Step 4 above ticked every criterion you
  saw hold; this records what is still unticked and **why**, which is the part a bare `[ ]` cannot
  say. If the feature closed every box, its row disappears from that document and you say so.

Run them in that order — `/pending-acs` reads the ticks step 4 just wrote.

## 6. Report

What shipped, per service. Every command actually run and its real output — a failing test is
reported as failing, with the output. What is still blocked and why. What you noticed along the
way that was out of scope.

Do not commit unless the user asks.
