import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import type React from "react";
import { getCurrentUser } from "@/actions/auth";
import { getActiveDownloadCount } from "@/actions/downloads";
import { getEnvironmentInfo } from "@/actions/environment";
import { getIndexerStatus } from "@/actions/indexer";
import { getMediaCapabilities } from "@/actions/media";
import { getDefaultDateMonthFirst } from "@/actions/settings";
import { isSupportedLocale, MONTH_FIRST_BY_LOCALE } from "@/i18n/locales";
import AdminShell from "@/layout/AdminShell";
import { parseRequestHostname, resolveServiceUrl } from "@/lib/request-host";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  // indexerStatus backs the sidebar's own First step visibility (only shown
  // while setup looks incomplete) — fetched only for an admin, since the
  // query is AdminGuard-gated and every other user hits this layout too.
  const [
    capabilities,
    activeDownloadCount,
    indexerStatus,
    installationOrder,
    environment,
  ] = await Promise.all([
    getMediaCapabilities(),
    getActiveDownloadCount(),
    user.isAdmin ? getIndexerStatus() : Promise.resolve(null),
    user.dateMonthFirst === null
      ? getDefaultDateMonthFirst()
      : Promise.resolve(null),
    user.isAdmin
      ? getEnvironmentInfo().catch(() => null)
      : Promise.resolve(null),
  ]);
  // Spec 112, user dropdown service links
  const requestHeaders = await headers();
  const requestHost = parseRequestHostname(
    requestHeaders.get("x-forwarded-host"),
    requestHeaders.get("host"),
  );
  const endpoints = environment?.endpoints ?? [];
  const find = (id: string) =>
    resolveServiceUrl(
      endpoints.find((endpoint) => endpoint.id === id),
      requestHost,
    );
  const indexerUrl = find("indexer");
  const torrentUrl = find("torrent");
  // Spec 096, REQ-4 NFR-3
  const locale = await getLocale();
  const monthFirst =
    user.dateMonthFirst ??
    installationOrder ??
    (isSupportedLocale(locale) ? MONTH_FIRST_BY_LOCALE[locale] : false);

  return (
    <AdminShell
      user={user}
      capabilities={capabilities}
      activeDownloadCount={activeDownloadCount}
      indexerStatus={indexerStatus}
      monthFirst={monthFirst}
      indexerUrl={indexerUrl}
      torrentUrl={torrentUrl}
    >
      {children}
    </AdminShell>
  );
}
