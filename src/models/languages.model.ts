import { prisma } from "@/lib/prisma";

export async function getIso3FromIso2(iso2: string) {
  const language = await prisma.language.findUnique({
    where: { iso2 },
  });

  return language?.iso3 ?? "eng";
}
