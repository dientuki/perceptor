import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Download, Film, Search, Server } from "lucide-react";
import LoginForm from "@/components/auth/LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.login");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function Login() {
  const t = await getTranslations("landing");
  const tCommon = await getTranslations("common");

  return (
    <>
      <div className="relative hidden overflow-hidden bg-gray-50 dark:bg-gray-900 lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:px-12 lg:pt-16">
        <div className="flex flex-col items-start text-left">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-theme-sm font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            {t("badge")}
          </span>
          <h1 className="text-title-md font-bold text-gray-800 dark:text-white/90 sm:text-title-lg">
            {tCommon("appName")}
          </h1>
          <p className="mt-4 max-w-lg text-theme-xl text-gray-500 dark:text-gray-400">
            {t("description")}
          </p>
          <div className="mt-8 flex w-full max-w-lg flex-wrap gap-3">
            <Feature icon={<Search className="size-5" />} label={t("features.search")} />
            <Feature icon={<Download className="size-5" />} label={t("features.download")} />
            <Feature icon={<Film className="size-5" />} label={t("features.transcode")} />
            <Feature icon={<Server className="size-5" />} label={t("features.organize")} />
          </div>
        </div>
        <Image
          src="/images/bg-frontpage.png"
          alt={t("illustrationAlt")}
          width={1264}
          height={843}
          priority
          className="mt-8 h-auto w-full"
        />
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex min-w-[150px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2.5 font-medium text-gray-700 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
      <span className="text-brand-500 dark:text-brand-400">{icon}</span>
      {label}
    </div>
  );
}
