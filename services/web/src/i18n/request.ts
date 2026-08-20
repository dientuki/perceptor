import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getCurrentUserOrNull } from "@/actions/auth";
import { isSupportedLocale } from "@/i18n/locales";
import { negotiateLocale } from "@/i18n/negotiate";

/**
 * REQ-1 resolution order: (1) the authenticated user's `uiLocale`, if set and
 * supported; (2) the request's `Accept-Language` header, negotiated against
 * the supported set; (3) `en` — the last step is `negotiateLocale`'s own
 * fallback, so this function always resolves to a supported locale.
 *
 * `getCurrentUserOrNull()` never redirects on an auth error (T018), so this
 * resolves correctly for an anonymous request (the landing page, `/login`)
 * without looping through `/api/auth/clear-session`.
 */
export default getRequestConfig(async () => {
  const user = await getCurrentUserOrNull();

  let locale = user?.uiLocale;
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
