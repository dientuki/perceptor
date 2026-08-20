import { getShows } from "@/actions/shows";
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE } from "@/types/media";

export default async function Shows() {
  const dbShows = await getShows();

  return (
    <div>
      <MediaList items={dbShows} mediaType={MEDIA_TYPE.SHOW} showLink={true} />
    </div>
  );
}
