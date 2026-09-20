import { headers } from "next/headers";

/**
 * Whether the session cookie may carry the `Secure` attribute.
 *
 * Derived from the protocol the browser actually used, never from `NODE_ENV`.
 * The published images run with `NODE_ENV=production` (the `prod` stage in
 * `services/web/Dockerfile`) while `install.sh` sets up plain HTTP — Traefik's
 * only entrypoint is `:80`, and without Traefik the stack is reached on a
 * published port. A `NODE_ENV`-driven `Secure` therefore made every browser
 * silently discard the cookie it had just been handed on any origin other than
 * localhost, so the login succeeded and the very next request was anonymous
 * again, with no error logged anywhere.
 *
 * A Server Action always receives an `Origin` header — Next requires it to
 * validate the request — and it already reflects TLS terminated in front of the
 * container. `x-forwarded-proto` is the fallback for a proxy that strips it.
 */
export async function isSecureRequest(): Promise<boolean> {
  const headerStore = await headers();

  const origin = headerStore.get("origin");
  if (origin) {
    return origin.startsWith("https://");
  }

  return (
    headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
  );
}

/**
 * Rewrites the leading `http:`/`https:` of `url` to the scheme of the current
 * request. Everything after the scheme is left untouched; a value that is not
 * an http(s) URL is returned unchanged.
 */
export async function withRequestScheme(url: string): Promise<string> {
  const match = /^https?:\/\//.exec(url);
  if (!match) {
    return url;
  }
  const scheme = (await isSecureRequest()) ? "https://" : "http://";
  return scheme + url.slice(match[0].length);
}
