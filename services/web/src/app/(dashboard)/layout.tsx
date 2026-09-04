import AdminShell from "@/layout/AdminShell";
import { getCurrentUser } from "@/actions/auth";
import { getMediaCapabilities } from "@/actions/media";
import React from "react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const capabilities = await getMediaCapabilities();

  return (
    <AdminShell user={user} capabilities={capabilities}>
      {children}
    </AdminShell>
  );
}
