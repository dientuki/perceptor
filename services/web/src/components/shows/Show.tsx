import Image from "next/image";
import { getTranslations } from "next-intl/server";
import {
  setShowAudioMandatoryAction,
  setShowPreferredTrackLanguagesAction,
} from "@/actions/languages";
import type { Show as ShowRecord } from "@/actions/shows";
import {
  refreshShowAction,
  removeShowAction,
  setShowContentKindAction,
} from "@/actions/shows";
import ContentKindSelect from "@/components/media/ContentKindSelect";
import RefreshTitleButton from "@/components/media/RefreshTitleButton";
import RemoveTitleButton from "@/components/media/RemoveTitleButton";
import TitleLanguagesPanel from "@/components/media/TitleLanguagesPanel";
import StatusBadge from "@/components/status/StatusBadge";
import { effectiveLanguages } from "@/lib/effective-languages";
import type { Language } from "@/types/languages";
import type { UserPreferences } from "@/types/preferences";

export default async function Show({
  show,
  languageOptions,
  preferences,
}: {
  show: ShowRecord;
  languageOptions: Language[];
  preferences: UserPreferences | null;
}) {
  const t = await getTranslations("shows.detail");
  const setShowAudioLanguages = setShowPreferredTrackLanguagesAction.bind(
    null,
    show.id,
    "AUDIO",
  );
  const setShowSubtitleLanguages = setShowPreferredTrackLanguagesAction.bind(
    null,
    show.id,
    "SUBTITLE",
  );
  const setShowAudioMandatory = setShowAudioMandatoryAction.bind(null, show.id);
  const setShowContentKind = setShowContentKindAction.bind(
    null,
    Number(show.id),
  );

  const audioLanguages = show.audioLanguages ?? [];
  const subtitleLanguages = show.subtitleLanguages ?? [];
  const audioMandatory = show.audioMandatory ?? false;
  const effective = effectiveLanguages(
    { audioLanguages, subtitleLanguages, audioMandatory },
    preferences,
  );

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-[16rem_minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        {show.posterUrl ? (
          // El posterUrl del api es w300 (300px de ancho); pedir más grande lo escala y se ve borroso
          <Image
            src={show.posterUrl}
            alt={show.title}
            width={300}
            height={450}
            className="rounded-xl shadow-md"
            priority
          />
        ) : (
          <div className="flex aspect-[2/3] items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <span className="text-gray-400 italic">{t("noPoster")}</span>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-6">
        <div>
          <h3 className="mb-2 text-2xl font-bold text-gray-800 dark:text-white/90">
            {show.title}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {show.releaseDate
              ? new Date(show.releaseDate).getUTCFullYear()
              : t("unknownYear")}{" "}
            • {show.originalLanguage.toUpperCase()} •{" "}
            <StatusBadge status={show.status} />
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-semibold uppercase tracking-wider text-gray-400">
            {t("synopsisTitle")}
          </h4>
          <p className="text-gray-600 dark:text-gray-300 leading-relaxed italic">
            {show.overview || t("noOverview")}
          </p>
        </div>
      </div>

      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap gap-3">
          <RefreshTitleButton
            onRefresh={refreshShowAction.bind(null, show.id)}
          />
          <RemoveTitleButton
            title={show.title}
            otherOwners={show.otherOwners ?? 0}
            hasLibraryFile={(show.seasons ?? []).some((season) =>
              season.episodes.some((episode) => episode.status === "COMPLETED"),
            )}
            redirectTo="/shows"
            onConfirm={removeShowAction.bind(null, show.id)}
          />
        </div>

        <ContentKindSelect
          value={show.contentKind}
          onSave={setShowContentKind}
          label={t("contentKindLabel")}
        />

        <TitleLanguagesPanel
          effective={effective}
          options={languageOptions}
          audioSelected={audioLanguages}
          subtitleSelected={subtitleLanguages}
          audioMandatory={audioMandatory}
          setAudioAction={setShowAudioLanguages}
          setSubtitleAction={setShowSubtitleLanguages}
          setAudioMandatoryAction={setShowAudioMandatory}
        />
      </div>
    </div>
  );
}
