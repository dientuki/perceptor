import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getCurrentUserOrNull } from "@/actions/auth";
import { getDefaultUiLocale } from "@/actions/settings";
import { isSupportedLocale } from "@/i18n/locales";
import { negotiateLocale } from "@/i18n/negotiate";

/**
 * REQ-6 resolution order: (1) the authenticated user's `uiLocale`, if set and
 * supported; (2) the installation's default UI language (`defaultUiLocale`,
 * `029-settings-screen-tabs`), if set and supported; (3) the request's
 * `Accept-Language` header, negotiated against the supported set; (4) `en` —
 * the last step is `negotiateLocale`'s own fallback, so this function always
 * resolves to a supported locale.
 *
 * `getCurrentUserOrNull()` and `getDefaultUiLocale()` both run for an
 * anonymous request (the landing page, `/login`) — neither assumes a
 * session, and neither redirects on a non-auth error, so this resolves
 * without looping through `/api/auth/clear-session`.
 */
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
