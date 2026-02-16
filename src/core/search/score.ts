export function getScore(title: string): number {
  const t = title.toLowerCase()

  return (
    getSourceScore(t) +
    //getResolutionScore(t) +
    getAudioScore(t) +
    getPenalty(t)
  )
}

function getSourceScore(title: string): number {
  if (title.includes("remux")) return 100
  if (title.includes("bluray")) return 80
  if (title.includes("web-dl")) return 60
  if (title.includes("webrip")) return 50
  if (title.includes("hdrip")) return 40
  return 10
}

function getResolutionScore(title: string): number {
  if (title.includes("2160p")) return 30
  if (title.includes("1080p")) return 20
  if (title.includes("720p")) return 10
  return 0
}

function getAudioScore(title: string): number {
  if (title.includes("truehd")) return 20
  if (title.includes("dts-hd")) return 18
  if (title.includes("atmos")) return 15
  if (title.includes("ddp")) return 8
  if (title.includes("ac3")) return 5
  return 0
}

function getPenalty(title: string): number {
  let penalty = 0

  if (title.includes("yts")) penalty -= 30
  if (title.includes("rarbg")) penalty -= 10
  if (title.includes("web") && title.includes("x265")) penalty -= 5

  return penalty
}