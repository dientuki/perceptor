import { getMovies } from "@/actions/movies";
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE } from "@/types/media";

export default async function Movies() {
  const dbMovies = await getMovies();

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
