"use client";

import { useTranslations } from "next-intl";
import Button from "@/components/ui/button/Button";
import { MEDIA_TYPE, type MediaType } from "@/types/media";

interface Props {
  onSearch: (query: string) => void;
  loading: boolean;
  type: MediaType;
}

export function SearchInput({ onSearch, loading, type }: Props) {
  const t = useTranslations("search.input");
  const containerT = useTranslations("search.container");
  const noun =
    type === MEDIA_TYPE.SHOW ? containerT("showNoun") : containerT("movieNoun");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const query = formData.get("query") as string;
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center gap-3">
      <div className="relative flex-1">
        <input
          name="query"
          type="text"
          placeholder={t("placeholder", { noun })}
          className="w-full rounded-lg border border-gray-300 bg-transparent py-3 pl-4 pr-10 text-black outline-none focus:border-brand-300 dark:border-gray-700 dark:text-white dark:focus:border-brand-800"
        />
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? t("searching") : t("submit")}
      </Button>
    </form>
  );
}
