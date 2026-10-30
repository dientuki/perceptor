const IPV6_HOST = /^(\[[0-9a-fA-F:.]+\])(?::\d{1,5})?$/;
const NAME_OR_IPV4_HOST =
  /^([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::\d{1,5})?$/;

export function parseRequestHostname(
  forwardedHost: string | null,
  host: string | null,
): string {
  const raw = (forwardedHost?.split(",")[0] ?? host ?? "").trim();
  const match = IPV6_HOST.exec(raw) ?? NAME_OR_IPV4_HOST.exec(raw);

  return match?.[1] ?? "localhost";
}

const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function resolveServiceUrl(
  endpoint: { url: string | null; port: number | null } | null | undefined,
  requestHost: string,
): string | null {
  if (!endpoint) {
    return null;
  }

  const byName =
    !requestHost.startsWith("[") &&
    !IPV4_HOST.test(requestHost) &&
    requestHost.toLowerCase() !== "localhost";

  if (byName && endpoint.url) {
    return endpoint.url;
  }

  if (endpoint.port !== null && endpoint.port > 0) {
    return `http://${requestHost}:${endpoint.port}/`;
  }

  return endpoint.url ?? null;
}
