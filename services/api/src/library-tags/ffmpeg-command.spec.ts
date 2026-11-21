import { parseEncodeCommand, tokenize } from './ffmpeg-command';

// This suite exists because the parsed command is written into a library file
// as if it were the truth about how that file was encoded. A mis-read flag
// (an ANIME command reported as LIVE_ACTION, a copy given a CRF, a ceiling
// invented from a box the command only bounds) is stamped into the file's
// PERCEPTOR tags permanently and nothing errors anywhere. The fixtures are the
// shapes the worker has actually stored across eras (runner.ts joins args with
// spaces and double-quotes any argument containing one), with paths anonymised.

const COMMON =
  '-hide_banner -y -i /downloads/Release-GRP/Release-GRP.mkv -progress pipe:1';
const SVT = 'keyint=10s:scd=1:enable-overlays=1:tune=0:input-depth=10';
const OUT = '/library/Movies/Film (2020)/Film (2020).working.mkv';

const eraCommands = {
  // 011: scm=0 only for live action, no film-grain flag at all
  '011 live action': `ffmpeg ${COMMON} -map 0:v:0 -c:v libsvtav1 -crf 22 -preset 4 -pix_fmt yuv420p10le -svtav1-params ${SVT}:scm=0 -metadata:s:v:0 "title=AV1 (Converted from H264)" ${OUT}`,
  // 011: HDR downscale through libplacebo, a box the parser does not read
  '011 hdr downscale': `ffmpeg ${COMMON} -map 0:v:0 -vf libplacebo=w=1920:h=1080:colorspace=bt709 -c:v libsvtav1 -crf 22 -preset 4 -pix_fmt yuv420p10le -svtav1-params ${SVT}:scm=0 ${OUT}`,
  // 057: content kind branches, film-grain=0 always, 1080p scale without divisible
  '057 live action': `ffmpeg ${COMMON} -map 0:v:0 -vf scale=1920:1080:force_original_aspect_ratio=decrease -c:v libsvtav1 -crf 24 -preset 4 -pix_fmt yuv420p10le -svtav1-params ${SVT}:scm=0:aq-mode=2:sharpness=0:film-grain=0 ${OUT}`,
  '057 anime': `ffmpeg ${COMMON} -map 0:v:0 -c:v libsvtav1 -crf 24 -preset 4 -pix_fmt yuv420p10le -svtav1-params ${SVT}:scm=2:aq-mode=2:enable-qm=1:qm-min=4:sharpness=2:film-grain=0 ${OUT}`,
  // 058: ceiling tiers through scale, a copy when the source already fits
  '058 720p ceiling': `ffmpeg ${COMMON} -map 0:v:0 -vf scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2 -c:v libsvtav1 -crf 24 -preset 4 -svtav1-params ${SVT}:scm=2:aq-mode=2:enable-qm=1:qm-min=4:sharpness=2:film-grain=0 ${OUT}`,
  '058 copy': `ffmpeg ${COMMON} -map 0:v:0 -c:v copy -metadata:s:v:0 "title=Video (Direct Copy)" ${OUT}`,
  // 092: film grain on
  '092 grain on': `ffmpeg ${COMMON} -map 0:v:0 -c:v libsvtav1 -crf 22 -preset 4 -pix_fmt yuv420p10le -svtav1-params ${SVT}:scm=0:aq-mode=2:sharpness=0:film-grain=8:film-grain-denoise=1 ${OUT}`,
  // 115: deinterlace in front of a scale
  '115 interlaced': `ffmpeg ${COMMON} -map 0:v:0 -vf bwdif=mode=send_frame:parity=tff:deint=interlaced,scale=854:480:force_original_aspect_ratio=decrease:force_divisible_by=2 -c:v libsvtav1 -crf 24 -preset 4 -aspect 16:9 -svtav1-params ${SVT}:scm=0:aq-mode=2:sharpness=0:film-grain=0 ${OUT}`,
  // a path containing spaces, quoted by the runner
  spaces: `ffmpeg -hide_banner -y -i "/downloads/Some Release GRP/Some Release GRP.mkv" -map 0:v:0 -c:v libsvtav1 -crf 22 -preset 4 -svtav1-params ${SVT}:scm=0:film-grain=8:film-grain-denoise=1 -metadata "title=Film: A Story (2020)" "/library/Movies/Film A Story (2020)/Film A Story (2020).working.mkv"`,
};

describe('parseEncodeCommand', () => {
  it('reads CRF, preset, codec and live action from an 011-era command with no grain flag', () => {
    expect(parseEncodeCommand(eraCommands['011 live action'])).toEqual({
      videoCodec: 'av1',
      crf: 22,
      preset: 4,
      contentKind: 'LIVE_ACTION',
      resolutionCeiling: null,
      outputResolution: null,
      deinterlaced: null,
      grainApplied: null,
    });
  });

  it('does not invent a ceiling from a libplacebo box', () => {
    expect(
      parseEncodeCommand(eraCommands['011 hdr downscale']).resolutionCeiling,
    ).toBeNull();
  });

  it('maps scm=0 to LIVE_ACTION and reports no grain for film-grain=0', () => {
    expect(parseEncodeCommand(eraCommands['057 live action'])).toMatchObject({
      contentKind: 'LIVE_ACTION',
      grainApplied: false,
      resolutionCeiling: '1080p',
      crf: 24,
    });
  });

  it('gives a null kind for ANIME/CGI, which tune identically', () => {
    expect(parseEncodeCommand(eraCommands['057 anime'])).toMatchObject({
      videoCodec: 'av1',
      contentKind: null,
    });
    expect(parseEncodeCommand(eraCommands['058 720p ceiling'])).toMatchObject({
      contentKind: null,
      resolutionCeiling: '720p',
    });
  });

  it('reports grain applied for film-grain=8', () => {
    expect(parseEncodeCommand(eraCommands['092 grain on'])).toMatchObject({
      grainApplied: true,
      crf: 22,
    });
  });

  it('reads bwdif as deinterlaced and the box after it as the ceiling', () => {
    expect(parseEncodeCommand(eraCommands['115 interlaced'])).toMatchObject({
      deinterlaced: true,
      resolutionCeiling: '480p',
      contentKind: 'LIVE_ACTION',
    });
  });

  it('gives a copy no CRF, preset, grain, kind or ceiling', () => {
    expect(parseEncodeCommand(eraCommands['058 copy'])).toEqual({
      videoCodec: 'copy',
      crf: null,
      preset: null,
      contentKind: null,
      resolutionCeiling: null,
      outputResolution: null,
      deinterlaced: null,
      grainApplied: null,
    });
  });

  it('never states an output resolution, whatever the command says', () => {
    for (const command of Object.values(eraCommands)) {
      expect(parseEncodeCommand(command).outputResolution).toBeNull();
    }
  });

  it('survives a path with spaces and a quoted metadata value', () => {
    expect(tokenize(eraCommands.spaces)).toContain(
      '/downloads/Some Release GRP/Some Release GRP.mkv',
    );
    expect(parseEncodeCommand(eraCommands.spaces)).toMatchObject({
      videoCodec: 'av1',
      crf: 22,
      preset: 4,
      contentKind: 'LIVE_ACTION',
      grainApplied: true,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['prose', 'this is not a command at all'],
    ['unterminated quote', 'ffmpeg -c:v libsvtav1 -crf "22'],
    ['flag with no value', 'ffmpeg -c:v'],
    ['non-numeric crf', 'ffmpeg -c:v libsvtav1 -crf high -preset slow'],
  ])('returns nulls without throwing for %s', (_name, input) => {
    const result = parseEncodeCommand(input as string | null | undefined);
    expect(result.contentKind).toBeNull();
    expect(result.crf).toBeNull();
    expect(result.preset).toBeNull();
    expect(result.grainApplied).toBeNull();
    expect(result.resolutionCeiling).toBeNull();
    expect(result.outputResolution).toBeNull();
  });
});
