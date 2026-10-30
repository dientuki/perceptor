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
