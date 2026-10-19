# 098 fixtures — recorded `freezedetect` output

Captured on 2026-10-19 from real files of this installation's library, before the spec was written.
Each `*.freezes.txt` is the `freeze_start:`/`freeze_end:` lines FFmpeg printed for:

```
ffmpeg -sseof -300 -i <file> -map 0:v:0 -vf "scale=320:-2,freezedetect=n=0.003:d=1" -an -f null -
```

Times are **relative to the start of the 300-second window**, so the window length is `300` for
every file below (all are longer than five minutes). A log whose last `freeze_start` has no matching
`freeze_end` means the freeze was still open at the end of the window — it runs to `300`.

Expected outcome of spec REQ-6/REQ-7/REQ-8 on each file (window-relative cut point):

| Fixture | Source | Run start | Cards | 2.002 s multiples | Outcome |
| :-- | :-- | --: | --: | --: | :-- |
| `neagley-s01e01` | Neagley S01E01 (Amazon) | 173.822 | 60 | 60 | **cut** at 173.822 |
| `voltron-s03e01` | Voltron Legendary Defender S03E01 (Netflix) | 273.862 | 13 | 11 (84%) | **cut** at 273.862 |
| `war-machine` | War Machine (2026, Netflix) | 140.905 | 52 | 51 | **cut** at 140.905 |
| `wrecking-crew` | The Wrecking Crew (2026, Amazon) | 168.909 | 65 | 64 | **cut** at 168.909 |
| `chernobyl-s01e01` | Chernobyl S01E01 (HBO, card-style original credits) | 228.87 | 56 | 3 (5%) | keep — fails the 80% rule |
| `reacher-s01e01` | Reacher S01E01 | 297.814 | 1 | 0 | keep — fewer than 5 cards |
| `foundation-s01e01` | Foundation S01E01 | — | — | — | keep — no freeze reaches the end (last ends at 293.977) |

Voltron's 84% is the closest any real tail came to the 80% threshold: its run opens with two or three
1.0–1.5 s black/fade freezes before the 2.002 s cards, and REQ-8 says those are cut too.

The video-end rule (REQ-5) has no freeze fixture: Voltron S01E01's container reports 4121.768 s while
its video stream's `DURATION` tag ends at ~4101 s. Neagley S01E01, for reference, reports the video
end only as the Matroska tag `DURATION=00:57:22.356000000` (stream `duration=N/A`) against a
container duration of 3442.408 s.
