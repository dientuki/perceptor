"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  createUserAction,
  deleteUserAction,
  setUserEnabledAction,
} from "@/actions/users";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import type { AdminUser } from "@/types/users";

const ERROR_CLASS =
  "text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";

interface UsersManagerProps {
  users: AdminUser[];
  currentUserId: string;
}

export default function UsersManager({
  users,
  currentUserId,
}: UsersManagerProps) {
  return (
    <div className="space-y-8">
      <CreateUserForm />
      <UsersTable users={users} currentUserId={currentUserId} />
    </div>
  );
}

function CreateUserForm() {
  const t = useTranslations("users.create");
  const [state, formAction, isPending] = useActionState(createUserAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  // React 19 resets every uncontrolled field of a `<form action={fn}>` natively
  // (`HTMLFormElement.reset()`) the instant the form is submitted — before the
  // async action even runs, regardless of whether it later succeeds or fails.
  // That native reset restores each field's `value` to its current `defaultValue`
  // DOM property, so mirroring what the user typed into `defaultValue` (via
  // `onChange`) means the native reset is a no-op visually: the field still
  // shows what was typed. Only on an actual successful create do we want the
  // fields to end up empty, which the effect below does explicitly.
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    if (state && "success" in state && state.success) {
      setName("");
      setUsername("");
      const form = formRef.current;
      if (form) {
        const nameInput = form.elements.namedItem(
          "name",
        ) as HTMLInputElement | null;
        const usernameInput = form.elements.namedItem(
          "username",
        ) as HTMLInputElement | null;
        // Update the DOM's `defaultValue` synchronously before resetting — React's
        // own re-render (from setName/setUsername above) is batched and would not
        // have applied yet, so `form.reset()` would otherwise restore the stale,
        // just-typed text instead of clearing the field.
        if (nameInput) nameInput.defaultValue = "";
        if (usernameInput) usernameInput.defaultValue = "";
        form.reset();
      }
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-6 max-w-lg">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {t("title")}
      </h3>

      <div>
        <Label htmlFor="name">{t("nameLabel")}</Label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="username">{t("usernameLabel")}</Label>
        <Input
          id="username"
          name="username"
          type="text"
          required
          minLength={3}
          defaultValue={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="password">{t("passwordLabel")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          hint={t("passwordHint")}
        />
      </div>

      <div>
        <Label htmlFor="passwordConfirmation">
          {t("passwordConfirmLabel")}
        </Label>
        <Input
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          required
          autoComplete="new-password"
        />
      </div>

      {state && "error" in state && state.error && (
        <p className={ERROR_CLASS}>{state.error}</p>
      )}

      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}

function UsersTable({ users, currentUserId }: UsersManagerProps) {
  const t = useTranslations("users.table");
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {t("title")}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="py-3 pr-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {t("nameHeader")}
              </th>
              <th className="py-3 pr-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {t("usernameHeader")}
              </th>
              <th className="py-3 pr-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {t("roleHeader")}
              </th>
              <th className="py-3 pr-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {t("statusHeader")}
              </th>
              <th className="py-3 pr-4 text-sm font-medium text-gray-500 dark:text-gray-400">
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
}

function UserRow({ user, isSelf }: UserRowProps) {
  const t = useTranslations("users.table");
  const [deleteState, deleteFormAction, isDeletePending] = useActionState(
    deleteUserAction,
    null,
  );
  const [toggleState, toggleFormAction, isTogglePending] = useActionState(
    setUserEnabledAction,
    null,
  );

  const error =
    (toggleState && "error" in toggleState && toggleState.error) ||
    (deleteState && "error" in deleteState && deleteState.error);

  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-800/60">
        <td className="py-3 pr-4 text-sm text-gray-800 dark:text-white/90">
          {user.name}
        </td>
        <td className="py-3 pr-4 text-sm text-gray-800 dark:text-white/90">
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
          <div className="flex justify-end gap-2">
            <form action={toggleFormAction}>
              <input type="hidden" name="id" value={user.id} />
              <input
                type="hidden"
                name="isEnabled"
                value={(!user.isEnabled).toString()}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={isSelf || isTogglePending}
                title={isSelf ? t("disableSelfTitle") : undefined}
              >
                {isTogglePending
                  ? user.isEnabled
                    ? t("disabling")
                    : t("enabling")
                  : user.isEnabled
                    ? t("disable")
                    : t("enable")}
              </Button>
            </form>
            <form action={deleteFormAction}>
              <input type="hidden" name="id" value={user.id} />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={isSelf || isDeletePending}
                title={isSelf ? t("deleteSelfTitle") : undefined}
              >
                {isDeletePending ? t("deleting") : t("delete")}
              </Button>
            </form>
          </div>
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
