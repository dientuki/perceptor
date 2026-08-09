import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import SettingsForm from "@/components/settings/SettingsForm";
import { getSettings } from "@/actions/settings";
import { getMediaRoots } from "@/actions/media-roots";
import { getMediaServerOptions } from "@/actions/media-server";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings | Perceptor",
  description: "Configuración de rutas y servicios",
};

export default async function SettingsPage() {
  const [settings, mediaRoots, mediaServerOptions] = await Promise.all([
    getSettings(),
    getMediaRoots(),
    getMediaServerOptions(),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Settings" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <SettingsForm settings={settings} mediaRoots={mediaRoots} mediaServerOptions={mediaServerOptions} />
        </div>
      </div>
    </div>
  );
}
