#!/usr/bin/env bash
# Stage 1 grain detector: metadata only, never decodes a frame.
#
# Usage: etapa1-metadata.sh [-v|--csv] <file>
#   stdout: "true" (has grain) or "false" (no grain)
#   -v     also print the score breakdown on stderr
#   --csv  print one CSV row of raw features instead of the verdict
#   exit 0 ok, 2 usage/probe error
#
# Every threshold below is a GUESS. Calibrate with --csv over labelled files.
set -uo pipefail

VERBOSE=0; CSV=0
while [ $# -gt 0 ]; do
  case "$1" in
    -v) VERBOSE=1; shift ;;
    --csv) CSV=1; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) break ;;
  esac
done

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "usage: $(basename "$0") [-v|--csv] <file>" >&2
  exit 2
fi
command -v ffprobe >/dev/null 2>&1 || { echo "ffprobe not found" >&2; exit 2; }

: "${T_SCORE:=2}"
: "${T_BPPPF_HIGH:=0.20}"
: "${T_BPPPF_MID:=0.13}"
: "${T_BPPPF_LOW:=0.07}"

fgte() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a+0 >= b+0)}'; }
flt()  { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a+0 <  b+0)}'; }

probe_v()   { ffprobe -v error -select_streams v:0 -show_entries "stream=$1" -of default=nw=1:nk=1 "$FILE" 2>/dev/null | head -1; }
probe_fmt() { ffprobe -v error -show_entries "format=$1" -of default=nw=1:nk=1 "$FILE" 2>/dev/null | head -1; }

CODEC=$(probe_v codec_name)
WIDTH=$(probe_v width)
HEIGHT=$(probe_v height)
VBITRATE=$(probe_v bit_rate)
FPS_RAW=$(probe_v avg_frame_rate)
PIXFMT=$(probe_v pix_fmt)
FSIZE=$(probe_fmt size)
FDUR=$(probe_fmt duration)

[ -n "$CODEC" ] || { echo "no video stream in $FILE" >&2; exit 2; }

# ffprobe reports avg_frame_rate as a rational string ("24000/1001"); Number()
# on that is NaN, which is the archetypal bug this project already documents in
# src/ffmpeg/remux-detection.ts. Parse the fraction.
FPS=$(awk -v r="$FPS_RAW" 'BEGIN{
  n=split(r,p,"/"); num=p[1]+0; den=(n>1)?p[2]+0:1;
  if (den==0 || num<=0) { print 0 } else { printf "%.6f", num/den }
}')

# Video bitrate, in the same three-step fallback order the worker already uses:
# stream bit_rate -> BPS tag -> format size/duration.
BPS_TAG=$(ffprobe -v error -select_streams v:0 -show_entries stream_tags=BPS -of default=nw=1:nk=1 "$FILE" 2>/dev/null | head -1)
BITRATE=$(awk -v a="${VBITRATE:-0}" -v b="${BPS_TAG:-0}" -v s="${FSIZE:-0}" -v d="${FDUR:-0}" 'BEGIN{
  if (a+0 > 0) { print a+0; exit }
  if (b+0 > 0) { print b+0; exit }
  if (s+0 > 0 && d+0 > 0) { printf "%.0f", (s*8)/d; exit }
  print 0
}')

BPPPF=$(awk -v br="$BITRATE" -v w="${WIDTH:-0}" -v h="${HEIGHT:-0}" -v f="$FPS" 'BEGIN{
  px = w*h;
  if (px<=0 || f<=0 || br<=0) { print "0" } else { printf "%.5f", br/px/f }
}')

# Codec efficiency factor: the same perceptual quality costs fewer bits in a
# newer codec, so a raw bits-per-pixel-per-frame number is not comparable
# across codecs. Normalize to an H264-equivalent scale.
case "$CODEC" in
  h264|avc|mpeg2video|mpeg4|vc1) FACTOR=1.0 ;;
  hevc|h265|vp9)                 FACTOR=1.8 ;;
  av1)                           FACTOR=2.4 ;;
  *)                             FACTOR=1.0 ;;
esac
NBPPPF=$(awk -v v="$BPPPF" -v f="$FACTOR" 'BEGIN{printf "%.5f", v*f}')

HAYSTACK=$(ffprobe -v error -show_entries stream_tags:format_tags -of flat "$FILE" 2>/dev/null | tr '[:upper:]' '[:lower:]')
if command -v mediainfo >/dev/null 2>&1; then
  HAYSTACK="$HAYSTACK
$(mediainfo "$FILE" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
fi
# Scene releases carry their provenance in the DIRECTORY name, not the file's:
# ".../The Hurricane Heist 2018 UHD BluRay 2160p ... x265-E/The Hurricane Heist
# 2018.mkv" has every marker in the folder and none in the basename, so reading
# only the basename evaluated both name rules against nothing.
BASENAME=$(printf '%s %s' "$(basename "$(dirname "$FILE")")" "$(basename "$FILE")" | tr '[:upper:]' '[:lower:]')

ACODECS=$(ffprobe -v error -select_streams a -show_entries stream=codec_name,profile -of csv=p=0 "$FILE" 2>/dev/null | tr '[:upper:]' '[:lower:]')

YEAR=$(echo "$BASENAME" | grep -oE '(19|20)[0-9]{2}' | awk -v now="$(date +%Y)" '{ if ($1+0>=1900 && $1+0<=now) { print $1; exit } }')

SCORE=0
REASONS=""
add() { SCORE=$((SCORE + $1)); REASONS="${REASONS}  ${2}: $(printf '%+d' "$1")
"; }

# Someone already decided this has grain: x264/x265 tune=grain, or a nonzero
# film-grain parameter in an AV1 encoder settings string.
if echo "$HAYSTACK" | grep -qE 'tune[=: ]+grain|--tune +grain'; then
  add 3 "encoder tune=grain"
fi
FG=$(echo "$HAYSTACK" | grep -oE 'film[-_]grain[=: ]+[0-9]+' | grep -oE '[0-9]+$' | sort -rn | head -1)
if [ -n "${FG:-}" ] && [ "$FG" -gt 0 ] 2>/dev/null; then
  add 3 "encoder film-grain=$FG"
fi

if fgte "$NBPPPF" "$T_BPPPF_HIGH"; then
  add 2 "normalized bpppf $NBPPPF >= $T_BPPPF_HIGH"
elif fgte "$NBPPPF" "$T_BPPPF_MID"; then
  add 1 "normalized bpppf $NBPPPF >= $T_BPPPF_MID"
elif flt "$NBPPPF" "$T_BPPPF_LOW"; then
  add -2 "normalized bpppf $NBPPPF < $T_BPPPF_LOW"
fi

# A lossless audio track means a disc rip rather than a re-encode, which
# correlates with an untouched (grainy) video track. Broader than the worker's
# own isRemux(): flac and alac are lossless too and are what boutique MKV
# remuxes actually carry, which isRemux() does not need to know but this prior
# does -- missing flac cost a real 1987 35mm remux a point it had earned.
if echo "$ACODECS" | grep -qE 'truehd|mlp|pcm_|flac|alac|dts-hd ma|dts-hd master'; then
  add 1 "lossless audio present (disc rip)"
fi

if echo "$BASENAME" | grep -qE 'remux|bluray|blu-ray|bdrip|bd25|bd50|uhdbd'; then
  add 1 "disc source in filename"
fi
if echo "$BASENAME" | grep -qE 'web-?dl|web-?rip|amzn|nf\.|dsnp|hmax|atvp|webdl'; then
  add -1 "streaming source in filename (platform already denoised)"
fi

# Shot on film rather than digital: a prior, never a proof.
if [ -n "${YEAR:-}" ] && [ "$YEAR" -lt 2002 ] 2>/dev/null; then
  add 1 "year $YEAR (likely shot on film)"
fi

if [ "$SCORE" -ge "$T_SCORE" ]; then VERDICT=true; else VERDICT=false; fi

if [ "$CSV" = 1 ]; then
  echo "file,codec,width,height,pixfmt,fps,bitrate,bpppf,nbpppf,score,verdict"
  echo "\"$(basename "$FILE")\",$CODEC,${WIDTH:-0},${HEIGHT:-0},${PIXFMT:-?},$FPS,$BITRATE,$BPPPF,$NBPPPF,$SCORE,$VERDICT"
  exit 0
fi

if [ "$VERBOSE" = 1 ]; then
  {
    echo "file:      $(basename "$FILE")"
    echo "codec:     $CODEC ${WIDTH}x${HEIGHT} ${PIXFMT} @ ${FPS}fps"
    echo "bitrate:   ${BITRATE} bps"
    echo "bpppf:     $BPPPF  (x${FACTOR} codec factor -> $NBPPPF normalized)"
    echo "score:     $SCORE  (threshold $T_SCORE)"
    printf '%s' "$REASONS"
  } >&2
fi

echo "$VERDICT"
