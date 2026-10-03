import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getCurrentUserOrNull } from "@/actions/auth";
import { getDefaultUiLocale } from "@/actions/settings";
import { isSupportedLocale } from "@/i18n/locales";
import { negotiateLocale } from "@/i18n/negotiate";

// Spec 018, REQ-1
export default getRequestConfig(async () => {
  const user = await getCurrentUserOrNull();

  let locale = user?.uiLocale;
  if (!locale || !isSupportedLocale(locale)) {
    const defaultUiLocale = await getDefaultUiLocale();
    if (defaultUiLocale && isSupportedLocale(defaultUiLocale)) {
      locale = defaultUiLocale;
    }
  }

  if (!locale || !isSupportedLocale(locale)) {
    const headerList = await headers();
    locale = negotiateLocale(headerList.get("accept-language"));
  }

  const messages = (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
