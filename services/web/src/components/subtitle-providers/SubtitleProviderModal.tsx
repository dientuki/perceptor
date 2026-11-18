"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { saveSubtitleProviderAction } from "@/actions/subtitle-providers";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import type {
  SubtitleProvider,
  SubtitleProviderKind,
  SubtitleProviderSettings,
} from "@/types/subtitle-providers";

interface SubtitleProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Set when editing; null when adding.
  editing: SubtitleProvider | null;
  // Kinds offered while adding.
  availableKinds: SubtitleProviderKind[];
  onSaved: (settings: SubtitleProviderSettings) => void;
}

const ERROR_CLASS =
  "text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";
const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-base text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800";
const SUBX_QUICKSTART_URL =
  "https://subx-api.duckdns.org/docs/getting-started/quickstart/";

// Spec 121, REQ-3 REQ-4
export default function SubtitleProviderModal({
  isOpen,
  onClose,
  editing,
  availableKinds,
  onSaved,
}: SubtitleProviderModalProps) {
  const t = useTranslations("subtitleProviders");
  const firstKind = availableKinds[0] ?? "OPENSUBTITLES";
  const [pickedKind, setPickedKind] = useState<SubtitleProviderKind>(firstKind);
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const kind = editing?.kind ?? pickedKind;

  useEffect(() => {
    if (isOpen) {
      setPickedKind(firstKind);
      setUsername(editing?.username ?? "");
      setSecret("");
      setError(null);
    }
  }, [isOpen, editing, firstKind]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsPending(true);
    setError(null);

    try {
      const result = await saveSubtitleProviderAction(
        kind,
        kind === "OPENSUBTITLES" ? username.trim() : null,
        secret === "" ? null : secret,
      );

      if ("error" in result) {
        setError(result.error);
        return;
      }

      onSaved(result.settings);
      onClose();
    } finally {
      setIsPending(false);
    }
  };

  const kindOptions = availableKinds.map((value) => ({
    value,
    label: t(`name.${value}`),
  }));
  const secretLabel =
    kind === "OPENSUBTITLES"
      ? t("modal.passwordLabel")
      : t("modal.apiKeyLabel");

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[560px] m-4">
      <form
        onSubmit={handleSubmit}
        className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11"
      >
        <div className="px-2 pr-14">
          <h4 className="mb-6 text-2xl font-semibold text-gray-800 dark:text-white/90">
            {editing
              ? t("modal.editTitle", { name: t(`name.${editing.kind}`) })
              : t("modal.addTitle")}
          </h4>
        </div>
        <div className="px-2 space-y-5">
          {error && <p className={ERROR_CLASS}>{error}</p>}

          {!editing && kindOptions.length > 0 && (
            <div>
              <Label htmlFor="subtitle_provider_kind">
                {t("modal.kindLabel")}
              </Label>
              <Select
                id="subtitle_provider_kind"
                value={pickedKind}
                options={kindOptions}
                onChange={(e) =>
                  setPickedKind(e.target.value as SubtitleProviderKind)
                }
              />
            </div>
          )}

          {kind === "OPENSUBTITLES" && (
            <div>
              <Label htmlFor="subtitle_provider_username">
                {t("modal.usernameLabel")}
              </Label>
              <input
                id="subtitle_provider_username"
                type="text"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          )}

          <div>
            <Label htmlFor="subtitle_provider_secret">{secretLabel}</Label>
            <input
              id="subtitle_provider_secret"
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className={INPUT_CLASS}
            />
            {editing && (
              <p className="mt-1.5 text-theme-sm text-gray-500 dark:text-gray-400">
                {t("modal.secretKeepHint")}
              </p>
            )}
          </div>

          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            {kind === "OPENSUBTITLES" ? (
              <>
                {t("modal.openSubtitlesHelp")}{" "}
                <a
                  href="https://www.opensubtitles.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-500 hover:underline"
                >
                  {t("modal.openSubtitlesSignUp")}
                </a>
              </>
            ) : (
              <>
                {t("modal.subdivxHelp")}{" "}
                <a
                  href={SUBX_QUICKSTART_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-500 hover:underline"
                >
                  {t("modal.subdivxQuickstart")}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button size="sm" type="submit" disabled={isPending}>
            {isPending ? t("modal.saving") : t("modal.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
