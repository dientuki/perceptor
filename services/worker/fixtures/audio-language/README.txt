Audio language detection fixtures (spec 122, T006)

Real captured output of the binaries in perceptor-worker:local-prod (whisper.cpp v1.9.5).
Nothing is scrambled: the input is synthetic (espeak-ng English, and digital silence), no film audio.
The WAVs are not committed (speech.wav is 259 KB, silent.wav 320 KB); regenerate them with:

  docker run --rm -u root -v "$PWD":/out --entrypoint sh node:24.18.0-alpine -c '
    apk add -q espeak-ng ffmpeg
    espeak-ng -v en -s 150 "This is a short test of spoken English. The quick brown fox jumps over the lazy dog, and then it goes home to sleep." -w /tmp/s.wav
    ffmpeg -y -i /tmp/s.wav -ar 16000 -ac 1 /out/speech.wav
    ffmpeg -y -f lavfi -i anullsrc=r=16000:cl=mono -t 10 /out/silent.wav'

Captured with (n = speech | silent), inside the worker image:

  whisper-cli -m /opt/whisper/ggml-small-q5_1.bin -l auto --detect-language -f /w/$n.wav \
      >$n.detect.stdout.txt 2>$n.detect.stderr.txt
  whisper-vad-speech-segments -vm /opt/whisper/ggml-silero-v5.1.2.bin -f /w/$n.wav \
      >$n.vad.stdout.txt 2>$n.vad.stderr.txt

Observed:
  - detect: stdout is empty; the verdict is on STDERR:
      whisper_full_with_state: auto-detected language: en (p = 0.970471)
    silent input still prints a line (en, p = 0.366482): a low probability, never "no line".
  - vad: stdout, units are CENTISECONDS (floats with two decimals):
      Detected 2 speech segments:
      Speech segment 0: start = 3.00, end = 243.00
    silent input: "Detected 0 speech segments:" and no segment lines.
    (stderr's "VAD segment N: start = 0.03, end = 2.43" lines are in seconds; do not parse those.)
  - exit code 0 in all four runs.
