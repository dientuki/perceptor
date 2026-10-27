import { Captions, Music2 } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const chipClass = compact
    ? "rounded bg-gray-100 px-1 py-0.5 text-xs font-medium text-gray-700 dark:bg-white/[0.05] dark:text-gray-300"
    : "rounded-md bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-700 dark:bg-white/[0.05] dark:text-gray-300";

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
              compact ? "flex flex-nowrap items-center gap-1 whitespace-nowrap" : `${BOX_CLASS}`
            }
          >
            <Icon
              size={iconSize}
              aria-label={label}
              role="img"
              className="shrink-0 text-gray-500 dark:text-gray-400"
            />
            {codes.length === 0 ? (
              <span className="text-gray-400 dark:text-gray-500">—</span>
            ) : (
              <span className={compact ? "flex gap-1" : "flex flex-wrap gap-1"}>
                {codes.map((code) => (
                  <span key={code} className={chipClass}>
                    {code.toUpperCase()}
                  </span>
                ))}
              </span>
            )}
          </div>
        ),
      )}
    </div>
  );
}
