---
title: Subtitle Embed Trailing Cues
spec_version: 0.1.1
author: Juan "Dientuki" Farias
created_at: 2026-11-17
last_updated: 2026-11-17
status: Draft
services: [worker]
---

# SPEC: Subtitle Embed Trailing Cues (`spec.md`)

> Draft. Records a production bug found on 2026-11-17; the requirements are a starting point to
> be widened before `/plan-feature`. It stays `Draft` on purpose: a second fix will be added to it.

## Context & Goal

An accepted subtitle can fail to embed even though its sync was measured and accepted. Production
search #328 (Chernobyl S01E01 "1:23:45", episode 1050) accepted the English candidate
`Chernobyl.S01E01.WEBRip.x264-TBS` with an offset of +3090 ms, and the embed it queued (#178) failed
with `error.subtitleEmbed.verify_failed`: "duration differs from the original by more than 1 s". The
search ended `FAILED` and the file got no English track.

The cause is in the worker's embed path. `normalizeSrt` (`services/worker/src/subtitles/normalize-srt.ts`)
shifts every cue by the offset and drops only cues that end at or before zero; a cue that ends after
the video's own end is kept as is. mkvmerge then extends the container to the end of that cue, and
`verifyEmbed` (`services/worker/src/subtitles/verify-embed.ts`, spec `101` REQ-9/REQ-10) refuses a
result whose duration moved by more than 1 s. The library file is 3534.67 s long; reproduced in the
worker container on a temporary copy, a single cue ending at 58:58 turns the remuxed file into
3538 s. A positive offset makes this likely, since a subtitle timed for a release with a few more
seconds at the end (or one carrying a trailing credit/advert cue) is pushed past the end of the
encoded file.

The same function serves every embed — the automatic and manual search (`103`/`106`/`107`), the
sidecar embed (`101`) and its automatic offset (`113`) — so all of them can hit this. Once this
ships, a cue that falls past the end of the video no longer changes the file's duration, and the
1 s verification keeps guarding against a remux that truly altered the video or audio.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Drop cues past the end)**: Must leave out of the embedded track every cue whose
      shifted start is at or after the end of the video file being embedded into.
- [ ] **REQ-2 (Clamp the last cue)**: Must end at the end of the video any cue that starts before
      it and ends after it.
- [ ] **REQ-3 (Unknown duration)**: Must embed cues unchanged when the file's duration cannot be
      read, leaving the existing verification to decide.
- [ ] **REQ-4 (Verification unchanged)**: The 1 s duration check of spec `101` REQ-9 must stay as
      it is; this feature removes a false failure, it does not loosen the guard.

[NEEDS CLARIFICATION: should a track that loses more than a given share of its cues to REQ-1 be
treated as a bad match (rejected) instead of embedded trimmed?]

[NEEDS CLARIFICATION: should the sync acceptance of spec `103` also look at cues past the end, so a
candidate like this one is weighed before it is downloaded and embedded?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Worker only)**: Must not change the GraphQL contract, the Prisma schema or `api`.
- [ ] **NFR-2 (Every embed path)**: The rule applies to every caller of the embed — search,
      manual search, sidecar embed and automatic offset alike.

## GraphQL Contract Delta

None — this feature does not cross the service boundary. The worker already reads the original
file's metadata before the remux; the change is inside how it writes the subtitle it embeds.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given a subtitle whose last cue, after the offset, ends 3 s after the end of the
      video, when it is embedded, then the embed completes and the file's duration differs from the
      original by at most 1 s.
- [ ] **AC-2**: Given a subtitle with a cue that starts after the end of the video, when it is
      embedded, then the embedded track does not contain that cue.
- [ ] **AC-3**: Given the production case (Chernobyl S01E01, episode 1050), when the manual
      "Buscar subtítulos" search is run again, then the accepted English track is embedded and the
      search does not end with `error.subtitleEmbed.verify_failed`.
- [ ] **AC-4 (failure path)**: Given a remux that really changes the video duration by more than
      1 s, when it is verified, then it still fails with `error.subtitleEmbed.verify_failed` and the
      library file is untouched.

## Out of Scope

- **Spanish in the same search.** Search #328 also rejected its three Spanish candidates as
  `error.subtitleSearch.wrong_variant` (all read as es-ES while the user wants es-419). That is
  spec `118` working as designed; a fallback to the other variant would be an amendment to `118`,
  not part of this bug.
- **Loosening the 1 s threshold.** It guards against a remux that lost or changed real media.

## Amendments

### 0.1.1 — fix applied (2026-11-17)

REQ-1, REQ-2 and REQ-3 are implemented in the worker, not yet released or verified in production
(AC-3 is still open):

- `normalizeSrt` (`services/worker/src/subtitles/normalize-srt.ts`) takes an optional fourth
  argument, `maxEndMs`. After the offset, a cue whose start is at or after it is dropped and a cue
  that ends after it ends at it. A missing, non-finite or non-positive value disables the rule.
- `handleSubtitleEmbed` (`services/worker/src/jobs/subtitle-embed.job.ts`) passes the original
  file's `format.duration` (seconds, times 1000), the one it already read before the remux.
- `verifyEmbed` is untouched (REQ-4); no contract, schema or `api` change (NFR-1). NFR-2 holds
  because every embed goes through `handleSubtitleEmbed`.
- Tests: three cases in `normalize-srt.spec.ts` (drop, clamp, unknown duration). AC-1 and AC-2 are
  covered at unit level; AC-3 needs a real run after release.
- The two `[NEEDS CLARIFICATION]` questions above are unchanged; the fix trims silently.
