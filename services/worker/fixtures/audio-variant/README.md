# Audio variant fixtures (spec 110)

Whisper transcripts of the Spanish audio tracks of three films, `<film>/<stream index>.txt`, with every
word of the dialogue replaced by random letters (`scramble.mjs`). The films' dialogue is copyrighted
and this repository is public, so the original text is never committed.

What the scrambling keeps, so `src/encode/audio-variant-score.ts` reads the same as on the originals:

- every word or phrase the detector registry's markers match, verbatim (the marker patterns in
  `scramble.mjs` must be kept in step with `src/encode/audio-variant-detectors.ts`);
- one mapping per film, the same for both tracks: identical lines stay identical, so the Jurassic
  Park III pair stays a duplicate and the other two stay far apart;
- punctuation, digits, accented letters, line breaks, word length, letter case and words of one or two
  letters.

`manifest.json` records the verdict each film must decide.

```bash
docker run --rm --user 1000:1000 -v "$PWD":/w -v /path/to/transcripts:/s -w /w node:24.18.0-alpine \
  node scramble.mjs <film> /w/<film> 2=/s/<track 2>.txt 3=/s/<track 3>.txt
```
