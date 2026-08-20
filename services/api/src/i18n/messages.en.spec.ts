import { ERROR_KEYS } from '@/i18n/error-keys';
import { MESSAGES_EN } from '@/i18n/messages.en';

/**
 * REQ-8's English `message` is the only thing standing between a `web`
 * catalog gap and a raw `error.movie.not_found` rendered verbatim on a
 * user's screen (`graphql-error.formatter.ts`'s `renderMessage` falls back
 * to the key itself when a template is missing, on purpose — it stays
 * total rather than throwing from inside an error factory). That fallback
 * silently produces garbage: a message with an unsatisfiable `{param}`
 * placeholder renders the literal `{param}` string, not an error. Both
 * classes of bug are undetectable at the one throw site that happens to hit
 * them and are only caught here, once, for every key.
 */
describe('messages.en', () => {
  const errorKeyValues = Object.values(ERROR_KEYS);

  it('has an English message for every constant in error-keys.ts', () => {
    for (const key of errorKeyValues) {
      expect(MESSAGES_EN[key]).toEqual(expect.any(String));
      expect(MESSAGES_EN[key].length).toBeGreaterThan(0);
    }
  });

  it('has no orphaned message for a key error-keys.ts no longer declares', () => {
    const knownKeys = new Set<string>(errorKeyValues);
    for (const key of Object.keys(MESSAGES_EN)) {
      expect(knownKeys.has(key)).toBe(true);
    }
  });

  it('fails when a key is missing its message — proves the first assertion is not vacuous', () => {
    const incomplete: Record<string, string> = { ...MESSAGES_EN };
    delete incomplete[ERROR_KEYS.MOVIE_NOT_FOUND];

    expect(incomplete[ERROR_KEYS.MOVIE_NOT_FOUND]).toBeUndefined();
  });

  it('only uses {param} placeholders, never a bare {} or nested braces', () => {
    // Guards the interpolation contract `i18n-error.ts`'s `renderMessage` relies
    // on: a placeholder is `\{(\w+)\}` — anything else (an empty pair, a
    // hyphenated name) would silently pass through the regex untouched and
    // reach the user as literal braces.
    const placeholderPattern = /\{[^}]*\}/g;
    const validPlaceholder = /^\{\w+\}$/;

    for (const [key, template] of Object.entries(MESSAGES_EN)) {
      const placeholders = template.match(placeholderPattern) ?? [];
      for (const placeholder of placeholders) {
        expect(validPlaceholder.test(placeholder)).toBe(true);
        if (!validPlaceholder.test(placeholder)) {
          throw new Error(`${key} has an unsatisfiable placeholder: ${placeholder}`);
        }
      }
    }
  });
});
