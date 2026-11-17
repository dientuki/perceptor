export type LibraryView = "grid" | "list";
export type LibraryFilter = "all" | "downloaded" | "added";
export type LibraryPossession = "ALL" | "DOWNLOADED" | "ADDED";

export const PAGE_SIZES = [12, 24, 48, 96] as const;
export type LibraryPageSize = (typeof PAGE_SIZES)[number];

export const LIBRARY_VIEWS: readonly LibraryView[] = ["grid", "list"];
export const LIBRARY_FILTERS: readonly LibraryFilter[] = [
  "all",
  "downloaded",
  "added",
];

export const DEFAULT_VIEW: LibraryView = "grid";
export const DEFAULT_PAGE_SIZE: LibraryPageSize = 24;
export const DEFAULT_FILTER: LibraryFilter = "all";
export const DEFAULT_PAGE = 1;

export const LIBRARY_DISPLAY_COOKIE = "perceptor_library_display";

export type LibraryDisplay = { view: LibraryView; pageSize: LibraryPageSize };

export type LibraryState = LibraryDisplay & {
  filter: LibraryFilter;
  page: number;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_DISPLAY: LibraryDisplay = {
  view: DEFAULT_VIEW,
  pageSize: DEFAULT_PAGE_SIZE,
};

function asView(value: string | undefined): LibraryView | undefined {
  return LIBRARY_VIEWS.find((v) => v === value);
}

function asPageSize(value: string | undefined): LibraryPageSize | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return PAGE_SIZES.find((s) => s === n);
}

function asFilter(value: string | undefined): LibraryFilter | undefined {
  return LIBRARY_FILTERS.find((f) => f === value);
}

function asPage(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

export function serializeDisplayCookie(display: LibraryDisplay): string {
  return `${display.view}:${display.pageSize}`;
}

export function parseDisplayCookie(raw: string | undefined): LibraryDisplay {
  if (!raw) return DEFAULT_DISPLAY;
  const [view, size, ...rest] = raw.split(":");
  if (rest.length > 0) return DEFAULT_DISPLAY;
  return {
    view: asView(view) ?? DEFAULT_VIEW,
    pageSize: asPageSize(size) ?? DEFAULT_PAGE_SIZE,
  };
}

export function normalize(
  raw: RawSearchParams,
  cookie: string | undefined,
): { state: LibraryState; invalid: boolean } {
  const defaults = parseDisplayCookie(cookie);
  let invalid = false;

  function read<T>(
    key: string,
    parse: (value: string | undefined) => T | undefined,
    fallback: T,
  ): T {
    const value = raw[key];
    if (value === undefined) return fallback;
    const parsed = typeof value === "string" ? parse(value) : undefined;
    if (parsed === undefined) {
      invalid = true;
      return fallback;
    }
    return parsed;
  }

  const state: LibraryState = {
    view: read("view", asView, defaults.view),
    pageSize: read("pageSize", asPageSize, defaults.pageSize),
    filter: read("filter", asFilter, DEFAULT_FILTER),
    page: read("page", asPage, DEFAULT_PAGE),
  };

  return { state, invalid };
}

export function toPossession(filter: LibraryFilter): LibraryPossession {
  switch (filter) {
    case "downloaded":
      return "DOWNLOADED";
    case "added":
      return "ADDED";
    default:
      return "ALL";
  }
}

export function libraryHref(
  pathname: string,
  state: LibraryState,
  overrides: Partial<LibraryState> = {},
  defaults: LibraryDisplay = DEFAULT_DISPLAY,
): string {
  const next = { ...state, ...overrides };
  const params = new URLSearchParams();
  if (next.view !== defaults.view) params.set("view", next.view);
  if (next.pageSize !== defaults.pageSize)
    params.set("pageSize", String(next.pageSize));
  if (next.filter !== DEFAULT_FILTER) params.set("filter", next.filter);
  if (next.page !== DEFAULT_PAGE) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
