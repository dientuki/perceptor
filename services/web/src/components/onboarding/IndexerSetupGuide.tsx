import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { IndexerStatus } from "@/types/indexer";

const linkClass =
  "font-medium text-brand-500 underline hover:text-brand-600 dark:text-brand-400";

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={linkClass}
    >
      {label}
    </a>
  );
}

function StepScreenshot({
  src,
  alt,
  viewFullSize,
}: {
  src: string;
  alt: string;
  viewFullSize: string;
}) {
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      title={viewFullSize}
    >
      <Image
        src={src}
        alt={alt}
        width={1280}
        height={900}
        className="mt-3 h-auto w-full max-w-xl rounded-lg border border-gray-200 dark:border-gray-800"
      />
    </a>
  );
}

export default async function IndexerSetupGuide({
  status,
  indexerUrl,
  indexerPort,
}: {
  status: IndexerStatus;
  indexerUrl: string | null;
  indexerPort: number;
}) {
  const t = await getTranslations("onboarding.indexer");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
        {t("title")}
      </h2>
      <p className="mt-2 text-gray-600 dark:text-gray-400">{t("about")}</p>

      {!status.reachable ? (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-error-200 bg-error-50 p-5 dark:border-error-500/30 dark:bg-error-500/10"
        >
          <p className="text-error-700 dark:text-error-400">
            {t("unreachable")}
          </p>
        </div>
      ) : status.configuredIndexers === 0 ? (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-warning-200 bg-warning-50 p-5 dark:border-warning-500/30 dark:bg-warning-500/10"
        >
          <p className="text-warning-700 dark:text-warning-400">
            {t("zeroNotice")}
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-success-200 bg-success-50 p-5 dark:border-success-500/30 dark:bg-success-500/10">
          <p className="text-success-700 dark:text-success-400">
            {t("countNotice", { count: status.configuredIndexers })}
          </p>
        </div>
      )}

      <h3 className="mt-6 font-semibold text-gray-800 dark:text-white/90">
        {t("stepsTitle")}
      </h3>
      <ol className="mt-2 list-decimal space-y-3 pl-6 text-gray-600 dark:text-gray-400">
        <li>
          {t("step1")}{" "}
          {indexerUrl ? (
            <ExternalLink href={indexerUrl} label={t("step1LinkLabel")} />
          ) : (
            <span>{t("step1PortOnly", { port: indexerPort })}</span>
          )}
        </li>
        <li>
          {t("step2")}
          <StepScreenshot
            src="/images/first-step/indexer-login-2.png"
            alt={t("step2ImageAlt")}
            viewFullSize={t("viewFullSize")}
          />
        </li>
        <li>
          {t("step3")}
          <StepScreenshot
            src="/images/first-step/indexer-filter-2.png"
            alt={t("step3ImageAlt")}
            viewFullSize={t("viewFullSize")}
          />
        </li>
        <li>
          {t("step4")}
          <StepScreenshot
            src="/images/first-step/indexer-add-2.png"
            alt={t("step4ImageAlt")}
            viewFullSize={t("viewFullSize")}
          />
        </li>
        <li>
          {t("step5")}
          <StepScreenshot
            src="/images/first-step/indexer-flaresolverr-2.png"
            alt={t("step5ImageAlt")}
            viewFullSize={t("viewFullSize")}
          />
        </li>
        <li>{t("step6")}</li>
      </ol>

      <p className="mt-4 text-gray-600 dark:text-gray-400">{t("apiKeyNote")}</p>
    </div>
  );
}
