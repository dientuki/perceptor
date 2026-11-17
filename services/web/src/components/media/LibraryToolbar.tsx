"use client";

import { LayoutGrid, List } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setLibraryDisplay } from "@/actions/library";
import Select from "@/components/form/Select";
import {
  LIBRARY_FILTERS,
  LIBRARY_VIEWS,
  type LibraryDisplay,
  type LibraryFilter,
  type LibraryState,
  type LibraryView,
  libraryHref,
  PAGE_SIZES,
} from "@/lib/library-params";

type Props = {
  pathname: string;
  state: LibraryState;
  defaults: LibraryDisplay;
};

export default function LibraryToolbar({ pathname, state, defaults }: Props) {
  const t = useTranslations("media.library");
  const router = useRouter();

  const changeFilter = (filter: LibraryFilter) => {
    router.push(libraryHref(pathname, state, { filter, page: 1 }, defaults));
  };

  const changePageSize = async (pageSize: LibraryState["pageSize"]) => {
    await setLibraryDisplay(state.view, pageSize);
    router.push(
      libraryHref(
        pathname,
        state,
        { pageSize, page: 1 },
        { view: state.view, pageSize },
      ),
    );
  };

  const changeView = async (view: LibraryView) => {
    if (view === state.view) return;
    await setLibraryDisplay(view, state.pageSize);
    router.push(
      libraryHref(
        pathname,
        state,
        { view },
        { view, pageSize: state.pageSize },
      ),
    );
  };

  const viewButtonClass = (active: boolean) =>
    `flex h-11 w-11 items-center justify-center rounded-lg border ${
      active
        ? "border-brand-500 bg-brand-500 text-white"
        : "border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.05]"
    }`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="w-48">
        <Select
          value={state.filter}
          options={LIBRARY_FILTERS.map((value) => ({
            value,
            label: t(`filter.${value}`),
          }))}
          onChange={(e) => changeFilter(e.target.value as LibraryFilter)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">
            {t("perPage")}
          </span>
          <div className="w-24">
            <Select
              value={String(state.pageSize)}
              options={PAGE_SIZES.map((size) => ({
                value: String(size),
                label: String(size),
              }))}
              onChange={(e) =>
                changePageSize(
                  Number(e.target.value) as LibraryState["pageSize"],
                )
              }
            />
          </div>
        </div>
        <div className="flex gap-1">
          {LIBRARY_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={state.view === view}
              aria-label={t(`view.${view}`)}
              title={t(`view.${view}`)}
              onClick={() => changeView(view)}
              className={viewButtonClass(state.view === view)}
            >
              {view === "grid" ? <LayoutGrid size={18} /> : <List size={18} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
