import { Captions, Music2 } from "lucide-react";
import { useTranslations } from "next-intl";
import LanguageChips from "./LanguageChips";

type Props = {
  audio: string[] | null;
  subtitles: string[] | null;
  variant: "boxes" | "compact";
};

const BOX_CLASS =
  "dark:bg-dark-900 flex min-h-11 w-full items-center gap-2 rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-base text-gray-800 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 dark:bg-white/[0.03] dark:text-white/90";

export default function FileTrackLanguages({
  audio,
  subtitles,
  variant,
}: Props) {
  const t = useTranslations("fileTrackLanguages");

  if (audio === null && subtitles === null) {
    return null;
  }

  const compact = variant === "compact";
  const iconSize = compact ? 14 : 20;

  const lines = [
    { key: "audio", codes: audio, Icon: Music2, label: t("audio") },
    {
      key: "subtitles",
      codes: subtitles,
      Icon: Captions,
      label: t("subtitles"),
    },
  ];

  return (
    <div className={compact ? "space-y-1" : "mt-4 space-y-2"}>
      {lines.map(({ key, codes, Icon, label }) =>
        codes === null ? null : (
          <div
            key={key}
            className={
              compact
                ? "flex flex-nowrap items-center gap-1 whitespace-nowrap"
                : `${BOX_CLASS}`
            }
          >
            <Icon
              size={iconSize}
              aria-label={label}
              role="img"
              className="shrink-0 text-gray-500 dark:text-gray-400"
            />
            <LanguageChips codes={codes} variant={variant} />
          </div>
        ),
      )}
    </div>
  );
}
