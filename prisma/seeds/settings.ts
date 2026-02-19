import { prisma } from "@/lib/prisma";

export async function seedSettings() {
  const settings = [
    { key: 'path_movies', value: '/home/dientuki/Media/Movies' },
    { key: 'path_series', value: '/home/dientuki/Media/Series' },
    { key: 'path_downloads', value: '/home/dientuki/Media/Downloads' },
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
