import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/actions/auth";
import { getUsers } from "@/actions/users";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import UsersManager from "@/components/users/UsersManager";

export const metadata: Metadata = {
  title: "Users | Perceptor",
  description: "Administración de usuarios",
};

export default async function UsersPage() {
  // Deliberately sequential, not Promise.all: getUsers() throws for a
  // non-admin (AdminGuard refuses it), which would race the isAdmin check
  // below and surface as an uncaught 500 instead of a clean 404. Checking
  // isAdmin first — defense in depth, the real control is api's AdminGuard
  // (REQ-2) — means getUsers() is never even called for a non-admin.
  const user = await getCurrentUser();

  if (!user.isAdmin) {
    notFound();
  }

  const users = await getUsers();

  return (
    <div>
      <PageBreadcrumb pageTitle="Users" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <UsersManager users={users} currentUserId={user.id} />
        </div>
      </div>
    </div>
  );
}
