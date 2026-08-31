"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { resyncMediaServerIndexAction } from "@/actions/media-server";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import Button from "@/components/ui/button/Button";
import type {
  MediaServerIndexStatus,
  MediaServerOption,
} from "@/types/media-server";

interface MediaServerFieldsProps {
  options: MediaServerOption[];
  client: string;
  host: string;
  port: string;
  apiKey: string;
  indexStatus: MediaServerIndexStatus;
}

const NONE = "none";

// Not part of the main form's save (034) — a plain server-function call
// driven by useTransition, following DownloadsPanel.tsx. Never a nested
// <form> (invalid HTML, the same reason LanguagePicker lives outside the
// main form) and never a raw <button> (it would default to type="submit"
// and silently save every setting on every tab).
function MediaServerIndexPanel({ status }: { status: MediaServerIndexStatus }) {
  const t = useTranslations("settings.mediaServer.index");
  const activeLocale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string | null>(null);
  // toLocaleString() renders differently on the server (container timezone)
  // and the browser (the viewer's own) — formatting syncedAt during SSR
  // produces a hydration mismatch. Deferring it to after mount, the standard
  // fix for this exact class of bug, means the timestamp is simply absent
  // for one paint rather than wrong.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleResync = () => {
    setError(null);
    startTransition(async () => {
      const result = await resyncMediaServerIndexAction();
      if ("error" in result) {
        setError(result.error || t("resyncErrorDefault"));
        return;
      }
      setCurrent(result.status);
      router.refresh();
    });
  };

  const stateLabel = t.has(`state.${current.state}`)
    ? t(`state.${current.state}`)
    : current.state;
  const isSyncing = current.state === "syncing" || isPending;

  return (
    <div className="space-y-2">
      <Label>{t("statusLabel")}</Label>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={
            current.state === "failed"
              ? "text-error-500"
              : "text-gray-700 dark:text-gray-300"
          }
        >
          {isPending ? t("resyncing") : stateLabel}
        </span>
        {current.itemCount > 0 && (
          <span className="text-gray-500 dark:text-gray-400">
            {t("itemCount", { count: current.itemCount })}
          </span>
        )}
        {mounted && current.syncedAt && (
          <span className="text-gray-500 dark:text-gray-400">
            {t("syncedAt", {
              date: new Date(current.syncedAt).toLocaleString(activeLocale),
            })}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isSyncing}
          onClick={handleResync}
        >
          {t("resyncButton")}
        </Button>
      </div>
      {error && (
        <p className="text-error-500">{error}</p>
      )}
    </div>
  );
}

// Combo "none"/"jellyfin"/... (las opciones salen de mediaServerClients, ver
// actions/media-server.ts — nunca hardcodeadas acá) + los campos de conexión,
// que sólo se muestran y sólo viajan en el FormData cuando el cliente elegido
// no es 'none'. Con 'none' esos tres inputs no se renderizan → no viajan →
// EDITABLE_KEYS los descarta y la DB conserva la config anterior (ver
// actions/settings.ts): volver a elegir Jellyfin recupera host/port/api key.
export default function MediaServerFields({
  options,
  client,
  host,
  port,
  apiKey,
  indexStatus,
}: MediaServerFieldsProps) {
  const t = useTranslations("settings.mediaServer");
  const [selected, setSelected] = useState(client || NONE);

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="media_server_client">{t("label")}</Label>
        <Select
          id="media_server_client"
          name="media_server_client"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          options={options.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
        />
      </div>

      {selected !== NONE && (
        <>
          <div>
            <Label htmlFor="media_server_host">{t("hostLabel")}</Label>
            <Input
              id="media_server_host"
              name="media_server_host"
              defaultValue={host}
              placeholder={t("hostPlaceholder")}
              hint={t("hostHint")}
            />
          </div>

          <div>
            <Label htmlFor="media_server_port">{t("portLabel")}</Label>
            <Input
              id="media_server_port"
              name="media_server_port"
              defaultValue={port}
            />
          </div>

          <div>
            <Label htmlFor="media_server_api_key">{t("apiKeyLabel")}</Label>
            <Input
              id="media_server_api_key"
              name="media_server_api_key"
              type="password"
              defaultValue={apiKey}
            />
          </div>

          <MediaServerIndexPanel status={indexStatus} />
        </>
      )}
    </div>
  );
}
