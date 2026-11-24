---
title: Make encode cancellation escalate to SIGKILL when ffmpeg or mkvmerge ignores SIGTERM
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [worker]
source_finding: worker/ffmpeg/runner-cancel-sigkill-escalation-dead-killed-flag
audit_verdict: needs_validation
priority: 58
---

# SPEC (draft): Make encode cancellation escalate to SIGKILL when ffmpeg or mkvmerge ignores SIGTERM

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: the logic defect is source-confirmed, but no case where real ffmpeg or
> mkvmerge outlives SIGTERM (for example a stalled mount) was demonstrated, and attacker control
> over it is unestablished. Line numbers refer to commit `2a3976a`.
> Availability hardening of spec 047's delete-mid-encode guarantee. Spec 26 covers who may publish
> on `encode:cancel`; this spec covers what happens once a cancellation is honoured.

## Context & Goal

`api` publishes on `encode:cancel` when a source is deleted or stopped; the worker's subscriber
calls `cancelEncode(processJobId)` (`worker/src/index.ts:182`), which calls `controller.abort()`
(`encode/cancellation.ts:40`). `runFfmpeg`'s `abortHandler` (`ffmpeg/runner.ts:103-114`) sends
`SIGTERM` to the active child (ffmpeg, or mkvmerge once `activeChild` is reassigned at `:228`) and
arms a timer of `ABORT_KILL_GRACE_MS` (10 s, `:16`) whose `SIGKILL` is guarded by
`!activeChild.killed` (`:109`).

Node sets `ChildProcess.killed` to `true` as soon as `kill()` delivers a signal, so after the
`SIGTERM` at `:107` the guard is always false and `SIGKILL` is never sent. If the child does not exit
on `SIGTERM`, no `close` event fires, the promise never settles, and the encode queue
(`concurrency: 1`, `index.ts:129`) stays blocked until the worker restarts. The same `killed` test
guards the `SIGKILL` in the `process.once('exit')` handler (`:74-76`). The sibling
`runFfmpegCapture` already does it right: `if (child.exitCode === null) child.kill('SIGKILL')`
(`ffmpeg/capture.ts:50`).

The hunter's log (`agents/h-worker-encode-state/artifacts/evidence/runner-sigterm-ignored.log`, not
re-run by the verifier) reports a SIGTERM-trapping fake binary left the promise pending for 17.5 s.
ffmpeg normally exits on SIGTERM, so real impact needs a stalled-I/O condition.

The goal is that a cancelled encode always releases the slot within the grace period plus a bound.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Escalation guard)**: The timer at `runner.ts:108-112` sends `SIGKILL` when the child
      has not exited (`exitCode === null && signalCode === null`), not when `killed` is false — the
      same rule as `capture.ts:50`.
- [ ] **REQ-2 (Current child)**: The escalation targets the child that received the `SIGTERM`, so a
      cancellation during the ffmpeg → mkvmerge hand-off cannot leave either one running.
- [ ] **REQ-3 (Exit handler)**: The `process.once('exit')` handler (`:74-76`) uses the same
      "has not exited" test.
- [ ] **REQ-4 (Settle on timeout)**: [NEEDS CLARIFICATION: if the child still has not closed some
      time after `SIGKILL` (uninterruptible I/O, state `D`), should `runFfmpeg` reject with
      `EncodeCancelledError` anyway and free the slot, leaving a zombie? Or keep waiting, since the
      scratch files may still be held open?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Spec 047)**: A child that exits on `SIGTERM` behaves exactly as today: no `SIGKILL`
      is sent, `EncodeCancelledError` is raised, temps are cleaned, no outcome is reported.
- [ ] **NFR-2 (Timer cleanup)**: The kill timer is cleared on settle, so no `SIGKILL` reaches a
      recycled pid.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: With `spawn` pointed at a stub binary that traps `SIGTERM` and
      sleeps, `runFfmpeg` is aborted; today the promise is still pending after
      `ABORT_KILL_GRACE_MS` + 2 s and the stub is alive. After the fix the stub receives `SIGKILL`
      and the promise rejects with `EncodeCancelledError` within that window.
- [ ] **AC-2**: The same test with the abort landing while mkvmerge is the active child.
- [ ] **AC-3**: A stub that exits on `SIGTERM` receives no `SIGKILL` (NFR-1).
- [ ] **AC-4 (deployment, optional)**: Real ffmpeg reading a FIFO that never delivers data is
      cancelled; record whether it exits on `SIGTERM` alone.

## Out of Scope

- **Authenticity of `encode:cancel` messages** — spec 26.
- **`runFfmpegCapture`** (`capture.ts`) — already escalates correctly.
