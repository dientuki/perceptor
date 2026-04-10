import SettingPathCard from "@/components/settings/SettingPathCard";
import { Metadata } from "next";
import { getSetting } from "@/models/settings.model";

export const metadata: Metadata = {
  title: "Next.js Profile | TailAdmin - Next.js Dashboard Template",
  description:
    "This is Next.js Profile page for TailAdmin - Next.js Tailwind CSS Admin Dashboard Template",
};

export default async function Settings() {
  const paths = (await getSetting([
    "path_downloads",
    "path_movies",
    "path_shows",
  ])) as {
    path_downloads: { id: number; value: string };
    path_movies: { id: number; value: string };
    path_shows: { id: number; value: string };
  };

  return (
    <div>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90 lg:mb-7">
          Settings
        </h3>
        <div className="space-y-6">
          <SettingPathCard settings={paths} />
        </div>
      </div>
    </div>
  );
}
