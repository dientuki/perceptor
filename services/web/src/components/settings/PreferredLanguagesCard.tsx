import { getTranslations } from "next-intl/server";
import { setPreferredLanguagesAction } from "@/actions/languages";
import LanguagePicker from "@/components/media/LanguagePicker";
import type { Language } from "@/types/languages";

interface PreferredLanguagesCardProps {
  options: Language[];
  selected: Language[];
}

// Its own card, its own action — not part of SettingsForm. SettingsForm
// posts through updateSettings/EDITABLE_KEYS, which is installation-wide
// key/value config; this is a per-user preference with no key behind it.
export default async function PreferredLanguagesCard({
  options,
  selected,
}: PreferredLanguagesCardProps) {
  const t = await getTranslations("settings.languages");
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
        {t("title")}
      </h3>
      <p className="mb-4 text-xs text-gray-500">{t("description")}</p>
      <div className="max-w-lg">
        <LanguagePicker
          options={options}
          selected={selected}
          action={setPreferredLanguagesAction}
          label={t("label")}
        />
      </div>
    </div>
  );
}
