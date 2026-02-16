export async function addTorrent(url: string) {
  await fetch("http://localhost:8080/api/v2/torrents/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      urls: url
    })
  });
}