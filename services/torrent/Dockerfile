FROM lscr.io/linuxserver/qbittorrent:5.2.4

# A save path backed by a volume.
# It goes into the image's defaults: init-qbittorrent-config copies them to /config
# when the volume is empty, so a new volume starts configured.
# The UI can change the save path later; this is only the initial value.
RUN sed -i \
    -e 's|^Downloads\\SavePath=.*|Downloads\\SavePath=/media/downloads|' \
    -e 's|^Downloads\\TempPath=.*|Downloads\\TempPath=/media/downloads/incomplete|' \
    /defaults/qBittorrent.conf

# Runs once qBittorrent.conf exists and before qbittorrent-nox starts
COPY --chmod=755 custom-cont-init.d/ /custom-cont-init.d/

# AutoRun hook (on-torrent-completed.sh), before it was bind-mounted from
# ./services/torrent/commands — now baked into the image so a repository-less
# installation still reports a completed download (REQ-4).
COPY --chmod=755 commands/ /commands/
