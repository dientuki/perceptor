import Link from "next/link";
import { getTranslations } from "next-intl/server";

const TMDB_SIGNUP_URL = "https://www.themoviedb.org/signup";
const TMDB_LOGIN_URL = "https://www.themoviedb.org/login";
const TMDB_API_SETTINGS_URL = "https://www.themoviedb.org/settings/api";
const TMDB_API_TERMS_URL = "https://www.themoviedb.org/api-terms-of-use";

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

export default async function TmdbKeyOnboarding({
  isAdmin,
  keyRejected,
  alreadyConfigured = false,
}: {
  isAdmin: boolean;
  keyRejected: boolean;
  alreadyConfigured?: boolean;
}) {
  const t = await getTranslations("onboarding.tmdb");

  return (
    <div className="space-y-6">
      {keyRejected && (
        <div
          role="alert"
          className="rounded-2xl border border-error-200 bg-error-50 p-5 dark:border-error-500/30 dark:bg-error-500/10"
        >
          <p className="font-semibold text-error-700 dark:text-error-400">
            {t("rejectedTitle")}
          </p>
          <p className="mt-1 text-error-600 dark:text-error-400">
            {t("rejectedBody")}
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            {t("title")}
          </h2>
          {alreadyConfigured && (
            <span className="rounded-full bg-success-50 px-3 py-1 text-sm font-medium text-success-700 dark:bg-success-500/10 dark:text-success-400">
              {t("alreadyConfigured")}
            </span>
          )}
        </div>

        <h3 className="mt-5 font-semibold text-gray-800 dark:text-white/90">
          {t("whyTitle")}
        </h3>
        <p className="mt-1 text-gray-600 dark:text-gray-400">{t("why")}</p>

        <p className="mt-4 font-medium text-gray-800 dark:text-white/90">
          {t("adminOnly")}
        </p>

        <h3 className="mt-6 font-semibold text-gray-800 dark:text-white/90">
          {t("stepsTitle")}
        </h3>
        <ol className="mt-2 list-decimal space-y-3 pl-6 text-gray-600 dark:text-gray-400">
          <li>
            {t("step1")}{" "}
            <ExternalLink href={TMDB_SIGNUP_URL} label={t("step1Link")} />
          </li>
          <li>
            {t("step2")}{" "}
            <ExternalLink href={TMDB_LOGIN_URL} label={t("step2Link")} />
          </li>
          <li>
            {t("step3")}{" "}
            <ExternalLink href={TMDB_API_SETTINGS_URL} label={t("step3Link")} />{" "}
            <ExternalLink href={TMDB_API_TERMS_URL} label={t("step3Terms")} />
          </li>
          <li>{t("step4")}</li>
          <li>
            {isAdmin ? (
              <>
                {t("step5Admin")}{" "}
                <Link href="/settings" className={linkClass}>
                  {t("step5Link")}
                </Link>
              </>
            ) : (
              t("step5User")
            )}
          </li>
        </ol>
      </div>
    </div>
  );
}
