import { parseListReference } from './list-reference';

// Article IX: a mis-parsed pasted URL silently attaches a different TMDB list
// than the one the user pasted (for example a locale segment or a slug digit
// read as the id), and every later sync imports the wrong titles with no error
// anywhere. These cases pin the id extraction and the rejections.
describe('parseListReference', () => {
  it('accepts a bare id, trimmed', () => {
    expect(parseListReference('8234')).toBe(8234);
    expect(parseListReference('  8234\n')).toBe(8234);
  });

  it('accepts a /list/<id> URL', () => {
    expect(parseListReference('https://www.themoviedb.org/list/8234')).toBe(
      8234,
    );
  });

  it('accepts a /list/<id>-slug URL without reading slug digits', () => {
    expect(
      parseListReference('https://www.themoviedb.org/list/8234-top-100-2024'),
    ).toBe(8234);
  });

  it('accepts a locale prefix', () => {
    expect(
      parseListReference('https://www.themoviedb.org/es-MX/list/8234-mi-lista'),
    ).toBe(8234);
  });

  it('ignores query string and fragment', () => {
    expect(
      parseListReference(
        'https://www.themoviedb.org/list/8234?language=es#top',
      ),
    ).toBe(8234);
  });

  it('rejects non-references', () => {
    expect(parseListReference('hello')).toBeNull();
    expect(parseListReference('0')).toBeNull();
    expect(parseListReference('-5')).toBeNull();
    expect(parseListReference('')).toBeNull();
  });

  it('rejects a /movie/<id> URL and another host', () => {
    expect(
      parseListReference('https://www.themoviedb.org/movie/603'),
    ).toBeNull();
    expect(parseListReference('https://example.com/list/8234')).toBeNull();
    expect(
      parseListReference('https://themoviedb.org.evil.com/list/8234'),
    ).toBeNull();
  });
});
