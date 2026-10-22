#!/usr/bin/env bash
# Stage 3 grain decision: measures the SAVING, not the grain.
#
# Usage: etapa3-encode-probe.sh [-v|--csv] <file>
#   stdout: "true" (synthesize grain) or "false" (do not)
#   -v     per-window sizes and the decision on stderr
#   --csv  one CSV row instead of the verdict
#   exit 0 ok, 2 usage/probe error
#
# Encodes a few representative windows TWICE through the production filter and
# encoder chain -- once with film-grain=0, once with film-grain=N:
# film-grain-denoise=1 -- and divides the output sizes:
#
#   saving = 1 - bytes(film-grain=N) / bytes(film-grain=0)
#
# That ratio is the thing the decision is actually about, so there is no proxy
# and no pixel threshold to calibrate. It also disposes of every confounder the
# pixel detector had to model, without modelling any of them: a wavelet or
# AV1-internal denoiser does not remove real texture, so rain, water, debris and
# fine detail yield ~0% saving and fall out as "false" on their own. The output
# resolution, bit depth, HDR transfer and content kind are all included by
# construction, because what is measured is the real encode.
#
# Windows are evenly spaced, NOT quietest-first: this measures cost over
# representative content, not grain in still frames.
#
# COVERAGE IS THE LIMITING FACTOR, not window length. The saving varies
# enormously within one film -- measured per-window spreads of 1.6-1.9x on both
# films with known full-encode ground truth (Star Wars 1977: 25.6/20.4/15.6%;
# Cherry 2000: 39.7/27.3/21.4%). Three windows estimated Star Wars at 21.18%
# against a true 14.94%, and Cherry at 26.90% against a true 27.93% -- the
# second looked like precision and was luck. Many short windows beat few long
# ones at the same total encode cost.
#
# PRESET defaults to 8 rather than the worker's 4. Only the RATIO is needed, not
# the final quality, and preset 4 would make this cost hours. A ratio measured
# at preset 8 is not identical to one at preset 4, which is why T_SAVING is a
# decision about this probe's numbers and not about production output.
set -uo pipefail

VERBOSE=0; CSV=0
while [ $# -gt 0 ]; do
  case "$1" in
    -v) VERBOSE=1; shift ;;
    --csv) CSV=1; shift ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
# No pipe here on purpose: under `set -o pipefail`, `grep -q` exits on its
# first match, ffmpeg takes SIGPIPE, and the pipeline reports failure even
# though the encoder is present.
ENCODERS=$(ffmpeg -hide_banner -encoders 2>/dev/null || true)
case "$ENCODERS" in
  *libsvtav1*) ;;
  *) echo "this ffmpeg has no libsvtav1 encoder" >&2; exit 2 ;;
esac

: "${COMPRESSION_RESOLUTION:=1080p}"
: "${CONTENT_KIND:=LIVE_ACTION}"
: "${SAMPLES:=9}"
: "${SAMPLE_SECONDS:=6}"
: "${CRF:=24}"
: "${PRESET:=8}"
: "${FILM_GRAIN:=8}"
: "${T_SAVING:=15}"
: "${T_SAVED_MBPS:=0.86}"
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
if [ -n "${CROP:-}" ]; then
  CW=$(echo "$CROP" | cut -d= -f2 | cut -d: -f1)
  CH=$(echo "$CROP" | cut -d= -f2 | cut -d: -f2)
else
  CROP=""; CW="$WIDTH"; CH="$HEIGHT"
fi

case "$COMPRESSION_RESOLUTION" in
  4k)    BOX_W=0;    BOX_H=0 ;;
  1080p) BOX_W=1920; BOX_H=1080 ;;
  720p)  BOX_W=1280; BOX_H=720 ;;
  480p)  BOX_W=854;  BOX_H=480 ;;
  360p)  BOX_W=640;  BOX_H=360 ;;
  *) echo "unknown COMPRESSION_RESOLUTION '$COMPRESSION_RESOLUTION'" >&2; exit 2 ;;
esac

VF=""
[ -n "$CROP" ] && VF="$CROP"
SCALED=no
if [ "$BOX_W" -gt 0 ] && awk -v w="$CW" -v h="$CH" -v bw="$BOX_W" -v bh="$BOX_H" \
     'BEGIN{exit !(w > bw*1.02 || h > bh*1.02)}'; then
  [ -n "$VF" ] && VF="${VF},"
  VF="${VF}scale=${BOX_W}:${BOX_H}:force_original_aspect_ratio=decrease:force_divisible_by=2"
  SCALED=yes
fi

# The worker's own parameter string (services/worker/src/ffmpeg/params.ts),
# minus the colour tags, which do not move the size ratio.
case "$CONTENT_KIND" in
  LIVE_ACTION) KIND_PARAMS="scm=0:aq-mode=2:sharpness=0" ;;
  ANIME|CGI)   KIND_PARAMS="scm=2:aq-mode=2:enable-qm=1:qm-min=4:sharpness=2" ;;
  *) echo "unknown CONTENT_KIND '$CONTENT_KIND'" >&2; exit 2 ;;
esac
BASE_PARAMS="keyint=10s:scd=1:enable-overlays=1:tune=0:input-depth=10:${KIND_PARAMS}"

encode() { # $1 = -ss, $2 = film-grain spec, $3 = out path
  local args=(-hide_banner -nostdin -nostats -v error -ss "$1" -t "$SAMPLE_SECONDS" -i "$FILE" -an -sn -map 0:v:0)
  [ -n "$VF" ] && args+=(-vf "$VF")
  args+=(-c:v libsvtav1 -crf "$CRF" -preset "$PRESET" -pix_fmt yuv420p10le
         -svtav1-params "${BASE_PARAMS}:${2}" -f matroska -y "$3")
  ffmpeg "${args[@]}" >/dev/null 2>&1
}

bytes() { stat -c %s "$1" 2>/dev/null || echo 0; }

START=$(awk -v d="$DURATION" 'BEGIN{printf "%.2f", d*0.05}')
SPAN=$(awk -v d="$DURATION" 'BEGIN{printf "%.2f", d*0.90}')

TOT0=0; TOTG=0; OK=0
[ "$VERBOSE" = 1 ] && printf '%-3s %-10s %-12s %-12s %s\n' "#" "at" "grain=0" "grain=${FILM_GRAIN}" "saving" >&2

i=0
while [ "$i" -lt "$SAMPLES" ]; do
  SS=$(awk -v s="$START" -v sp="$SPAN" -v i="$i" -v n="$SAMPLES" 'BEGIN{printf "%.2f", s + sp*(i+0.5)/n}')

  encode "$SS" "film-grain=0" "$TMPD/a.mkv"
  encode "$SS" "film-grain=${FILM_GRAIN}:film-grain-denoise=1" "$TMPD/b.mkv"
  B0=$(bytes "$TMPD/a.mkv"); BG=$(bytes "$TMPD/b.mkv")

  if [ "$B0" -gt 1000 ] && [ "$BG" -gt 1000 ]; then
    TOT0=$((TOT0 + B0)); TOTG=$((TOTG + BG)); OK=$((OK + 1))
    S=$(awk -v a="$B0" -v b="$BG" 'BEGIN{printf "%+.1f%%", (1-b/a)*100}')
  else
    S="failed"
  fi
  [ "$VERBOSE" = 1 ] && printf '%-3d %-10s %-12s %-12s %s\n' "$i" "$SS" "$B0" "$BG" "$S" >&2
  i=$((i + 1))
done

[ "$OK" -gt 0 ] || { echo "every probe encode failed" >&2; exit 2; }

SAVING=$(awk -v a="$TOT0" -v b="$TOTG" 'BEGIN{printf "%.2f", (1-b/a)*100}')
MBPS0=$(awk -v b="$TOT0" -v n="$OK" -v s="$SAMPLE_SECONDS" 'BEGIN{printf "%.3f", (b*8)/(n*s)/1000000}')

SAVED_MBPS=$(awk -v m="$MBPS0" -v s="$SAVING" 'BEGIN{printf "%.3f", m*s/100}')

# Decided on absolute bitrate recovered, not percentage: you only pay the
# denoiser's cost in real detail if it hands back enough bits to matter.
if awk -v v="$SAVED_MBPS" -v t="$T_SAVED_MBPS" 'BEGIN{exit !(v+0 >= t+0)}'; then VERDICT=true; else VERDICT=false; fi

if [ "$CSV" = 1 ]; then
  echo "file,width,height,pixfmt,crop,scaled,windows,secs,crf,preset,bytes_g0,bytes_gN,mbps_g0,saving_pct,saved_mbps,verdict"
  echo "\"$(basename "$FILE")\",${WIDTH},${HEIGHT},${PIXFMT},\"${CROP:-none}\",${SCALED},${OK},${SAMPLE_SECONDS},${CRF},${PRESET},${TOT0},${TOTG},${MBPS0},${SAVING},${SAVED_MBPS},${VERDICT}"
  exit 0
fi

if [ "$VERBOSE" = 1 ]; then
  {
    echo ""
    echo "file:      $(basename "$FILE")"
    echo "source:    ${WIDTH}x${HEIGHT} ${PIXFMT}, crop=${CROP:-none}, downscale=${SCALED} -> ${COMPRESSION_RESOLUTION}"
    echo "encode:    crf ${CRF} preset ${PRESET} ${CONTENT_KIND}, ${OK} x ${SAMPLE_SECONDS}s"
    echo "grain=0:   ${TOT0} bytes  (${MBPS0} Mbps at output resolution)"
    echo "grain=${FILM_GRAIN}:   ${TOTG} bytes"
    echo "saving:    ${SAVING}%"
    echo "saved:     ${SAVED_MBPS} Mbps   (threshold ${T_SAVED_MBPS})"
  } >&2
fi

echo "$VERDICT"
