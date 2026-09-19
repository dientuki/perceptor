"use client";

import { useTranslations } from "next-intl";
import Select from "@/components/form/Select";
import Button from "@/components/ui/button/Button";

const PAGE_SIZES = ["10", "25", "50"];

interface DownloadsPaginationProps {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}

export default function DownloadsPagination({
  page,
  pageCount,
  from,
  to,
  total,
  pageSize,
  onPage,
  onPageSize,
}: DownloadsPaginationProps) {
  const t = useTranslations("downloads.panel");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-gray-500 dark:text-gray-400">
        {t("showing", { from, to, total })}
      </p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">
            {t("perPage")}
          </span>
          <div className="w-24">
            <Select
              value={String(pageSize)}
              options={PAGE_SIZES.map((size) => ({ value: size, label: size }))}
              onChange={(e) => onPageSize(Number(e.target.value))}
            />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t("previous")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
