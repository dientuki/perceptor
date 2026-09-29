import type React from "react";
import { getCurrentUser } from "@/actions/auth";
import { getActiveDownloadCount } from "@/actions/downloads";
import { getIndexerStatus } from "@/actions/indexer";
import { getMediaCapabilities } from "@/actions/media";
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
  const [capabilities, activeDownloadCount, indexerStatus] = await Promise.all([
    getMediaCapabilities(),
    getActiveDownloadCount(),
    user.isAdmin ? getIndexerStatus() : Promise.resolve(null),
  ]);

  return (
    <AdminShell
      user={user}
      capabilities={capabilities}
      activeDownloadCount={activeDownloadCount}
      indexerStatus={indexerStatus}
    >
      {children}
    </AdminShell>
  );
}
