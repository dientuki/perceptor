---
title: Subtitle Content Pruning
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-10-24
last_updated: 2026-10-24
status: Approved
services: [worker]
---

# SPEC: Subtitle Content Pruning (`spec.md`)

## Context & Goal

Releases often carry several text subtitle tracks in the same language, and today every one that
survives the existing rules reaches the library. `services/worker/src/ffmpeg/params.ts`'s
`getSubtitleParams` decides from `ffprobe` metadata alone (the `ffmpeg` agent's rules S1–S6): a
hearing-impaired track is only recognised when it carries `disposition.hearing_impaired` or says
`SDH`/`CC`/`hearing impaired` in its title, a commentary track is not recognised at all (the audio
rules drop a `commentary` title, the subtitle rules never look), and nothing compares two tracks
with each other.

How to Train Your Dragon (2025), encoded on 2026-09-13, is the case this spec started from. Its
source (`ffprobe_logs` row 38) carried three English SDH text tracks: one titled `BTM SDH` and marked
`hearing_impaired`, which S4 dropped, and two titled only `BTM` with no marking, which reached the
library as byte-identical tracks 5 and 6 (2053 cues, 643 with `[...]`, 174 with an uppercase speaker
label). Library tracks 3 and 4 are the same plain translation run through two different pipelines
(1456 cues each, aligned one-to-one; track 3 has 73 italic cues and straight apostrophes, track 4
none and typographic ones, and starts every cue 7–88 ms later); once markup, quote style and dialogue
dash spacing are normalised, 99.5 % of aligned cues are identical and every difference is
formatting.

The rules were calibrated on 2026-10-24 against five library files, read with the 900 s sample of
REQ-4 (share = annotated cues, music notes excluded, see REQ-5). Source titles come from
`ffprobe_logs` where the row exists (Dragon 38, The Running Man 94, Atomic Blonde 264):

| Title | Library track | Source title | Cues (whole) | Share, sample | Is |
| :-- | :-- | :-- | --: | --: | :-- |
| How to Train Your Dragon (2025) | eng 3 / 4 | `BTM` / `BTM` | 1456 / 1456 | 1.2 % / 1.2 % | plain, same translation |
| | eng 5 / 6 | `BTM` / `BTM` | 2053 / 2053 | 34.7 % / 34.7 % | SDH, unmarked, byte-identical |
| The Help (2011) | eng 2 | — | 1740 | 0 % | plain |
| | eng 3 | `English-SRT-SDH` | 1918 | 17.5 % (brackets only) | SDH, also marked so |
| Wake Up Dead Man (2025) | eng 3 / 4 | — | 2216 / 2529 | 0 % / 30.3 % | plain / SDH, unmarked |
| | spa 5 / 6 | — | 2161 / 2107 | 0.4 % / 0.4 % | two different translations |
| The Running Man (2025) | eng 3 | `BTM`, `forced` disposition | 2353 | 0 % | plain, full length despite the marking |
| | eng 4 | `BTM Commentary`, `comment` disposition | 2642 | 0 % | director's commentary |
| Atomic Blonde (2017) | eng 2 | `forced` | 79 | 0 % (3 cues) | forced; every cue inside track 3 |
| | eng 3 | `full` | 991 | 0 % | plain |
| | eng 4 | `Commentary with Director David Leitch and Editor Elísabet Ronaldsdóttir` | 1851 | 0 % | director's commentary |

Counting `♪` as an annotation would have put The Running Man's plain track 3 at 10.4 % in the sample
(an opening song, 4.1 % over the whole track), which is why music notes do not count. No pair other
than Dragon's 3/4 and 5/6 aligns cue for cue in the sample. Atomic Blonde's forced track 2 is
entirely contained in its plain track 3 (79 of 79 cues found inside a time-overlapping cue of track 3,
1 of 79 inside the commentary), and its source carries no `NUMBER_OF_FRAMES`/`NUMBER_OF_BYTES` tags,
which is why S3 could not measure it. The Running Man shows that the `forced` disposition cannot be
trusted: the track marked forced is the full one.

This feature adds one metadata rule and three evidence rules that read the **text** of a language's
candidate tracks before the encode, applied in order, per language: drop commentary tracks by their
marking; then, only while the language still has two or more text tracks, drop the tracks whose
content is hearing-impaired when the content splits the group, collapse tracks that carry the same
translation down to the best one, and drop a small track whose every cue is already said by another
track. The governing principle is the one `.claude/agents/ffmpeg.md` already states for subtitles —
*drop what you can prove is redundant, keep what you cannot tell apart* — sharpened by an asymmetry
the user named explicitly: the library is often watched weeks after the download, so removing an
extra track by hand later is cheap and a good track lost to a wrong verdict means downloading and
encoding the title again. Every threshold here leans toward keeping. The goal is one normal track
per language, but two duplicates are always better than a missing one.

Pipeline stage touched: **Transcode**, worker only. The text is read in the encode driver
(`services/worker/src/encode/encode.ffmpeg.ts`), beside `092`/`094`'s grain resolution, `098`'s
dub-trim and `099`'s stream-end trim, and handed to the subtitle selection as data, so the FFmpeg
command builder stays pure. No setting, no GraphQL, no schema; nothing already in the library is
touched (Article XII). This feature is not required by Article VII (one service, no contract, no
stage added or removed); it is written because the rules are worth recording and the thresholds
worth calibrating against named files.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (After the existing rules)**: Every current subtitle rule (S1 format, S2 language,
      S3 cue payload, S4 metadata hearing-impaired, S4b text before image, S5 requested variant) runs
      first, in its current order, and only C0 changes one of them. C1–C3 only ever remove tracks
      from what S5 leaves; they never add one back.
- [ ] **REQ-2 (Rule C0: commentary by marking)**: A subtitle track is dropped when its
      `disposition.comment` is `1` or its title contains the word `commentary` (the word-boundary
      title matcher the existing rules already use, case-insensitive). C0 is not a new rule stage: it
      widens the existing candidate filter where S1–S3 already drop a track outright, so a commentary
      track never becomes a candidate at all (decided by the user, 2026-10-24). It reads no text and
      applies whatever the number of tracks: a commentary is never the title's dialogue, so a
      language left with only a commentary track ends up with none, the same posture the audio rules
      take on a `commentary` title. The Running Man's track 4 carries both markings; Atomic Blonde's
      track 4 carries the title.
- [ ] **REQ-3 (Only when there is a choice)**: The three text rules below (C1, C2, C3) apply per
      language and only to text tracks, and each one runs only while that language still has **more
      than one** text track at that point: a language that S1–S5 and C0 leave with one text track is
      not read at all, and if C1 or C2 leaves a language with one track the rules after it do
      nothing. Image tracks (PGS, VobSub, DVB) are never read and never removed by
      this feature.
- [ ] **REQ-4 (Text sample)**: The text of every candidate track of every language that qualifies
      under REQ-3 is read in **one** pass over the source, limited to the first **900 s** of the
      title, without decoding video or audio and without writing any file. The limit applies to the
      subtitle output itself; the 2026-10-24 measurement found that a limit on the input alone still
      extracted the whole track. On the five calibration files (1.8–4.2 GB) the sampled pass took
      0.18–0.24 s; the whole How to Train Your Dragon (2025) file took 8.5 s.
- [ ] **REQ-5 (Annotation share)**: A track's annotation share is the fraction of its sampled cues,
      markup removed, that contain at least one of: a bracketed annotation `[...]`, a parenthesised
      annotation `(...)`, or an uppercase speaker label at the start of a line (`HICCUP:`, `HÜRL:`,
      `- ASTRID:`). "Uppercase" is Unicode uppercase, not ASCII only: a Spanish SDH track labels
      `MARÍA:`, and Dragon's plain track 3 carries `HÜRL:` (1.2 % of its sample, which an ASCII-only
      pattern would read as 0 %; Wake Up Dead Man's Spanish title card `PUÑALES POR LA ESPALDA:`
      also counts, 0.4 %). Music notes (`♪`/`♫`) do **not** count: plain tracks carry them on song lyrics
      (The Running Man, 10.4 % of the sample). No file in the calibration set uses parenthesised
      annotations; they are included because SDH releases write `(DOOR CLOSES)` as often as
      `[door closes]`. A track with no cue inside the sample has no share and is treated as not
      hearing-impaired.
- [ ] **REQ-6 (Rule C1: hearing-impaired by content)**: A track is hearing-impaired by content when
      its annotation share is at or above **10 %**. In the calibration set the highest plain track
      reads 1.2 % and the lowest SDH track 17.5 % (The Help); 10 % leaves a wider margin on the plain
      side, because a plain track wrongly read as SDH is lost while an SDH track wrongly read as plain
      only stays. Within a language, hearing-impaired-by-content tracks are dropped **only** when at
      least one candidate of that language is not. When every candidate is hearing-impaired by
      content, or none is, all stay.
- [ ] **REQ-7 (Rule C2: same translation)**: Among the tracks of a language that survive C1, two
      tracks carry the same translation when every one of these holds:
      - their sampled cue lists align one-to-one, cue for cue;
      - each aligned pair starts within **250 ms** of the other (Dragon's 3/4 differ by at most
        88 ms);
      - after normalisation (markup removed, typographic quotes and apostrophes folded to straight
        ones, dialogue-dash spacing folded, whitespace collapsed, case kept), at least **95 %** of
        the aligned pairs have identical text (Dragon's 3/4 reach 100 % in the sample and 99.5 % over
        the whole track; 5/6 reach 100 %);
      - their whole-track cue counts, as reported by `ffprobe` (`NUMBER_OF_FRAMES`), are equal. When
        either track lacks the tag, the pair is not the same translation.
      The last condition is what stops a 900 s sample from collapsing a complete track into one that
      is truncated or diverges later in the film.
- [ ] **REQ-8 (C2 keeps the best one)**: Tracks that are the same translation as each other form a
      group, and only the best track of each group is emitted, chosen in this order: more italic
      cues in the sample (italics carry meaning, e.g. narration vs dialogue — Dragon's track 3 is the
      one that has them), then the `default` disposition, then the earlier stream index (decided by
      the user, 2026-10-24). Byte-identical tracks (Dragon's 5/6) are the trivial case of the same
      rule. Tracks that are not the same translation as any other all stay, whatever their
      formatting.
- [ ] **REQ-9 (Rule C3: contained in another track)**: Among the tracks of a language that survive
      C2, a track *X* is contained in another track *Y* when every one of these holds:
      - *X* has at least **3** cues in the sample (Atomic Blonde's forced track has exactly 3; fewer
        is too little evidence and *X* stays);
      - *X* has at most half as many sampled cues as *Y*, and, when both carry `NUMBER_OF_FRAMES`,
        at most half as many whole-track cues as well (so two tracks of similar size are left to
        C2, never to this rule);
      - for every sampled cue of *X*, its normalised text (as in REQ-7, then lower-cased) appears
        inside the normalised text of the cues of *Y* that overlap it in time.
      A contained track is dropped; *Y* is never dropped by this rule. This is the shape of a forced
      track (the foreign-language lines only) next to the full track it was cut from, recognised by
      its content rather than by the `forced` disposition, which The Running Man shows to be wrong.
      When the sample holds no cue of *X* — a forced track whose first line comes after 900 s —
      *X* stays.
- [ ] **REQ-10 (Order of the rules)**: C0, then C1, C2, C3. C1 runs before C2 and C3, so a plain
      track can never be collapsed into, or found contained in, an SDH one that is about to be
      dropped. C2 also applies among tracks that C1 kept because all of them were hearing-impaired:
      two identical SDH tracks still collapse to one. On the calibration set:
      - How to Train Your Dragon (2025): English goes from tracks 3, 4, 5, 6 to track 3 alone (C1
        drops 5, 6; C2 keeps 3 over 4); the Spanish track is never read.
      - Wake Up Dead Man (2025): English loses track 4 (C1); both Spanish tracks stay.
      - The Help (2011): S4 drops track 3 by its marking; C1 alone would also drop it (17.5 %
        against 0 %).
      - The Running Man (2025): C0 drops the commentary; S4 had already dropped `BTM SDH`; English
        is left with one track and is never read.
      - Atomic Blonde (2017): S4 drops `SDH`, C0 drops the commentary; C3 drops `forced`, contained
        in `full`; English is left with `full` alone.
- [ ] **REQ-11 (Applies to every encoded title)**: Films, shorts and episodes alike, including each
      file of a season pack (`095`), each read and decided on its own.
- [ ] **REQ-12 (Compression on only)**: With `compression_enabled` off nothing in this feature runs,
      C0 included: the file is moved untouched (`032`), every track with it.
- [ ] **REQ-13 (Log lines)**: A track dropped by C0 logs one `[subs]` line naming its stream index
      and `drop (commentary)`. Every language that was read under REQ-3 logs one `[subs]` line
      naming the language, each candidate's stream index, sampled cue count and annotation share, and
      the outcome per track: `keep`, `drop (sdh)`, `drop (same as N)` or `drop (contained in N)`.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Failure keeps everything)**: Any failure reading or parsing the text — FFmpeg exits
      non-zero, a track produces unparseable output, the source has no readable subtitle stream —
      leaves the selection exactly as S1–S5 and C0 produced it and the encode proceeds. No warning is
      owed to `api`; one worker log line naming the failure is allowed. Only cancellation
      (`047`/`097`'s `AbortSignal`) propagates, and it must stop the extraction process the same way
      it stops the encode.
- [ ] **NFR-2 (Bounded cost)**: At most one extra FFmpeg pass per file, demuxing at most the first
      900 s and decoding nothing; none at all when no language qualifies under REQ-3, which is the
      common case. C1, C2 and C3 all read the same sample.
- [ ] **NFR-3 (Verdict reuse)**: A verdict is reused for the same input file within one worker
      process, so a retry of the same encode does not read again; a failed read is never reused.
- [ ] **NFR-4 (Tests where failure is silent)**: A wrong verdict silently loses a good track, or
      silently keeps the clutter, with no error anywhere (Article IX). The rules must be covered by
      tests that reproduce the measured shapes (cue counts, annotation shares, timing offsets,
      containment) and the `ffprobe` output of this spec's calibration set — the films' subtitle text
      itself is never committed, since the repository is public and that text is copyrighted; the
      sampled tracks are committed instead with every word replaced by random letters of the same
      length and case, one mapping per film (`services/worker/fixtures/subtitle-content/`), which
      reproduces each measured figure exactly — at
      least Dragon tracks 3–6, Wake Up Dead Man tracks 3–6, The Help track 3 read without its
      marking, The Running Man track 3 for the music-note exclusion and its source `ffprobe` for C0,
      and Atomic Blonde tracks 2–3 for C3 — including: a language where every track is SDH (all
      kept); a pair that matches in the sample but differs in whole-track cue count (both kept); a
      pair missing `NUMBER_OF_FRAMES` (not collapsed by C2); a pair outside the timing tolerance (both
      kept); a small track with one sampled cue not found in the large one (both kept); a small track
      with 2 sampled cues, all found (both kept); and a track titled `Commentary` that is the only one
      of its language (dropped). The rule document `.claude/agents/ffmpeg.md` records C0–C3 beside
      S1–S6, and the case corpus `services/worker/ffmpeg/` gains The Running Man's source `ffprobe` as
      a case for C0.

## GraphQL Contract Delta

None — this feature does not cross the service boundary. The worker reads the source it already has
and decides locally; `EncodeJobDetails` already carries everything the selection needs, and no
outcome is reported to `api` beyond the existing encode reports.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| — | — | — |

No new error key: a failed read is not an error (NFR-1).

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Encoding a source with the How to Train Your Dragon (2025) subtitle layout (English
      tracks shaped like library tracks 3, 4, 5, 6 and one Spanish track) produces an output with
      exactly one English text track — the one REQ-8 prefers — and the Spanish track, and the worker
      log shows a `[subs] eng` line with `drop (sdh)` twice and `drop (same as N)` once.
- [ ] **AC-2**: Encoding The Running Man (2025) source (`ffprobe_logs` row 94's layout) produces an
      output with one English text track and no commentary, the log shows `drop (commentary)`, and no
      extraction pass runs for English (REQ-3).
- [ ] **AC-3**: Encoding a source with the Atomic Blonde (2017) subtitle layout (English `forced`,
      `full`, `SDH`, `Commentary…`, no statistics tags) produces an output with exactly one English
      track, the `full` one, and the log shows `drop (commentary)` and `drop (contained in N)`.
- [ ] **AC-4**: A source with two English tracks that are both hearing-impaired by content and
      differ in text produces an output with both, and the log shows both `keep` (REQ-6, all alike).
- [ ] **AC-5**: A source with two plain English tracks of different translations (different text,
      same timing) produces an output with both (REQ-7 fails on text share, REQ-9 on size).
- [ ] **AC-6**: A source with two English tracks whose first 900 s are identical but whose
      `NUMBER_OF_FRAMES` differ produces an output with both (REQ-7, whole-track guard).
- [ ] **AC-7**: A source with a full English track and a small English track one of whose sampled
      cues does not appear in the full track produces an output with both (REQ-9).
- [ ] **AC-8**: A source with one English and one Spanish text track runs no extra FFmpeg pass and
      logs no `[subs]` line (REQ-3).
- [ ] **AC-9** *(failure path)*: With the extraction forced to fail (the FFmpeg binary made to exit
      non-zero for the extraction call only), a source shaped like AC-1 encodes successfully with all
      four English tracks, as it does today (NFR-1); a source shaped like AC-3 encodes with `forced`
      and `full`, the commentary already dropped by C0.
- [ ] **AC-10** *(failure path)*: Deleting a source (`047`) or stopping its encode (`097`) while its
      subtitle text is being read leaves no FFmpeg process alive and reports no encode outcome.
- [ ] **AC-11**: With `compression_enabled` off, moving a source shaped like AC-3 keeps all its
      tracks and logs no `[subs]` line (REQ-12).
- [ ] **AC-12**: `bin/npm worker test`, `bin/cli worker npx --no tsc --noEmit` and `bin/comments
      worker` all pass, and the worker suite contains the NFR-4 cases.

## Out of Scope

- **Cleaning the text of an SDH track** (removing `[...]`, speaker labels and music lines from a
  track that is the only one of its language). It rewrites content, has false positives of its own
  (`(whispering)` is sometimes the meaning), and needs the track extracted and remuxed separately.
  A possible later feature for the case C1 leaves untouched.
- **Image subtitles.** Reading PGS/VobSub content needs OCR; S4b already drops them whenever a text
  track of the language exists.
- **Choosing between different translations.** Two tracks that are not the same translation under
  REQ-7 and not contained under REQ-9 both stay, however similar they look; ranking translations by
  quality is not something text statistics can do safely.
- **Trusting the `forced` disposition or a `forced` title.** The Running Man's full track is marked
  forced; C3 recognises a forced track by what it says instead. A forced track whose lines all fall
  after the first 900 s stays.
- **Detecting commentary by content.** A commentary is ordinary dialogue to any text statistic; C0
  relies on its marking, which both calibration releases carry.
- **A Settings switch or per-title override.** C1–C3 only remove a track when the evidence splits
  the group or proves it redundant, and C0 removes what is never the title's dialogue; there is no
  failure mode worth turning off.
- **Fixing files already in the library.** Article XII; How to Train Your Dragon (2025) keeps its
  four English tracks until it is acquired again.
- **Restoring original track titles.** The worker rewrites every title to the language's
  `trackTitle` (`051`); this feature does not change which title an emitted track gets.
