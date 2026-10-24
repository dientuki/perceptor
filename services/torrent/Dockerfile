FROM lscr.io/linuxserver/qbittorrent:5.2.4

# Auth bypass for Docker's internal network, and a save path backed by a volume.
# Both go into the image's defaults: init-qbittorrent-config copies them to /config
# when the volume is empty, so a new volume starts configured.
# The UI can change the save path later; this is only the initial value.
RUN sed -i \
    -e 's|^Downloads\\SavePath=.*|Downloads\\SavePath=/media/downloads|' \
    -e 's|^Downloads\\TempPath=.*|Downloads\\TempPath=/media/downloads/incomplete|' \
    -e '/^\[Preferences\]/a WebUI\\AuthSubnetWhitelistEnabled=true\nWebUI\\AuthSubnetWhitelist=172.16.0.0/12' \
    /defaults/qBittorrent.conf

# Runs once qBittorrent.conf exists and before qbittorrent-nox starts
COPY --chmod=755 custom-cont-init.d/ /custom-cont-init.d/

# AutoRun hook (on-torrent-completed.sh), before it was bind-mounted from
# ./services/torrent/commands — now baked into the image so a repository-less
# installation still reports a completed download (REQ-4).
COPY --chmod=755 commands/ /commands/
