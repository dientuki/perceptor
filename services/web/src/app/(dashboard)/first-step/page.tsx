import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/actions/auth";
import { getEnvironmentInfo } from "@/actions/environment";
import { getIndexerStatus } from "@/actions/indexer";
import { getMediaCapabilities } from "@/actions/media";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import IndexerSetupGuide from "@/components/onboarding/IndexerSetupGuide";
import TmdbKeyOnboarding from "@/components/onboarding/TmdbKeyOnboarding";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.firstStep");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function FirstStepPage() {
  const t = await getTranslations("pages.firstStep");

  // Deliberately sequential, not Promise.all: indexerStatus/environmentInfo
  // are admin-only, and racing them with the isAdmin check below would turn
  // api's AdminGuard refusal into an uncaught 500 instead of a clean 404 —
  // the users/page.tsx precedent.
  const user = await getCurrentUser();

  if (!user.isAdmin) {
    notFound();
  }

  const [indexerStatus, environment, mediaCapabilities] = await Promise.all([
    getIndexerStatus(),
    getEnvironmentInfo(),
    getMediaCapabilities(),
  ]);

  const indexerEndpoint =
    environment.endpoints.find((endpoint) => endpoint.id === "indexer") ?? null;

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="space-y-6">
        <TmdbKeyOnboarding
          isAdmin={user.isAdmin}
          keyRejected={false}
          alreadyConfigured={mediaCapabilities.catalogKeyConfigured}
        />
        <IndexerSetupGuide
          status={indexerStatus}
          indexerUrl={indexerEndpoint?.url ?? null}
          indexerPort={indexerEndpoint?.port ?? 0}
        />
      </div>
    </div>
  );
}
