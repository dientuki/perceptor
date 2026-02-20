import { prisma } from "@/lib/prisma";

export async function getAllSettings(): Promise<Setting[]> {
  const settings: Setting[] = await prisma.setting.findMany();

  return Object.fromEntries(
    settings.map(s => [s.key, s.value])
  );
}

export async function getSetting(key: string): Promise<Setting> {
  return prisma.setting.findUnique({
    where: { key },
  });
}

export async function upsertSetting(key: string, value: string) {
  return prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
