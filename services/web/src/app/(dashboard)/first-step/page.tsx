import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/actions/auth";
import { getEnvironmentInfo } from "@/actions/environment";
import { getIndexerStatus } from "@/actions/indexer";
import { getMediaCapabilities } from "@/actions/media";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import AddIndexerButton from "@/components/indexers/AddIndexerButton";
import IndexerSetupGuide from "@/components/onboarding/IndexerSetupGuide";
import TmdbKeyOnboarding from "@/components/onboarding/TmdbKeyOnboarding";
import { parseRequestHostname } from "@/lib/request-host";

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
  const indexerPort = indexerEndpoint?.port ?? 0;
  const requestHeaders = await headers();
  const host = parseRequestHostname(
    requestHeaders.get("x-forwarded-host"),
    requestHeaders.get("host"),
  );
  // Spec 112, first-step indexer link
  const indexerUrl =
    indexerEndpoint?.url ??
    (indexerPort > 0 ? `http://${host}:${indexerPort}/` : null);

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="space-y-6">
        <TmdbKeyOnboarding
          isAdmin={user.isAdmin}
          keyRejected={false}
          alreadyConfigured={mediaCapabilities.catalogKeyConfigured}
        />
        <div>
          <AddIndexerButton />
        </div>
        <IndexerSetupGuide
          status={indexerStatus}
          indexerUrl={indexerUrl}
          indexerPort={indexerPort}
        />
      </div>
    </div>
  );
}
