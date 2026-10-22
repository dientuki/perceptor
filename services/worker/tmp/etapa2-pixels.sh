#!/usr/bin/env bash
# Stage 2 grain detector: samples pixels with FFmpeg filters.
#
# Usage: etapa2-pixels.sh [-v|--csv] <file>
#   stdout: "true" (has grain) or "false" (no grain)
#   -v     print the scan, the per-sample metrics and the decision on stderr
#   --csv  print one CSV row of aggregated metrics instead of the verdict
#   exit 0 ok, 2 usage/probe error
#
# MEASURED AT THE OUTPUT RESOLUTION, NOT THE SOURCE'S. This is the correction
# that matters most and the one that was missing: the detector must see what
# SVT-AV1 will see, which is the image after COMPRESSION_RESOLUTION's downscale,
# not what sits on disk. A 4K source going to a 1080p ceiling loses half its
# grain amplitude to the scaler before the encoder ever runs -- area-averaging
# 2x2 pixels attenuates spatially uncorrelated noise by 1.5-2x. Measured on a
# real pair at identical output resolution: The Green Mile (4K->1080p, 35mm
# 1999) encodes to 1.59 Mbps and looks right at film-grain=0, while Cherry 2000
# (native 1080p, 35mm 1987) needs 5.81 Mbps -- 3.8x apart. Measured on their
# SOURCES this detector put them 1.28x apart and called the wrong one grainier.
#
# Grain is temporally incorrelated: in a shot with no motion, everything that
# differs between consecutive frames is noise. Real texture is temporally
# stable, so it cancels. That is the basis of both judges, and the reason every
# measurement here is temporal -- signalstats' own YDIF, the mean absolute
# difference against the previous frame. There is no YSTDEV in signalstats;
# YMIN/YLOW/YAVG/YHIGH/YMAX/YDIF plus chroma is the whole vocabulary.
#
# A SPATIAL measure of grain does not work on real footage: original-vs-denoised
# PSNR reads a film's own detail, not its grain, and on a clean 2023 digital film
# it sat at 47.5-49.4 dB across every sample regardless of motion or grain.
#
# Three stages:
#
#   scan     windows across the central 90%, measuring only YDIF on the
#            1/DOWNSCALE area-averaged stream. Area-averaging divides grain
#            amplitude while low-frequency motion survives, so this reads motion
#            and almost no grain, with no denoiser in the graph and therefore
#            cheaply. Windows are measured quietest-first; any window whose YAVG
#            is under BLACK_YAVG is dropped, since a black frame or a fade is
#            quiet because there is nothing there, not because it is clean.
#
#   judge B  YDIF at output resolution minus YDIF of the DENOISE'd stream.
#            PRIMARY. A wavelet denoiser preserves motion while removing grain,
#            so the subtraction discounts motion correctly.
#
#   judge A  YDIF at output resolution minus YDIF of the area-downscaled stream.
#            CROSS-CHECK. The downscale also destroys fine moving detail, which
#            leaks into the subtraction as false grain -- on an Amazon WEB-DL it
#            read 0.62 against judge B's 0.18 and nearly flagged the cleanest
#            file in the corpus. Judge B ordered a 7-file corpus correctly by
#            provenance 7/7; judge A had 2 inversions. B decides, A is reported.
#
# The two judges live on DIFFERENT SCALES (B runs 44-62% of A on the same
# material), so each has its own threshold and the agreement check compares each
# against its own.
#
# Aggregated with a LOW percentile (AGG_PCT), not a high one. Residual motion
# inflates both judges and never deflates them, so the lower envelope across
# quiet samples is the grain and the upper envelope is contamination. Measured
# on a clean film the surviving samples ran grain = 0.25 + 1.15 * motion, almost
# perfectly monotonic in the leftover motion.
#
# Sampling is adaptive: windows are measured quietest-first until TARGET_GATED
# survive the motion gate or MAX_MEASURED are spent. A film with wall-to-wall
# motion (The Hurricane Heist) previously measured a fixed 8 and had 1 survive,
# which makes any percentile meaningless.
#
# THRESHOLDS ARE PROVISIONAL and predate this version's output-resolution fix.
# Run --csv over labelled files and refit. Better still, use the encode probe
# (etapa3-encode-probe.sh), which measures the SAVING rather than the grain and
# needs no pixel threshold at all.
set -uo pipefail

VERBOSE=0; CSV=0
while [ $# -gt 0 ]; do
  case "$1" in
    -v) VERBOSE=1; shift ;;
    --csv) CSV=1; shift ;;
    -h|--help) sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) break ;;
  esac
done

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "usage: $(basename "$0") [-v|--csv] <file>" >&2
  exit 2
fi
for bin in ffprobe ffmpeg; do
  command -v "$bin" >/dev/null 2>&1 || { echo "$bin not found" >&2; exit 2; }
done

: "${COMPRESSION_RESOLUTION:=1080p}"
: "${SCAN_WINDOWS:=40}"
: "${SCAN_SECONDS:=0.5}"
: "${TARGET_GATED:=5}"
: "${MAX_MEASURED:=16}"
: "${SAMPLE_SECONDS:=2}"
: "${DOWNSCALE:=16}"
: "${DENOISE:=vaguedenoiser=threshold=4}"
: "${AGG_PCT:=25}"
: "${T_GRAIN_B:=0.36}"
: "${T_GRAIN_A:=0.80}"
: "${T_MOTION:=1.20}"
: "${BLACK_YAVG:=24}"
: "${MIN_YDIF:=0.05}"
: "${CROP_PROBES:=5}"

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

probe_v() { ffprobe -v error -select_streams v:0 -show_entries "stream=$1" -of default=nw=1:nk=1 "$FILE" 2>/dev/null | head -1; }

WIDTH=$(probe_v width)
HEIGHT=$(probe_v height)
PIXFMT=$(probe_v pix_fmt)
DURATION=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$FILE" 2>/dev/null | head -1)

[ -n "$WIDTH" ] || { echo "no video stream in $FILE" >&2; exit 2; }
if ! awk -v d="${DURATION:-0}" 'BEGIN{exit !(d+0 > 30)}'; then
  echo "duration unreadable or under 30s: ${DURATION:-none}" >&2
  exit 2
fi

# signalstats reports raw plane values, so a 10-bit source yields 0..1023 and an
# 8-bit one 0..255. Normalize to 8-bit units so thresholds are comparable.
case "$PIXFMT" in
  *p12*|*12le*|*12be*) DEPTH=12 ;;
  *p10*|*10le*|*10be*) DEPTH=10 ;;
  *)                   DEPTH=8  ;;
esac
SCALE=$(awk -v d="$DEPTH" 'BEGIN{printf "%d", 2^(d-8)}')

# Black bars are a quarter of a 2.39:1 frame at zero difference, so they must be
# cropped. But one probe is not enough: a single dark scene at the probe point
# produced crop=1804:800:116:0 on a film whose other four probe points all
# reported the full 1920x800 frame, silently discarding 6% of real image for the
# whole measurement. Take the mode across several probes instead.
: > "$TMPD/crops.txt"
c=0
while [ "$c" -lt "$CROP_PROBES" ]; do
  AT=$(awk -v d="$DURATION" -v i="$c" -v n="$CROP_PROBES" 'BEGIN{printf "%.2f", d*(0.10 + 0.70*i/(n>1?n-1:1))}')
  R=$(ffmpeg -hide_banner -nostdin -nostats -ss "$AT" -t 5 -i "$FILE" -an -sn \
        -vf cropdetect=limit=24:round=2:reset=0 -f null /dev/null 2>&1 \
      | grep -oE 'crop=[0-9]+:[0-9]+:[0-9]+:[0-9]+' | tail -1)
  [ -n "$R" ] && echo "$R" >> "$TMPD/crops.txt"
  c=$((c + 1))
done
CROP=$(sort "$TMPD/crops.txt" 2>/dev/null | uniq -c | sort -rn | head -1 | awk '{print $2}')
CROP_VOTES=$(sort "$TMPD/crops.txt" 2>/dev/null | uniq -c | sort -rn | head -1 | awk '{print $1}')

if [ -n "${CROP:-}" ]; then
  CW=$(echo "$CROP" | cut -d= -f2 | cut -d: -f1)
  CH=$(echo "$CROP" | cut -d= -f2 | cut -d: -f2)
else
  CROP=""; CW="$WIDTH"; CH="$HEIGHT"
fi

# The same resolution ceiling the worker applies (services/worker/src/ffmpeg/
# params.ts): a box the source is downscaled to FIT, never a target it is forced
# to, with a 2% tolerance so a nominally-compliant source is left alone.
case "$COMPRESSION_RESOLUTION" in
  4k)    BOX_W=0;    BOX_H=0 ;;
  1080p) BOX_W=1920; BOX_H=1080 ;;
  720p)  BOX_W=1280; BOX_H=720 ;;
  480p)  BOX_W=854;  BOX_H=480 ;;
  360p)  BOX_W=640;  BOX_H=360 ;;
  *) echo "unknown COMPRESSION_RESOLUTION '$COMPRESSION_RESOLUTION'" >&2; exit 2 ;;
esac

VF_PRE=""
[ -n "$CROP" ] && VF_PRE="${CROP},"
SCALED=no
if [ "$BOX_W" -gt 0 ] && awk -v w="$CW" -v h="$CH" -v bw="$BOX_W" -v bh="$BOX_H" \
     'BEGIN{exit !(w > bw*1.02 || h > bh*1.02)}'; then
  VF_PRE="${VF_PRE}scale=${BOX_W}:${BOX_H}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
  SCALED=yes
fi

mean_key() { awk -v s="$SCALE" -v k="$2" -F= '$0 ~ k"=" { n++; t += $2 } END{
  if (n==0) { print "nan" } else { printf "%.4f", (t/n)/s } }' "$1" 2>/dev/null || echo nan; }
mean_ydif() { mean_key "$1" YDIF; }

pct() { sort -g | awk -v p="$1" '{v[NR]=$1+0} END{
  if (NR==0) { print "nan"; exit }
  i = int((p/100)*(NR-1)) + 1; if (i<1) i=1; if (i>NR) i=NR;
  printf "%.4f", v[i] }'; }

START=$(awk -v d="$DURATION" 'BEGIN{printf "%.2f", d*0.05}')
SPAN=$(awk -v d="$DURATION" 'BEGIN{printf "%.2f", d*0.90}')

scan_one() { # $1 = -ss
  : > "$TMPD/s.txt"
  ffmpeg -hide_banner -nostdin -nostats -v error -ss "$1" -t "$SCAN_SECONDS" -i "$FILE" -an -sn \
    -vf "${VF_PRE}scale=iw/${DOWNSCALE}:ih/${DOWNSCALE}:flags=area,signalstats,metadata=print:file=$TMPD/s.txt" \
    -f null /dev/null >/dev/null 2>&1
  printf '%s %s' "$(mean_key "$TMPD/s.txt" YDIF)" "$(mean_key "$TMPD/s.txt" YAVG)"
}

: > "$TMPD/scan.txt"
DARK=0
w=0
while [ "$w" -lt "$SCAN_WINDOWS" ]; do
  SS=$(awk -v s="$START" -v sp="$SPAN" -v i="$w" -v n="$SCAN_WINDOWS" 'BEGIN{printf "%.2f", s + sp*(i+0.5)/n}')
  read -r M Y <<<"$(scan_one "$SS")"
  if [ "$M" != nan ] && [ "$Y" != nan ] \
     && awk -v y="$Y" -v b="$BLACK_YAVG" 'BEGIN{exit !(y+0 >= b+0)}'; then
    printf '%s %s\n' "$M" "$SS" >> "$TMPD/scan.txt"
  else
    DARK=$((DARK + 1))
  fi
  w=$((w + 1))
done

SCANNED=$(wc -l < "$TMPD/scan.txt" | tr -d ' ')
[ "$SCANNED" -gt 0 ] || { echo "scan measured nothing" >&2; exit 2; }
sort -g "$TMPD/scan.txt" > "$TMPD/chosen.txt"

if [ "$VERBOSE" = 1 ]; then
  {
    echo "crop:      ${CROP:-none} (${CROP_VOTES:-0}/${CROP_PROBES} probes agreed)"
    echo "measure:   ${CW}x${CH} -> ${COMPRESSION_RESOLUTION} box, downscale=${SCALED}"
    echo "scan:      ${SCANNED}/${SCAN_WINDOWS} windows kept (${DARK} too dark), motion $(cut -d' ' -f1 "$TMPD/scan.txt" | pct 0) .. $(cut -d' ' -f1 "$TMPD/scan.txt" | pct 100)"
    echo ""
    printf '%-3s %-9s %-8s %-8s %-8s %-8s %-8s %s\n' "#" "at" "motion" "ydif" "denoise" "grainB" "grainA" "gate"
  } >&2
fi

measure() { # $1 = -ss
  : > "$TMPD/raw.txt"; : > "$TMPD/down.txt"; : > "$TMPD/den.txt"
  ffmpeg -hide_banner -nostdin -nostats -v error -ss "$1" -t "$SAMPLE_SECONDS" -i "$FILE" -an -sn \
    -filter_complex "[0:v]${VF_PRE}split=3[a][b][c];\
[a]signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=$TMPD/raw.txt[o1];\
[b]scale=iw/${DOWNSCALE}:ih/${DOWNSCALE}:flags=area,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=$TMPD/down.txt[o2];\
[c]${DENOISE},signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=$TMPD/den.txt[o3]" \
    -map "[o1]" -map "[o2]" -map "[o3]" -f null /dev/null >/dev/null 2>&1
}

sub() { awk -v a="$1" -v b="$2" 'BEGIN{ v=a-b; if (v<0) v=0; printf "%.4f", v }'; }

GRAINS_A=""; GRAINS_B=""; MOTIONS=""; GATED=0; FROZEN=0; MEASURED=0; i=0
while read -r _ SS; do
  [ "$GATED" -ge "$TARGET_GATED" ] && break
  [ "$MEASURED" -ge "$MAX_MEASURED" ] && break
  measure "$SS"
  MEASURED=$((MEASURED + 1))

  RAW=$(mean_ydif "$TMPD/raw.txt")
  DOWN=$(mean_ydif "$TMPD/down.txt")
  DEN=$(mean_ydif "$TMPD/den.txt")

  GA=nan; GB=nan
  [ "$RAW" != nan ] && [ "$DOWN" != nan ] && GA=$(sub "$RAW" "$DOWN")
  [ "$RAW" != nan ] && [ "$DEN"  != nan ] && GB=$(sub "$RAW" "$DEN")

  GATE=skip
  if [ "$RAW" != nan ] && awk -v r="$RAW" -v f="$MIN_YDIF" 'BEGIN{exit !(r+0 < f+0)}'; then
    GATE=frozen
    FROZEN=$((FROZEN + 1))
  elif [ "$DOWN" != nan ] && awk -v m="$DOWN" -v t="$T_MOTION" 'BEGIN{exit !(m+0 <= t+0)}'; then
    GATE=keep; GATED=$((GATED + 1))
    [ "$GA" != nan ] && GRAINS_A="${GRAINS_A}${GA}
"
    [ "$GB" != nan ] && GRAINS_B="${GRAINS_B}${GB}
"
    MOTIONS="${MOTIONS}${DOWN}
"
  fi

  [ "$VERBOSE" = 1 ] && printf '%-3d %-9s %-8s %-8s %-8s %-8s %-8s %s\n' "$i" "$SS" "$DOWN" "$RAW" "$DEN" "$GB" "$GA" "$GATE" >&2
  i=$((i + 1))
done < "$TMPD/chosen.txt"

GRAIN_A=$(printf '%s' "$GRAINS_A" | grep -v '^$' | pct "$AGG_PCT")
GRAIN_B=$(printf '%s' "$GRAINS_B" | grep -v '^$' | pct "$AGG_PCT")
MOTION=$(printf '%s' "$MOTIONS"   | grep -v '^$' | pct "$AGG_PCT")

if [ "$GRAIN_B" = nan ]; then
  echo "no sample survived the motion gate in ${MEASURED} windows (T_MOTION=$T_MOTION)" >&2
  exit 2
fi

ge() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a+0 >= b+0)}'; }

if ge "$GRAIN_B" "$T_GRAIN_B"; then VERDICT=true; else VERDICT=false; fi

AGREE=yes
if [ "$GRAIN_A" != nan ]; then
  if ge "$GRAIN_A" "$T_GRAIN_A"; then VA=true; else VA=false; fi
  [ "$VA" = "$VERDICT" ] || AGREE="no (judge A says $VA)"
fi

if [ "$CSV" = 1 ]; then
  echo "file,width,height,pixfmt,depth,crop,crop_votes,scaled,scanned,measured,gated,frozen,agg_pct,grain_b,grain_a,motion,agree,verdict"
  echo "\"$(basename "$FILE")\",${WIDTH},${HEIGHT},${PIXFMT},${DEPTH},\"${CROP:-none}\",${CROP_VOTES:-0},${SCALED},${SCANNED},${MEASURED},${GATED},${FROZEN},${AGG_PCT},${GRAIN_B},${GRAIN_A},${MOTION},\"${AGREE}\",${VERDICT}"
  exit 0
fi

if [ "$VERBOSE" = 1 ]; then
  {
    echo ""
    echo "file:      $(basename "$FILE")"
    echo "source:    ${WIDTH}x${HEIGHT} ${PIXFMT} (${DEPTH}-bit, /${SCALE})"
    echo "measured:  ${MEASURED} windows, ${GATED} kept (target ${TARGET_GATED}), ${FROZEN} frozen"
    echo "judge B:   grain p${AGG_PCT} = ${GRAIN_B}   (threshold ${T_GRAIN_B}, ${DENOISE})  PRIMARY"
    echo "judge A:   grain p${AGG_PCT} = ${GRAIN_A}   (threshold ${T_GRAIN_A}, /${DOWNSCALE} downscale)"
    echo "motion:    p${AGG_PCT} = ${MOTION}"
    echo "agreement: ${AGREE}"
  } >&2
fi

echo "$VERDICT"
