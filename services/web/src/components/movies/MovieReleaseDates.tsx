import { useLocale, useTranslations } from "next-intl";
import type { Movie } from "@/actions/movies";

export default function MovieReleaseDates({ movie }: { movie: Movie }) {
  const t = useTranslations("movies.detail");
  const locale = useLocale();

  // Spec 093, REQ-1
  const entries = [
    {
      key: "theatrical",
      label: t("releaseTheatrical"),
      value: movie.theatricalReleaseDate,
    },
    {
      key: "digital",
      label: t("releaseDigital"),
      value: movie.digitalReleaseDate,
    },
    {
      key: "physical",
      label: t("releasePhysical"),
      value: movie.physicalReleaseDate,
    },
  ].filter((entry) => entry.value);

  if (entries.length === 0) return null;

  return (
    <p className="mt-1 flex flex-wrap gap-x-4 text-theme-sm text-gray-500 dark:text-gray-400">
      {entries.map((entry) => (
        <span key={entry.key}>
          {entry.label}:{" "}
          {new Date(entry.value as string).toLocaleDateString(locale, {
            timeZone: "UTC",
          })}
        </span>
      ))}
    </p>
  );
}
