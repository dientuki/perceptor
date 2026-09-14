"use client";

import { useTranslations } from "next-intl";
import Label from "@/components/form/Label";
import Badge from "@/components/ui/badge/Badge";
import type { EnvironmentInfo } from "@/types/environment";

interface EnvironmentPanelProps {
  environment: EnvironmentInfo;
  uploadEndpoint: string | null;
  webDomain: string | null;
}

const EM_DASH = "—";

const RECREATE_COMMAND = "docker compose up -d --force-recreate";
const RECREATE_API_WEB_COMMAND = `${RECREATE_COMMAND} api web`;

// Read-only Environment tab (REQ-1..REQ-11 of 055-environment-panel). No
// form control anywhere in this file — SettingsForm.tsx renders it as a
// sibling of the main <form>, never inside it, and the shared save action
// never reads anything from here (REQ-10).
export default function EnvironmentPanel({
  environment,
  uploadEndpoint,
  webDomain,
}: EnvironmentPanelProps) {
  const t = useTranslations("settings.environment");
  const { useTraefik, domain, endpoints, expectedUploadEndpoint } = environment;

  // REQ-6: only meaningful with routing on and a derivable expected value.
  // Comparison is exact — no trailing-slash or case normalization.
  const uploadConsistent =
    useTraefik && expectedUploadEndpoint !== null
      ? expectedUploadEndpoint === uploadEndpoint
      : null;

  // REQ-7: the observable signature of an .env edit applied to one
  // container and not the other.
  const domainsDisagree =
    domain !== null && webDomain !== null && domain !== webDomain;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>{t("routingModeLabel")}</Label>
        <div>
          <Badge color={useTraefik ? "success" : "light"}>
            {useTraefik ? t("routingEnabled") : t("routingDisabled")}
          </Badge>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("domainLabel")}</Label>
        <div className="flex flex-wrap items-center gap-2 text-gray-700 dark:text-gray-300">
          <span>{domain ?? t("domainNotSet")}</span>
          {!useTraefik && (
            <span className="text-gray-500 dark:text-gray-400">
              {t("domainNotInEffect")}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("endpointsLabel")}</Label>
        <div className="space-y-2">
          {endpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <span className="font-medium text-gray-800 dark:text-white/90">
                {t.has(`serviceNames.${endpoint.id}`)
                  ? t(`serviceNames.${endpoint.id}`)
                  : endpoint.id}
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                {t("portLabel")}: {endpoint.port ?? EM_DASH}
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                {endpoint.url ?? t("urlNotDerivable")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("uploadEndpointLabel")}</Label>
        <div className="flex flex-wrap items-center gap-3 text-gray-700 dark:text-gray-300">
          <span>{uploadEndpoint ?? t("uploadEndpointNotConfigured")}</span>
          {uploadConsistent !== null && (
            <Badge color={uploadConsistent ? "success" : "error"}>
              {uploadConsistent
                ? t("uploadConsistent")
                : t("uploadInconsistent")}
            </Badge>
          )}
        </div>
        {uploadConsistent === false && expectedUploadEndpoint !== null && (
          <p className="text-gray-500 dark:text-gray-400">
            {t("uploadExpectedValue", { value: expectedUploadEndpoint })}
          </p>
        )}
      </div>

      {domainsDisagree && (
        <div className="rounded-lg bg-warning-50 p-3 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400">
          {t("domainDisagreement", {
            apiDomain: domain ?? "",
            webDomain: webDomain ?? "",
          })}
          <br />
          <code>{RECREATE_API_WEB_COMMAND}</code>
        </div>
      )}

      <div className="space-y-2">
        <Label>{t("howToChangeLabel")}</Label>
        <p className="text-gray-700 dark:text-gray-300">
          {t("howToChangeDescription")}
        </p>
        <ul className="list-inside list-disc text-gray-700 dark:text-gray-300">
          <li>USE_TRAEFIK</li>
          <li>DOMAIN</li>
          <li>COMPOSE_PROFILES</li>
          <li>PUBLIC_UPLOAD_URL</li>
        </ul>
        <p className="text-gray-500 dark:text-gray-400">
          {t("howToChangeRecreate")}
        </p>
        <code>{RECREATE_COMMAND}</code>
      </div>

      {!useTraefik && (
        <div className="space-y-2">
          <Label>{t("hostGuidanceLabel")}</Label>
          <p className="text-gray-700 dark:text-gray-300">
            {t("hostGuidanceDescription")}
          </p>
        </div>
      )}
    </div>
  );
}
