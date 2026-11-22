---
title: Pin ffmpeg/ffprobe input protocols for torrent-supplied media
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [worker]
source_finding: worker/ffmpeg/no-protocol-whitelist-on-untrusted-media-input
audit_verdict: needs_validation
priority: 25
---

# SPEC (draft): Pin ffmpeg/ffprobe input protocols for torrent-supplied media

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).

## Context & Goal

The scan accepts any torrent file by extension only (`scan/scan-folder.ts:34`, `isVideoFile`).
Every ffprobe and ffmpeg call then opens it as a plain input: `getMetadata` runs
`ffprobe -v error -show_format -show_streams -of json <path>` (`ffmpeg/metadata.ts:12`),
`buildFfmpegCommand` starts with `-i input` (`ffmpeg/buildCommand.ts:41`, run at
`ffmpeg/runner.ts:135`), and the same pattern appears in dub-trim, grain-probe, subtitle-prune and
audio-variant. Grep finds no `-f`, `-protocol_whitelist` or `-allowed_extensions` anywhere in the
worker.

libavformat picks the demuxer by content sniffing, so a file named `.mkv` whose body is an
`#EXTM3U` (HLS) or concat-style playlist might be demuxed as such and make the worker request
`http`/`file` URIs from inside `perceptor-net` (api, redis, qBittorrent, Prowlarr). The attacker
only needs to get a torrent added. Whether the Alpine ffmpeg (`worker/Dockerfile:29`, unpinned)
blocks this by default (nested-protocol whitelist, HLS extension checks) is **not established**, so
impact is unproven; this spec makes the answer irrelevant.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Protocol whitelist)**: Every ffmpeg/ffprobe invocation whose input is a library or
      downloaded file passes `-protocol_whitelist file` before its `-i` (ffprobe: before the
      path), through one shared helper so a new call site cannot omit it.
- [ ] **REQ-2 (Container allow-list)**: [NEEDS CLARIFICATION: also pin `-f matroska,mp4,mov,avi,mpegts`
      (probe-then-force)? It blocks text-playlist demuxers but must keep every container a release
      can legitimately use, including `.m2ts`, `.ts`, `.wmv`, `.iso`-extracted and Blu-ray `.mpls`
      output assembled by mkvmerge. Whitelisting alone may be enough.]
- [ ] **REQ-3 (Refusal is a normal failure)**: A file that fails under the whitelist surfaces as the
      existing `error.encode.probe_failed` / encode failure, never a crash.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No regression)**: The corpus in `services/worker/ffmpeg/` still probes and encodes
      identically; argv tests are updated, not weakened.
- [ ] **NFR-2 (Defence in depth, not a substitute)**: Egress/network policy for the worker container
      is an infra matter and is out of scope here; deployment can confirm the published image's
      ffmpeg version.

## GraphQL Contract Delta

None. No new key; reuses existing probe/encode failure keys.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduce first)**: With the worker image on a dummy stack, a `.mkv` containing an
      `#EXTM3U` playlist that points at a loopback HTTP listener is run through `getMetadata`'s exact
      argv; record whether the listener receives a request today. If it does not, the finding is
      closed as not exploitable and REQ-1 stays as hardening.
- [ ] **AC-2**: After the fix the same file produces a probe failure and the listener sees nothing.
- [ ] **AC-3**: A unit test per call site (probe, encode, dub-trim, grain-probe, subtitle-prune,
      audio-variant, library/subtitle probes) asserts the whitelist flag precedes `-i`.
- [ ] **AC-4**: Normal mkv, mp4, avi, ts, m2ts and a Blu-ray assembly still scan, probe and encode.

## Out of Scope

- Worker network egress policy and ffmpeg version pinning (infra).
- Confinement of scan paths to the source folder (spec 03) and size/regex bounds (specs 23, 24).
