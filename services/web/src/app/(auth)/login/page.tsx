import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.login");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
