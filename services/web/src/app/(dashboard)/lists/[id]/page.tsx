import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cache } from "react";
import { getTmdbList } from "@/actions/tmdb-lists";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import ListTitles from "@/components/lists/ListTitles";

const getList = cache(getTmdbList);

interface PageProps {
  params: Promise<{ id: string }>;
}

// Must run before any fetch — a NaN sent to the API as an Int! comes back
// as a non-auth GraphQL error that getTmdbList doesn't catch.
function parseListId(id: string): number | null {
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Spec 109, REQ-14 AC-16
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const listId = parseListId(id);

  const tNotFound = await getTranslations("notFound");
  const unavailableMetadata: Metadata = {
    title: tNotFound("metadataTitle"),
    description: tNotFound("message"),
  };

  if (listId === null) {
    return unavailableMetadata;
  }

  const list = await getList(listId);

  if (!list) {
    return unavailableMetadata;
  }

  const t = await getTranslations("pages.lists");

  return {
    title: `${list.name} | Perceptor`,
    description: t("detailMetadataDescription"),
  };
}

// Spec 109, REQ-14
export default async function ListDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const listId = parseListId(id);

  if (listId === null) {
    notFound();
  }

  const [list, locale, t] = await Promise.all([
    getList(listId),
    getLocale(),
    getTranslations("pages.lists"),
  ]);

  if (!list) {
    notFound();
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={list.name} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <ListTitles list={list} locale={locale} emptyMessage={t("empty")} />
      </div>
    </div>
  );
}
