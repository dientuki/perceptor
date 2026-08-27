"use client";

import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/button/Button";
import { useUsersDialogs } from "@/components/users/UsersDialogsContext";

export default function AddUserButton() {
  const t = useTranslations("users");
  const { setModalTarget } = useUsersDialogs();

  return (
    <Button
      size="sm"
      startIcon={<UserPlus className="size-4" />}
      onClick={() => setModalTarget("new")}
      title={t("add.title")}
      ariaLabel={t("add.title")}
    >
      {t("add.label")}
    </Button>
  );
}
