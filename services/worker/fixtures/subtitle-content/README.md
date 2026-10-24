# Subtitle content fixtures (spec 102)

The first 900 s of each text subtitle track of the five films in spec `102`'s calibration table,
extracted from the library files with `ffmpeg -map 0:N -t 900 -c:s srt -f srt`, with every word of
the dialogue replaced by random letters (`scramble.mjs`). The films' subtitle text is copyrighted and
this repository is public, so the original text is never committed.

What the scrambling keeps, so the rules of `src/ffmpeg/subtitle-content.ts` read the same as on the
originals:

- cue numbers, start and end times, line breaks, `<i>`/`{…}` markup, punctuation, digits, `[`, `(`,
  `♪` and every non-ASCII letter;
- word length and the case of each letter, so an uppercase speaker label stays one;
- one mapping per film, the same for all its tracks: identical text in two tracks stays identical,
  and a forced cue stays inside the full track's cue;
- words of one or two letters, verbatim.

Checked when generated: annotation share, cue counts, italic cues, Dragon 3/4 and 5/6 alignment and
text match, and Atomic Blonde's 3/3 sampled forced cues contained in track 3 all come out identical
on the originals and on these files.

`manifest.json` records, per track, what the rules need from `ffprobe` (`isDefault`,
`numberOfFrames`) and the expected verdict from spec `102` REQ-10. Atomic Blonde's
`numberOfFrames` is `null` because its source carries no statistics tags (the library file does).
`commentary` tracks are dropped by C0 before any text is read; `not read` languages have one text
track.

To add a film, extract its samples to a folder of `<stream index>.srt` files, then:

```bash
docker run --rm --user 1000:1000 -v "$PWD":/w -v /path/to/samples:/s -w /w node:24.18.0-alpine node scramble.mjs /s/<film> /w/<film> <film>
```
