import AdminShell from "@/layout/AdminShell";
import { getCurrentUser } from "@/actions/auth";
import React from "react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return <AdminShell user={user}>{children}</AdminShell>;
}
