import { getTranslations } from "next-intl/server";

export default async function DashboardPage() {
  const t = await getTranslations("pages.dashboard");

  return <div>{t("placeholder")}</div>;
}
