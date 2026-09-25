import { resolveAllowedSubtitleFormats } from './subtitle-formats';

// This suite exists because otherwise a wrong default or a mishandled stored
// row in the subtitle format resolution fails with no error anywhere: the
// worker would strip or keep subtitle tracks in every encode, and the filed
// library files are permanent, so the mistake is only found by someone missing
// a track weeks later. Each case fails if the matching rule (no-subtitles
// override, group toggle, missing-row default, group-scoped filtering, catalog
// order) is removed.
describe('resolveAllowedSubtitleFormats', () => {
  const TEXT = ['srt', 'ass', 'webvtt', 'mov_text'];

  it('resolves to the text catalog when every row is missing', () => {
    expect(resolveAllowedSubtitleFormats({})).toEqual(TEXT);
  });

  it('is empty when subtitles are disabled, whatever the rest says', () => {
    expect(
      resolveAllowedSubtitleFormats({
        subtitles_enabled: 'false',
        subtitles_text_enabled: 'true',
        subtitles_text_formats: 'srt',
        subtitles_image_enabled: 'true',
        subtitles_image_formats: 'pgs',
      }),
    ).toEqual([]);
  });

  it('is empty when the text group is allowed with no formats checked', () => {
    expect(resolveAllowedSubtitleFormats({ subtitles_text_formats: '' })).toEqual([]);
  });

  it('is empty when both groups are off', () => {
    expect(
      resolveAllowedSubtitleFormats({ subtitles_text_enabled: 'false', subtitles_image_enabled: 'false' }),
    ).toEqual([]);
  });

  it('adds no image ids while the image row is missing', () => {
    expect(resolveAllowedSubtitleFormats({ subtitles_text_enabled: 'true' })).toEqual(TEXT);
  });

  it('lists text ids then image ids when both groups are on', () => {
    expect(
      resolveAllowedSubtitleFormats({
        subtitles_image_enabled: 'true',
        subtitles_text_formats: 'srt',
        subtitles_image_formats: 'dvb,pgs',
      }),
    ).toEqual(['srt', 'pgs', 'dvb']);
  });

  it('uses the full image catalog when the image group is on and its list row is missing', () => {
    expect(
      resolveAllowedSubtitleFormats({ subtitles_text_enabled: 'false', subtitles_image_enabled: 'true' }),
    ).toEqual(['pgs', 'vobsub', 'dvb']);
  });

  it('drops corrupt ids and ids from the other group', () => {
    expect(
      resolveAllowedSubtitleFormats({
        subtitles_image_enabled: 'true',
        subtitles_text_formats: 'srt,pgs,bogus',
        subtitles_image_formats: 'pgs,garbage,srt',
      }),
    ).toEqual(['srt', 'pgs']);
  });

  it('returns ids in catalog order regardless of stored order', () => {
    expect(resolveAllowedSubtitleFormats({ subtitles_text_formats: 'mov_text, srt,ass' })).toEqual([
      'srt',
      'ass',
      'mov_text',
    ]);
  });
});
