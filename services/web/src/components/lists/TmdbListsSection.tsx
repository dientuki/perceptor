"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { addTmdbListAction, removeTmdbListAction } from "@/actions/tmdb-lists";
import Button from "@/components/ui/button/Button";
import { useDateMonthFirst } from "@/context/DateFormatContext";
import { formatDateTime } from "@/lib/format";
import { type ErrorTranslator, translateErrorKey } from "@/lib/graphql-error";
import type { TmdbList } from "@/types/preferences";
import RemoveTmdbListModal from "./RemoveTmdbListModal";

interface TmdbListsSectionProps {
  lists: TmdbList[];
  listImportEnabled: boolean;
}

const NOT_FOUND_KEY = "error.tmdbList.not_found";

// Spec 109, REQ-13
export default function TmdbListsSection({
  lists,
  listImportEnabled,
}: TmdbListsSectionProps) {
  const t = useTranslations("lists.section");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const monthFirst = useDateMonthFirst();

  const [reference, setReference] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<TmdbList | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Spec 096, REQ-7a NFR-2
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!reference.trim()) {
      return;
    }
    setAddError(null);
    startTransition(async () => {
      const result = await addTmdbListAction(reference.trim());
      if (!result.ok) {
        setAddError(result.error ?? null);
        return;
      }
      setReference("");
      router.refresh();
    });
  };

  const handleRemove = async (): Promise<string | null> => {
    if (!removing) {
      return null;
    }
    const result = await removeTmdbListAction(removing.id);
    if (result.ok) {
      setNotice(null);
      router.refresh();
      return null;
    }
    if (result.errorKey === NOT_FOUND_KEY) {
      setNotice(result.error ?? t("removeError"));
      router.refresh();
      setRemoving(null);
      return null;
    }
    return result.error ?? t("removeError");
  };

  return (
    <div className="space-y-5">
      <p className="text-gray-600 dark:text-gray-300">{t("description")}</p>

      {!listImportEnabled && (
        <p className="text-base text-warning-600 bg-warning-50 dark:bg-warning-500/10 p-3 rounded-lg">
          {t("disabledNotice")}
        </p>
      )}

      {notice && (
        <p className="text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg">
          {notice}
        </p>
      )}

      <form onSubmit={handleAdd} className="space-y-2">
        <label
          htmlFor="tmdb-list-reference"
          className="block text-base font-medium text-gray-700 dark:text-gray-400"
        >
          {t("inputLabel")}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="tmdb-list-reference"
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("placeholder")}
            className="h-11 w-full min-w-0 rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-base text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
          />
          <Button
            size="sm"
            type="submit"
            disabled={isPending || !reference.trim()}
          >
            {isPending ? t("attaching") : t("attach")}
          </Button>
        </div>
        {addError && <p className="text-base text-error-500">{addError}</p>}
      </form>

      {lists.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {lists.map((list) => (
            <li
              key={list.id}
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <Link
                  href={`/lists/${list.id}`}
                  className="block truncate font-medium text-brand-500 hover:underline"
                >
                  {list.name}
                </Link>
                <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                  {list.itemCount === null
                    ? "—"
                    : t("itemCount", { count: list.itemCount })}
                  {" · "}
                  <a
                    href={`https://www.themoviedb.org/list/${list.tmdbListId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-500 hover:underline"
                  >
                    {t("openOnTmdb")}
                  </a>
                </p>
                <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                  {list.lastImportedAt
                    ? mounted
                      ? t("lastImport", {
                          date: formatDateTime(list.lastImportedAt, monthFirst),
                        })
                      : ""
                    : t("neverImported")}
                </p>
                {list.lastError && (
                  <p className="text-theme-sm text-error-500 break-words">
                    {translateErrorKey(
                      tErrors as unknown as ErrorTranslator,
                      list.lastError,
                      undefined,
                      list.lastError,
                    )}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRemoving(list)}
                className="shrink-0"
              >
                {t("detach")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <RemoveTmdbListModal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        name={removing?.name ?? ""}
        onConfirm={handleRemove}
      />
    </div>
  );
}
