import { getLocale } from "next-intl/server";
import type React from "react";
import { getCurrentUser } from "@/actions/auth";
import { getActiveDownloadCount } from "@/actions/downloads";
import { getIndexerStatus } from "@/actions/indexer";
import { getMediaCapabilities } from "@/actions/media";
import { getDefaultDateMonthFirst } from "@/actions/settings";
import { MONTH_FIRST_BY_LOCALE, isSupportedLocale } from "@/i18n/locales";
import AdminShell from "@/layout/AdminShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  // indexerStatus backs the sidebar's own First step visibility (only shown
  // while setup looks incomplete) — fetched only for an admin, since the
  // query is AdminGuard-gated and every other user hits this layout too.
  const [capabilities, activeDownloadCount, indexerStatus, installationOrder] =
    await Promise.all([
      getMediaCapabilities(),
      getActiveDownloadCount(),
      user.isAdmin ? getIndexerStatus() : Promise.resolve(null),
      user.dateMonthFirst === null
        ? getDefaultDateMonthFirst()
        : Promise.resolve(null),
    ]);
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
    >
      {children}
    </AdminShell>
  );
}
