import { getTranslations } from "next-intl/server";

const SWATCHES = [
  { key: "legendCompleted", className: "bg-success-500" },
  { key: "legendProgress", className: "bg-brand-500" },
  { key: "legendError", className: "bg-error-500" },
  { key: "legendMissing", className: "bg-gray-400" },
] as const;

export default async function CalendarLegend() {
  const t = await getTranslations("calendar");

  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-gray-700 dark:text-gray-400">
      {SWATCHES.map((swatch) => (
        <li key={swatch.key} className="flex items-center gap-2">
          <span
            className={`inline-block size-3 rounded-full ${swatch.className}`}
          />
          {t(swatch.key)}
        </li>
      ))}
    </ul>
  );
}
