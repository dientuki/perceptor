import { getMovies } from "@/actions/movies";
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE } from "@/types/media";

export default async function Movies({ isShort }: { isShort?: boolean }) {
  const dbMovies = await getMovies(isShort);

  return (
    <div>
      <MediaList
        items={dbMovies}
        mediaType={MEDIA_TYPE.MOVIE}
        showLink={true}
      />
    </div>
  );
}
