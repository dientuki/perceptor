import { getTranslations } from "next-intl/server";
import { getMovies } from "@/actions/movies";
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE } from "@/types/media";

export default async function Shorts() {
  const t = await getTranslations("media.list");
  const dbMovies = await getMovies(true);

  return (
    <div>
      <MediaList
        items={dbMovies}
        // Cards keep MEDIA_TYPE.MOVIE so they link to /movies/[id] — there is
        // no /shorts/[id] (spec REQ-9).
        mediaType={MEDIA_TYPE.MOVIE}
        showLink={true}
        emptyMessage={t("emptyShorts")}
      />
    </div>
  );
}
