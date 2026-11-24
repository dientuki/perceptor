---
title: Apply last-owner teardown to every title a removed user held alone
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/users/remove-user-orphans-titles-and-in-flight-sources-with-no-unwind
audit_verdict: confirmed
severity: low
priority: 33
---

# SPEC (draft): Apply last-owner teardown to every title a removed user held alone

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local
> harness (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit
> `2a3976a`.
> Evidence: `run-3/agents/v-api-users-remove-user-orphans-titles-and-in-flight-sources/artifacts/evidence/orphan.log`
> (the Prisma fake models the `UserMovie` cascade; no real database cascade was run).
> Touches the same `UsersService.remove` as spec 06 (session revocation on removal); implement
> together. Spec 53 covers auto-acquisition for a disabled user's titles.

## Context & Goal

`removeUser` (`users/users.resolver.ts:44-49`, admin-only) calls `UsersService.remove`
(`users/users.service.ts:120-138`), which checks self-deletion and the last admin and then runs a
bare `prisma.user.delete` (`:135`). The schema cascades the join rows only: `UserMovie.user` and
`UserShow.user` are `onDelete: Cascade` (`prisma/schema.prisma:139`, `:162`). `Movie`/`Show`,
`MediaSource`, `ProcessJob` and season upload sessions are untouched.

Spec 067 defined what happens when the last owner removes a title: `MoviesService.remove`
(`movies/movies.service.ts:342-357`) and `ShowsService.remove` (`shows/shows.service.ts:446`) call
`DownloadsService.unwindSourcesForTitle` (`downloads/downloads.service.ts:1096`; call sites
`movies.service.ts:354`, `shows.service.ts:458`) and then delete the title. User removal never does this. A title the removed user
owned alone therefore becomes ownerless while its qBittorrent torrents, queued or running encodes and
open upload sessions keep going.

No one can then reach those sources: every control (`downloadStop`/`downloadDelete`, `encodeJob*`,
`finishSeasonUpload`) goes through an ownership lookup such as `findOwnedSource`
(`downloads.service.ts:591-607`), which requires the title's `users` relation to contain the caller.
With no `UserMovie`/`UserShow` rows every caller, admin included, gets `error.source.not_found`. The
verifier observed exactly that: after `remove`, the movie row and its `DOWNLOADING` source persisted,
`UserMovie` links were 0, and `downloadDelete` was refused for the admin and for the former owner.

One escape exists: `MoviesService.register` joins an existing `Movie` by `tmdbId` (`:210-211`), so a
user who adds the same title again becomes its owner and regains control. Nothing tells anyone to do
so. Impact is resource use (bandwidth, disk, the single encode slot) outside anyone's control; no
cross-user disclosure or privilege change.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Last-owner teardown)**: Before deleting the user, `UsersService.remove` finds every
      `Movie` and `Show` whose only owner is that user and, for each, runs the same path as
      `MoviesService.remove`/`ShowsService.remove` for a last owner: `unwindSourcesForTitle`, then
      delete the title.
- [ ] **REQ-2 (Shared titles)**: A title another user still holds only loses the removed user's
      link (the existing cascade), as `removeMovie`/`removeShow` do for a non-last owner.
- [ ] **REQ-3 (Failure semantics)**: [NEEDS CLARIFICATION: 067 aborts a title removal with nothing
      removed if the batched torrent-client call fails. Should one failed unwind abort the whole
      user removal (user kept, error returned), or should the user still be removed and the failed
      titles left as today?]
- [ ] **REQ-4 (Admin reachability)**: [NEEDS CLARIFICATION: should an administrator also get a way
      to stop or delete a source whose title has no owner (orphans that already exist, or that a
      failed REQ-3 leaves), or is REQ-1 plus re-adding the title enough?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Article XII)**: The teardown reuses `unwindSourcesForTitle` unchanged; it removes
      downloads-side residue only and never touches the library.
- [ ] **NFR-2 (Ordering)**: Sole ownership is decided inside the same transaction or under the same
      guard that deletes the user, so a concurrent `addMedia` of the same title by another user is
      not torn down.
- [ ] **NFR-3 (Scale)**: Per `deployment-scale` (about 5 users), unwinding titles one by one is
      acceptable; no batching beyond what `unwindSourcesForTitle` already does is required.

## GraphQL Contract Delta

None if REQ-3 keeps the current return type. If REQ-3 aborts, a new i18n error key (for example
`error.user.remove_unwind_failed`) is added to `docs/spec/graphql-contract.md`.

## Data Model Changes

None. Existing orphaned titles are not migrated by this spec (see REQ-4).

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: With the verifier's harness (real `UsersService`/`DownloadsService`,
      Prisma fake modelling the `UserMovie` cascade), user A solely owns a movie with a
      `DOWNLOADING` source; an admin removes A. Today the movie and source persist, no teardown call
      is made, and `downloadDelete` by the admin returns `error.source.not_found`. After the fix
      `unwindSourcesForTitle({ movieId })` is called, the movie and source are gone, and qBittorrent
      received the remove for the source's hash.
- [ ] **AC-2**: Same for a series with an episode source and an open season upload session.
- [ ] **AC-3**: A title also owned by user B keeps its sources; only A's link is removed.
- [ ] **AC-4**: Removing a user who owns nothing behaves as today (self and last-admin guards
      unchanged).

## Out of Scope

- **Ending the removed user's sessions** — spec 06. **Auto-acquire after disabling a user** — spec 53.
- The user's TMDB list imports (`109`) and preferences, which cascade with the user row.
- The library file of a delivered title (Article XII).
