// Defends REQ-9/AC-5 of 051-language-track-titles: fetchTrackTitles must
// never let a transport failure escape and fail an otherwise-successful
// encode job over a cosmetic track title. Two classes of bug this guards
// against:
//   1. The fold mis-keys or drops an entry, so a track title silently
//      resolves to the wrong string or falls back to the ISO code even
//      though api answered fine.
//   2. A thrown error from fetchGraphQL (ApiUnreachableError, a non-2xx, a
//      GraphQL error) propagates out of fetchTrackTitles instead of
//      degrading to an empty map, which would fail a multi-hour encode.

import { describe, expect, it, vi } from 'vitest';

vi.mock('./graphql-client', () => ({
  fetchGraphQL: vi.fn(),
}));

import { fetchGraphQL } from './graphql-client';
import { fetchTrackTitles } from './track-titles';

describe('fetchTrackTitles', () => {
  it('folds the list into a Record keyed by iso3', async () => {
    (fetchGraphQL as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      trackTitles: [
        { iso3: 'eng', title: 'English' },
        { iso3: 'fre', title: 'Français' },
      ],
    });

    const result = await fetchTrackTitles();

    expect(result).toEqual({ eng: 'English', fre: 'Français' });
  });

  it('resolves to {} instead of throwing when fetchGraphQL rejects', async () => {
    (fetchGraphQL as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('could not reach api'),
    );

    await expect(fetchTrackTitles()).resolves.toEqual({});
  });
});
