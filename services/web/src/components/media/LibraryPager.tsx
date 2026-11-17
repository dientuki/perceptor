import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type LibraryDisplay,
  type LibraryState,
  libraryHref,
} from "@/lib/library-params";

type Props = {
  pathname: string;
  state: LibraryState;
  defaults: LibraryDisplay;
  page: number;
  totalPages: number;
  totalCount: number;
};

const CONTROL_CLASS =
  "inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 font-medium max-md:min-h-11 max-md:min-w-11 dark:border-gray-700";

export default function LibraryPager({
  pathname,
  state,
  defaults,
  page,
  totalPages,
  totalCount,
}: Props) {
  const t = useTranslations("media.library");

  if (totalCount === 0) return null;

  const controls = [
    { key: "first", target: 1, disabled: page <= 1 },
    { key: "previous", target: page - 1, disabled: page <= 1 },
    { key: "next", target: page + 1, disabled: page >= totalPages },
    { key: "last", target: totalPages, disabled: page >= totalPages },
  ];

  return (
    <nav
      aria-label={t("pagination")}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-gray-500 dark:text-gray-400">
        {t("pageOf", { page, totalPages })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {controls.map((control) =>
          control.disabled ? (
            <button
              key={control.key}
              type="button"
              aria-disabled="true"
              className={`${CONTROL_CLASS} cursor-not-allowed text-gray-400 opacity-60 dark:text-gray-500`}
            >
              {t(control.key)}
            </button>
          ) : (
            <Link
              key={control.key}
              href={libraryHref(
                pathname,
                state,
                { page: control.target },
                defaults,
              )}
              className={`${CONTROL_CLASS} text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.05]`}
            >
              {t(control.key)}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
