import { fetchGraphQL } from './graphql-client';

interface TrackTitlesResponse {
  trackTitles: { iso3: string; title: string }[];
}

const QUERY = `
  query {
    trackTitles {
      iso3
      title
    }
  }
`;

export async function fetchTrackTitles(): Promise<Record<string, string>> {
  try {
    const data = await fetchGraphQL<TrackTitlesResponse>(QUERY);
    const map: Record<string, string> = {};
    for (const entry of data.trackTitles) {
      map[entry.iso3] = entry.title;
    }
    return map;
  } catch (err) {
    console.warn(
      `[track-titles] could not fetch track titles from api, falling back to ISO codes — ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}
