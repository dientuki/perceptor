"use client";

import { Trash2, UserCheck, UserPen, UserPlus, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { setUserEnabledAction } from "@/actions/users";
import Button from "@/components/ui/button/Button";
import DeleteUserDialog from "@/components/users/DeleteUserDialog";
import UserModal from "@/components/users/UserModal";
import type { AdminUser } from "@/types/users";

const ERROR_CLASS =
  "text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";

interface UsersManagerProps {
  users: AdminUser[];
  currentUserId: string;
}

export default function UsersManager({
  users,
  currentUserId,
}: UsersManagerProps) {
  // "new" opens UserModal in create mode; an AdminUser opens it in edit mode
  // for that user; null keeps it closed.
  const [modalTarget, setModalTarget] = useState<AdminUser | "new" | null>(
    null,
  );
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const t = useTranslations("users");

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Button
          size="sm"
          startIcon={<UserPlus className="size-4" />}
          onClick={() => setModalTarget("new")}
          title={t("add.title")}
          ariaLabel={t("add.title")}
        >
          {t("add.label")}
        </Button>
      </div>

      <UsersTable
        users={users}
        currentUserId={currentUserId}
        onEdit={setModalTarget}
        onDelete={setDeletingUser}
      />

      <UserModal
        isOpen={modalTarget !== null}
        onClose={() => setModalTarget(null)}
        user={modalTarget && modalTarget !== "new" ? modalTarget : undefined}
      />

      {deletingUser && (
        <DeleteUserDialog
          isOpen={deletingUser !== null}
          onClose={() => setDeletingUser(null)}
          user={deletingUser}
        />
      )}
    </div>
  );
}

interface UsersTableProps {
  users: AdminUser[];
  currentUserId: string;
  onEdit: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}

function UsersTable({
  users,
  currentUserId,
  onEdit,
  onDelete,
}: UsersTableProps) {
  const t = useTranslations("users.table");
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-700 dark:text-gray-300">
        {t("title")}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="py-3 pr-4 font-medium text-gray-500 dark:text-gray-400">
                {t("nameHeader")}
              </th>
              <th className="py-3 pr-4 font-medium text-gray-500 dark:text-gray-400">
                {t("usernameHeader")}
              </th>
              <th className="py-3 pr-4 font-medium text-gray-500 dark:text-gray-400">
                {t("roleHeader")}
              </th>
              <th className="py-3 pr-4 font-medium text-gray-500 dark:text-gray-400">
                {t("statusHeader")}
              </th>
              <th className="py-3 pr-4 font-medium text-gray-500 dark:text-gray-400">
                {" "}
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isSelf={user.id === currentUserId}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface UserRowProps {
  user: AdminUser;
  isSelf: boolean;
  onEdit: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}

function UserRow({ user, isSelf, onEdit, onDelete }: UserRowProps) {
  const t = useTranslations("users.table");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isTogglePending, setIsTogglePending] = useState(false);

  const handleToggle = async () => {
    setIsTogglePending(true);
    setError(null);

    try {
      const result = await setUserEnabledAction(user.id, !user.isEnabled);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setIsTogglePending(false);
    }
  };

  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-800/60">
        <td className="py-3 pr-4 text-gray-800 dark:text-white/90">
          {user.name}
        </td>
        <td className="py-3 pr-4 text-gray-800 dark:text-white/90">
          {user.username}
        </td>
        <td className="py-3 pr-4">
          {user.isAdmin ? (
            <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-500 dark:bg-brand-500/10">
              {t("roleAdmin")}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-500 dark:bg-success-500/10">
              {t("roleUser")}
            </span>
          )}
        </td>
        <td className="py-3 pr-4">
          {user.isEnabled ? (
            <span className="inline-flex items-center rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-500 dark:bg-success-500/10">
              {t("statusEnabled")}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-500 dark:bg-brand-500/10">
              {t("statusDisabled")}
            </span>
          )}
        </td>
        <td className="py-3 pr-4 text-right">
          {!isSelf && (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => onEdit(user)}
                title={t("editTitle")}
                aria-label={t("editTitle")}
                className="text-gray-500 hover:text-brand-500 dark:text-gray-400 dark:hover:text-brand-400"
              >
                <UserPen className="size-5" />
              </button>
              <button
                type="button"
                onClick={handleToggle}
                disabled={isTogglePending}
                title={user.isEnabled ? t("disableTitle") : t("enableTitle")}
                aria-label={
                  user.isEnabled ? t("disableTitle") : t("enableTitle")
                }
                className="text-gray-500 hover:text-brand-500 disabled:opacity-50 dark:text-gray-400 dark:hover:text-brand-400"
              >
                {user.isEnabled ? (
                  <UserX className="size-5" />
                ) : (
                  <UserCheck className="size-5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onDelete(user)}
                title={t("deleteTitle")}
                aria-label={t("deleteTitle")}
                className="text-error-500 hover:text-error-600"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={5} className="pb-3">
            <p className={ERROR_CLASS}>{error}</p>
          </td>
        </tr>
      )}
    </>
  );
}
