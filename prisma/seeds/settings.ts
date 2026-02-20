import { prisma } from "@/lib/prisma";

export async function seedSettings() {
  const settings = [
    { key: 'path_movies', value: '/home/dientuki/Media/Movies' },
    { key: 'path_series', value: '/home/dientuki/Media/Series' },
    { key: 'path_downloads', value: '/home/dientuki/Media/Downloads' },

    { key: 'torrent_client', value: 'qbittorrent' },
    { key: 'torrent_host', value: 'localhost' },
    { key: 'torrent_port', value: '8080' },
    { key: 'torrent_api_key', value: '' },

    { key: 'tracker_client', value: 'prowlarr' },
    { key: 'tracker_host', value: 'localhost' },
    { key: 'tracker_port', value: '9696' },
    { key: 'tracker_api_key', value: '' },
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
