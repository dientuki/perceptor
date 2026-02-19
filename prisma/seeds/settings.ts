import { prisma } from "@/lib/prisma";

export async function seedSettings() {
  const settings = [
    { key: 'media_movies_path', value: '/mnt/media/movies' },
    { key: 'media_series_path', value: '/mnt/media/series' },
  ]

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    })
  }

  console.log('Settings seeded')
}
