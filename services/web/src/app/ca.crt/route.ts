import { readFile } from "node:fs/promises";

// Never cache at build: the file only exists at runtime, via a volume mount.
export const dynamic = "force-dynamic";

// Constant on purpose: nothing from the request may influence this path.
const CA_CERT_PATH = "/ca/ca.crt";

export async function GET() {
  let body: Buffer;
  try {
    body = await readFile(CA_CERT_PATH);
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="perceptor-ca.crt"',
    },
  });
}
