import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMoviePage } from "@/actions/library";
import LibraryPager from "@/components/media/LibraryPager";
import LibraryToolbar from "@/components/media/LibraryToolbar";
import { MediaList } from "@/components/media/MediaList";
import MediaTable from "@/components/media/MediaTable";
import {
  LIBRARY_DISPLAY_COOKIE,
  libraryHref,
  normalize,
  parseDisplayCookie,
  type RawSearchParams,
  toPossession,
} from "@/lib/library-params";
import { MEDIA_TYPE } from "@/types/media";

type Props = {
  isShort?: boolean;
  pathname: string;
  searchParams: RawSearchParams;
};

// Spec 117, REQ-9 REQ-11
export default async function Movies({
  isShort,
  pathname,
  searchParams,
}: Props) {
  const t = await getTranslations("media.library");
  const cookie = (await cookies()).get(LIBRARY_DISPLAY_COOKIE)?.value;
  const defaults = parseDisplayCookie(cookie);
  const { state, invalid } = normalize(searchParams, cookie);

  if (invalid) redirect(libraryHref(pathname, state, {}, defaults));

  const result = await getMoviePage(
    isShort,
    toPossession(state.filter),
    state.page,
    state.pageSize,
  );

  if (result.totalCount > 0 && result.page !== state.page) {
    redirect(libraryHref(pathname, state, { page: result.page }, defaults));
  }

  const showControls = result.totalCount > 0 || state.filter !== "all";

  return (
    <div className="space-y-6">
      {showControls && (
        <LibraryToolbar pathname={pathname} state={state} defaults={defaults} />
      )}
      {state.view === "list" ? (
        <MediaTable items={result.items} mediaType={MEDIA_TYPE.MOVIE} />
      ) : (
        <MediaList
          items={result.items}
          mediaType={MEDIA_TYPE.MOVIE}
          showLink={true}
          emptyMessage={state.filter !== "all" ? t("emptyFilter") : undefined}
        />
      )}
      <LibraryPager
        pathname={pathname}
        state={state}
        defaults={defaults}
        page={result.page}
        totalPages={result.totalPages}
        totalCount={result.totalCount}
      />
    </div>
  );
}
