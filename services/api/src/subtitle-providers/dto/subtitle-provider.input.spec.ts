// Guards against the global whitelist ValidationPipe stripping an undecorated field: a missing `kind` reached the service as undefined.
import { ValidationPipe } from '@nestjs/common';
import { SubtitleProviderInput, SubtitleProviderLanguageInput } from './subtitle-provider.input';

const pipe = new ValidationPipe({ whitelist: true, transform: true });

describe('subtitle provider inputs under the whitelist pipe', () => {
  it('keeps kind on the save input', async () => {
    const out = (await pipe.transform(
      { kind: 'SUBDIVX', username: null, secret: 'key' },
      { type: 'body', metatype: SubtitleProviderInput },
    )) as SubtitleProviderInput;
    expect(out.kind).toBe('SUBDIVX');
  });

  it('keeps provider on a entry input', async () => {
    const out = (await pipe.transform(
      { languageTag: 'es-419', provider: 'SUBDIVX' },
      { type: 'body', metatype: SubtitleProviderLanguageInput },
    )) as SubtitleProviderLanguageInput;
    expect(out.provider).toBe('SUBDIVX');
  });

  it('rejects an unknown kind', async () => {
    await expect(
      pipe.transform({ kind: 'NOPE' }, { type: 'body', metatype: SubtitleProviderInput }),
    ).rejects.toBeDefined();
  });
});
