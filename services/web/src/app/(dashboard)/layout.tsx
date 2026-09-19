import AdminShell from "@/layout/AdminShell";
import { getCurrentUser } from "@/actions/auth";
import { getActiveDownloadCount } from "@/actions/downloads";
import { getMediaCapabilities } from "@/actions/media";
import React from "react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const capabilities = await getMediaCapabilities();
  const activeDownloadCount = await getActiveDownloadCount();

  return (
    <AdminShell
      user={user}
      capabilities={capabilities}
      activeDownloadCount={activeDownloadCount}
    >
      {children}
    </AdminShell>
  );
}
