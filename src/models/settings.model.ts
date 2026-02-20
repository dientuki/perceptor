import { prisma } from "@/lib/prisma";
import { Setting } from '@prisma/client';

export async function getAllSettings(): Promise<Record<string, string>> {
  const settings: Setting[] = await prisma.setting.findMany();

  return Object.fromEntries(
    settings.map(s => [s.key, s.value])
  );
}

export async function getSetting(key: string): Promise<Setting | null>;
export async function getSetting(key: string[]): Promise<Record<string, string>>;
export async function getSetting(
  key: string | string[]
): Promise<Setting | Record<string, string> | null> {
  if (Array.isArray(key)) {
    const settings = await prisma.setting.findMany({
      where: { key: { in: key } },
    });

    return Object.fromEntries(
      settings.map(s => [s.key, s.value])
    );
  }

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
