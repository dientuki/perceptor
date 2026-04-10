"use client";
import React from "react";
import { useModal } from "../../hooks/useModal";
import { Modal } from "../ui/modal";
import Button from "../ui/button/Button";
import Input from "../form/input/InputField";
import Label from "../form/Label";
import { updatePathSettings, type UpdatePathSettingsData } from "@/actions/settings";
import { logger } from "@/lib/logger";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";

interface SettingPathCardProps {
  settings: {
    path_downloads: { id: number; value: string };
    path_movies: { id: number; value: string };
    path_shows: { id: number; value: string };
  };
}

export default function SettingPathCard({ settings: config }: SettingPathCardProps) {
  const { isOpen, openModal, closeModal } = useModal();
  const router = useRouter();
  
  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data: UpdatePathSettingsData = {
      path_downloads: { id: config.path_downloads.id, value: formData.get("path_downloads") as string },
      path_movies: { id: config.path_movies.id, value: formData.get("path_movies") as string },
      path_shows: { id: config.path_shows.id, value: formData.get("path_shows") as string },
    };
    
    logger.info({ data }, "Saving changes to paths...");
    const result = await updatePathSettings(data);
    if (result.success) {
      router.refresh();
      closeModal();
    } else {
      logger.error({ message: result.message }, "Error saving path settings.");
    }
  };
  return (
    <>
      <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90 lg:mb-6">
              Paths
            </h4>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-7 2xl:gap-x-32">
              <div>
                <p className="mb-2 text-xs leading-normal text-gray-500 dark:text-gray-400">
                  Torrent Download
                </p>
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {config.path_downloads.value}
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs leading-normal text-gray-500 dark:text-gray-400">
                  Movie Path
                </p>
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {config.path_movies.value}
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs leading-normal text-gray-500 dark:text-gray-400">
                  Series Path
                </p>
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {config.path_shows.value}
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={openModal}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 lg:inline-flex lg:w-auto"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
        </div>
      </div>
      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-[700px] m-4">
        <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
          <div className="px-2 pr-14">
            <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
              Edit Paths
            </h4>
            <p className="mb-6 text-sm text-gray-500 dark:text-gray-400 lg:mb-7">
              Update storage locations for your media library.
            </p>
          </div>
          <form className="flex flex-col" onSubmit={handleSave}>
            <div className="px-2 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 gap-x-6 gap-y-5">
                <div>
                  <Label>Torrent Download Path</Label>
                  <Input name="path_downloads" type="text" defaultValue={config.path_downloads.value} required/>
                </div>
                <div>
                  <Label>Movies Path</Label>
                  <Input name="path_movies" type="text" defaultValue={config.path_movies.value} required/>
                </div>
                <div>
                  <Label>Series Path</Label>
                  <Input name="path_shows" type="text" defaultValue={config.path_shows.value} required/>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
              <Button size="sm" variant="outline" type="button" onClick={closeModal}>
                Close
              </Button>
              <Button size="sm" type="submit">
                Save Changes
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </>
  );
}
