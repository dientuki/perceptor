---
title: Comment Locator Convention — worker slice
service: worker
last_updated: 2026-10-03
status: Implemented
---

# PLAN: Comment Locator Convention — `worker` (`worker/plan.md`)

## Scope

You sweep the comments in `services/worker/src`: roughly **200 Spanish comment lines** and **124
ad-hoc spec references, 110 of them with no spec number on their line**. One Spanish `it(...)`
string (REQ-12). And three passages in `services/worker/CLAUDE.md` that instruct the next reader to
preserve comments this sweep removes (REQ-13) — yours is the only service whose own documentation
actively contradicts this feature.

You do **not** build the validator (`infra` owns `tools/comments/`) and you do **not** touch the
root `CLAUDE.md`, `docs/constitution.md` or `docs/spec/history.md`. Writes are confined to
`services/worker/`.

This slice carries the feature's sharpest judgement call, concentrated in one file: `ffmpeg/runner.ts`
alone holds 58 Spanish comment lines, and several of them are true, load-bearing, and in no spec.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/ffmpeg/runner.ts` | Modified | 58 lines, the heaviest file in the service. Includes the REQ-4-plus-test case below. |
| `src/encode/encode.mock.ts` | Modified | 25 lines. |
| `src/paths/build-output-path.ts` | Modified | 18 lines. Destination layout — most of this resolves to `Spec 048`, `Spec 072`. |
| `src/encode/encode.ffmpeg.ts` | Modified | 18 lines. |
| `src/index.ts` | Modified | 17 lines — the two-`Worker` rationale `services/worker/CLAUDE.md:21` tells you not to collapse. See § Existing code to reuse. |
| `src/jobs/encode.job.ts` | Modified | 11 lines. |
| `src/scan/scan-folder.ts` | Modified | 8 lines. |
| `src/ffmpeg/buildCommand.ts` | Modified | 8 lines. |
| `src/api/graphql-client.ts` | Modified | The top comment `services/worker/CLAUDE.md:375` points at. |
| `src/jobs/cleanup-source.ts` | Modified | The top comment `services/worker/CLAUDE.md:410` points at. |
| `services/worker/CLAUDE.md` | Modified | REQ-13: the three passages naming comments as the place the reasoning lives. |

## Existing code to reuse

The procedure, identical to the other slices and non-negotiable (see `../plan.md` § Risks, row 1):
`git blame -L <line>,<line> --porcelain <file> | grep '^summary'` resolves a bare reference to its
`implement NNN spec` commit; the spec's own text then has to confirm the id describes this code;
anything unresolved is **deleted** under REQ-4, never guessed.

Specific to this service:

- **`src/index.ts` and `services/worker/CLAUDE.md:21`.** That line reads "The reasoning is in the
  comments in `index.ts` — don't collapse them." It is a standing instruction to the next agent not
  to do what this feature asks, and it is the exact drift the feature closes. The reasoning —
  an encode runs for hours, a shared queue at `concurrency: 1` either blocks every scan behind
  FFmpeg or risks N simultaneous FFmpegs — is already written, in English, in `CLAUDE.md` itself,
  three lines above. So the comments collapse, the document keeps the prose, and that sentence is
  rewritten to say the reasoning is in `CLAUDE.md`. Do not delete the `CLAUDE.md` paragraph.
- **`process.umask(0o002)`** at the top of `index.ts` is load-bearing (`2775`/`664` over the setgid
  library directories). `CLAUDE.md` says so in English. The comment goes; the document keeps it.
  If no spec covers it, this is a REQ-4 deletion whose knowledge already survives in a document —
  no test owed.
- **`src/api/graphql-client.ts`** — `CLAUDE.md:375` says "the comment at the top says why". The why
  (a worker that swallowed a GraphQL error would mark the job completed without writing anything)
  is this service's central failure mode and is already stated in `CLAUDE.md` § *Errors must not be
  swallowed*. Collapse the comment, rewrite the `CLAUDE.md` sentence to stop pointing at it.
- **`src/jobs/cleanup-source.ts`** — same shape, `CLAUDE.md:410`: "The reasoning is written as a
  comment at the top of the file itself." Same resolution.
- **`src/ffmpeg/runner.ts:100`, the one that owes a test.** Docker sends `SIGTERM` on
  `docker compose stop`/`restart`, not `SIGINT`; the old runner listened on `SIGINT` alone, so a
  stop orphaned the FFmpeg child. `047-source-deletion` mentions both signals exactly once, in its
  Context, and only to say that process signals are shutdown rather than per-job cancellation —
  there is no requirement to point at. So: delete the comment, **write the test** (§ Tests). This is
  the Article IX class exactly: an orphaned FFmpeg burns a core after the container is gone, with no
  log line anywhere.
- **`src/ffmpeg/cases.spec.ts` and the `ffmpeg/*.json` corpus** are not yours to re-record. If a
  comment inside the corpus fixtures looks Spanish, report it — the corpus is the `ffmpeg` agent's
  territory and regenerating it is how the three long-standing `src/ffmpeg/` failures came back
  last time.

## Steps

1. `bin/comments worker`. The output is the worklist.
2. Per finding: blame → confirm the requirement sentence → `// Spec NNN, <ref>`; otherwise delete.
3. `runner.ts` last, not first. It is a third of the slice and the only file with a test obligation;
   do it once the grammar is in your hands from the easier files.
4. REQ-12: the one Spanish `it(...)`/`describe(...)` string, rewritten in English. The test count
   must not move.
5. REQ-13: the three `services/worker/CLAUDE.md` passages above. Each one stops pointing at a
   comment and either carries the prose itself or points at the spec.
6. Run the NFR-1 code-change guard from `../plan.md` § Verification over your own diff and account
   for every line it prints. `runner.ts` is where a comment deletion is most likely to take a line
   of signal-handling code with it.
7. **Report the resolution table**: `file:line`, blame commit subject, locator written, first line
   of the requirement it points at. Plus a separate short list of every REQ-4 deletion whose
   knowledge you judged load-bearing, and what you did with it (test, `CLAUDE.md`, or URL).

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None**. The job payload contract (`SourceReadyJob`,
`EncodeJobDetails` and the `bull:process`/`bull:encode` job names) is untouched: it is a second
contract of the same kind, retyped by hand on both sides with no codegen, and a comment sweep has no
business near it. `src/api/graphql-client.ts` keeps throwing on `json.errors` — you are editing the
comment above that behaviour, never the behaviour.

**No production code changes.** `bin/npm worker test` reports the same counts as before, plus the
step-3 test.

## Tests

- `src/ffmpeg/runner.spec.ts` — **new**, and the only test this feature requires anywhere. There is
  no suite over `runner.ts` today. Follow `src/encode/cancellation.spec.ts`, the nearest sibling:
  **vitest**, not jest (`import { describe, expect, it } from 'vitest'`), with the Article IX header
  paragraph first. It is owed because it
  defends against the runner registering a shutdown handler on `SIGINT` alone: Docker's `docker compose stop` and `restart` signal `SIGTERM`,
  so a `SIGINT`-only runner leaves the FFmpeg child alive after its own container exits, burning a
  core indefinitely with the job gone from the queue and no error in any log. Assert that both
  `SIGINT` and `SIGTERM` are registered and that each kills the active child; the header paragraph
  names that failure (Article IX, Article XI exception 2).

Nothing else in this slice is owed a test. A comment executes nothing, and every other REQ-4
deletion in this service either resolves to a spec (the knowledge is in the spec), to a public URL
(Article XI exception 1), or to a paragraph already written in `services/worker/CLAUDE.md`.

## Done when

```bash
bin/comments worker                        # 0
bin/cli worker npx --no tsc --noEmit       # 0 errors
bin/npm worker run build                   # exits 0
bin/npm worker test                        # same counts as before, plus the runner test
grep -n "don't collapse them" services/worker/CLAUDE.md   # nothing
```

Plus the resolution table and the load-bearing-deletion list in your report, and the code-change
guard accounted for line by line.
