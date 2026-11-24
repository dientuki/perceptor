"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  getSubtitleProviders,
  removeSubtitleProviderAction,
} from "@/actions/subtitle-providers";
import RemoveSubtitleProviderModal from "@/components/subtitle-providers/RemoveSubtitleProviderModal";
import SubtitleLanguagesEditor from "@/components/subtitle-providers/SubtitleLanguagesEditor";
import SubtitleProviderModal from "@/components/subtitle-providers/SubtitleProviderModal";
import SubtitleProviderRow from "@/components/subtitle-providers/SubtitleProviderRow";
import Button from "@/components/ui/button/Button";
import type { Language } from "@/types/languages";
import type {
  SubtitleProvider,
  SubtitleProviderSettings,
} from "@/types/subtitle-providers";

interface SubtitleProvidersPanelProps {
  initial: SubtitleProviderSettings;
  languages: Language[];
}

const NOT_CONFIGURED_KEY = "error.subtitleProvider.not_configured";

// Spec 121, REQ-3
export default function SubtitleProvidersPanel({
  initial,
  languages,
}: SubtitleProvidersPanelProps) {
  const t = useTranslations("subtitleProviders");
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SubtitleProvider | null>(null);
  const [removing, setRemoving] = useState<SubtitleProvider | null>(null);

  const configured = settings.providers.filter((p) => p.configured);
  const unconfigured = settings.providers.filter((p) => !p.configured);

  // Spec 121, REQ-16
  const handleSaved = (next: SubtitleProviderSettings) => {
    setSettings(next);
    router.refresh();
  };

  const handleRemove = async (): Promise<string | null> => {
    if (!removing) return null;

    const result = await removeSubtitleProviderAction(removing.kind);

    if ("settings" in result) {
      handleSaved(result.settings);
      return null;
    }

    if (result.errorKey === NOT_CONFIGURED_KEY) {
      // Another administrator may have removed it already.
      handleSaved(await getSubtitleProviders());
    }

    return result.error;
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            {t("title")}
          </h3>
          {unconfigured.length > 0 && (
            <Button
              size="sm"
              startIcon={<Plus size={16} />}
              onClick={() => setAdding(true)}
            >
              {t("add")}
            </Button>
          )}
        </div>

        {configured.length === 0 ? (
          <p className="text-base text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {configured.map((provider) => (
              <SubtitleProviderRow
                key={provider.kind}
                provider={provider}
                onEdit={() => setEditing(provider)}
                onRemove={() => setRemoving(provider)}
              />
            ))}
          </ul>
        )}
      </div>

      {configured.length >= 2 && (
        <SubtitleLanguagesEditor
          key={JSON.stringify(settings)}
          settings={settings}
          languages={languages}
          onSaved={handleSaved}
        />
      )}

      <SubtitleProviderModal
        isOpen={adding || editing !== null}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        editing={editing}
        availableKinds={unconfigured.map((p) => p.kind)}
        onSaved={handleSaved}
      />
      <RemoveSubtitleProviderModal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        name={removing ? t(`name.${removing.kind}`) : ""}
        onConfirm={handleRemove}
      />
    </div>
  );
}
