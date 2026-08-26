"use client";

import { UserPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { CurrentUser } from "@/actions/auth";
import { updateProfileAction } from "@/actions/profile";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";

const ERROR_CLASS =
  "text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: CurrentUser;
}

export default function ProfileModal({
  isOpen,
  onClose,
  user,
}: ProfileModalProps) {
  const t = useTranslations("profile");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Re-seed from `user` and clear any leftover state every time the modal
  // opens, so a cancel-then-reopen never shows stale values (REQ-2).
  useEffect(() => {
    if (isOpen) {
      setName(user.name);
      setUsername(user.username);
      setPassword("");
      setPasswordConfirmation("");
      setError(null);
    }
  }, [isOpen, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    setError(null);

    try {
      const result = await updateProfileAction({
        name,
        username,
        password: password || undefined,
        passwordConfirmation: passwordConfirmation || undefined,
      });

      if ("error" in result && result.error) {
        setError(result.error);
        (
          formRef.current?.elements.namedItem("name") as HTMLInputElement | null
        )?.focus();
        return;
      }

      setPassword("");
      setPasswordConfirmation("");
      onClose();
      // The header's name comes from `getCurrentUser()` in the dashboard
      // layout, re-rendered on refresh — no `revalidatePath` needed.
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[500px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-6 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <UserPen className="size-6 text-brand-500" />
            {t("title")}
          </h4>
        </div>
        <form ref={formRef} className="flex flex-col" onSubmit={handleSubmit}>
          <div className="px-2 space-y-5 overflow-y-auto custom-scrollbar">
            {error && <p className={ERROR_CLASS}>{error}</p>}

            <div>
              <Label htmlFor="name">{t("nameLabel")}</Label>
              <input
                id="name"
                name="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <Label htmlFor="username">{t("usernameLabel")}</Label>
              <input
                id="username"
                name="username"
                type="text"
                required
                minLength={3}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <Label htmlFor="password">{t("passwordLabel")}</Label>
              <input
                id="password"
                name="password"
                type="password"
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT_CLASS}
              />
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                {t("passwordHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="passwordConfirmation">
                {t("passwordConfirmLabel")}
              </Label>
              <input
                id="passwordConfirmation"
                name="passwordConfirmation"
                type="password"
                minLength={6}
                autoComplete="new-password"
                value={passwordConfirmation}
                onChange={(e) => setPasswordConfirmation(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
            <Button size="sm" variant="outline" onClick={onClose} type="button">
              {t("cancel")}
            </Button>
            <Button size="sm" type="submit" disabled={isPending}>
              {isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
