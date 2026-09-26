// The worker-local LibraryLayout union, mirroring the layout names api resolves
// onto EncodeJobDetails.libraryLayout without importing them — same reasoning
// as ContentKind in `encode/content-kind.ts`. It names a naming convention,
// never a media-server product.

export type LibraryLayout = 'jellyfin' | 'plex';

export const LIBRARY_LAYOUT_VALUES: readonly LibraryLayout[] = ['jellyfin', 'plex'];

function isLibraryLayout(value: string): value is LibraryLayout {
  return (LIBRARY_LAYOUT_VALUES as readonly string[]).includes(value);
}

// A missing payload field is deliberately defended here rather than left to
// fail loudly (see worker/plan.md's Contract obligations). An absent, null or
// unrecognised value degrades to `jellyfin` and logs once — it must never
// throw, so an older or newer api can never fail an encode over a layout name.
export function normalizeLibraryLayout(raw: string | null | undefined): LibraryLayout {
  if (raw != null && isLibraryLayout(raw)) {
    return raw;
  }

  console.warn(`[library-layout] unrecognised libraryLayout ${JSON.stringify(raw)}, defaulting to jellyfin`);
  return 'jellyfin';
}
