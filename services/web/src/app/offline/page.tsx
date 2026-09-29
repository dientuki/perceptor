import { getTranslations } from "next-intl/server";

// This document is served by the service worker (public/sw.js) when a navigation
// fails with no network. At that moment no stylesheet, font or script can be
// fetched, so it carries its own inline styles and a zero-JS retry control.
export default async function OfflinePage() {
  const t = await getTranslations("offline");
  const tCommon = await getTranslations("common");

  return (
    <>
      <style>{`
        .offline-page {
          display: flex;
          min-height: 100vh;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          padding: 2rem 1.5rem;
          text-align: center;
          background-color: #ffffff;
          color: #101828;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .offline-page__app-name {
          font-size: 0.875rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #465fff;
        }
        .offline-page__heading {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 700;
        }
        .offline-page__body {
          max-width: 28rem;
          margin: 0;
          font-size: 1rem;
          line-height: 1.5;
          color: #475467;
        }
        .offline-page__retry {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 2.75rem;
          padding: 0.625rem 1.5rem;
          border-radius: 0.5rem;
          background-color: #465fff;
          color: #ffffff;
          font-size: 1rem;
          font-weight: 600;
          text-decoration: none;
        }
        @media (prefers-color-scheme: dark) {
          .offline-page {
            background-color: #101828;
            color: #f9fafb;
          }
          .offline-page__body {
            color: #98a2b3;
          }
        }
      `}</style>
      <div className="offline-page">
        <span className="offline-page__app-name">{tCommon("appName")}</span>
        <h1 className="offline-page__heading">{t("heading")}</h1>
        <p className="offline-page__body">{t("body")}</p>
        {/* biome-ignore lint/a11y/useValidAnchor: an empty href resolves to the current (failed) URL, which is exactly the retry this document needs with no JS. */}
        <a className="offline-page__retry" href="">
          {t("retry")}
        </a>
      </div>
    </>
  );
}
