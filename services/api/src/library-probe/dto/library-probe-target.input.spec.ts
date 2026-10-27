// Defends against the global ValidationPipe ({ whitelist: true }) stripping every
// property of an input class that carries no class-validator decorator: the target
// then arrives as {} and the probe answers invalid_target for every title, with no
// error anywhere in unit tests that skip the pipe.
import { ValidationPipe } from '@nestjs/common';
import { LibraryProbeTarget } from './library-probe-target.input';

describe('LibraryProbeTarget through the global ValidationPipe', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const run = (value: object) =>
    pipe.transform(value, { type: 'body', metatype: LibraryProbeTarget });

  it('keeps movieId when only a film is sent', async () => {
    const out = (await run({ movieId: 16 })) as LibraryProbeTarget;
    expect(out.movieId).toBe(16);
    expect(out.episodeId).toBeUndefined();
  });

  it('keeps episodeId when only an episode is sent', async () => {
    const out = (await run({ episodeId: 3 })) as LibraryProbeTarget;
    expect(out.episodeId).toBe(3);
    expect(out.movieId).toBeUndefined();
  });
});
