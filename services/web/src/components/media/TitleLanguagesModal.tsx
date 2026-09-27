"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import TitleLanguagesForm from "./TitleLanguagesForm";

type TitleLanguagesFormProps = ComponentProps<typeof TitleLanguagesForm>;

interface TitleLanguagesModalProps
  extends Omit<TitleLanguagesFormProps, "onSaved"> {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function TitleLanguagesModal({
  isOpen,
  onClose,
  onSaved,
  ...formProps
}: TitleLanguagesModalProps) {
  const t = useTranslations("media.languagesModal");

  const handleSaved = () => {
    onClose();
    onSaved();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[900px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-6 text-2xl font-semibold text-gray-800 dark:text-white/90">
            {t("title")}
          </h4>
        </div>
        <div className="px-2">
          <TitleLanguagesForm {...formProps} onSaved={handleSaved} />
        </div>
        <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
          <Button size="sm" variant="outline" onClick={onClose} type="button">
            {t("dismiss")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
