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
      settings.map((s) => [s.key, s.value])
    );
  }

  return prisma.setting.findUnique({
    where: { key },
  });
}

/**
 * Obtiene múltiples configuraciones devolviendo un objeto con id y valor.
 * Útil para formularios que necesitan el ID para actualizar.
 */
export async function getSettingsExtended(
  keys: string[]
): Promise<Record<string, { id: number; value: string }>> {
  const settings = await prisma.setting.findMany({
    where: { key: { in: keys } },
  });

  return Object.fromEntries(
    settings.map((s) => [s.key, { id: s.id, value: s.value }])
  );
}

export async function updateSettingById(id: number, value: string) {
  return prisma.setting.update({
    where: { id },
    data: { value },
  });
}

export async function upsertSetting(key: string, value: string) {
  return prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
