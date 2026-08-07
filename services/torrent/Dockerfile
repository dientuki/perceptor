FROM lscr.io/linuxserver/qbittorrent:5.2.3

# Bypass de auth para la red interna de Docker y un save path que sí tiene volumen atrás.
# Se inyectan en el default de la imagen: init-qbittorrent-config lo copia a /config
# cuando el volumen está vacío, así un volumen nuevo nace configurado.
# La UI puede cambiar el save path después; esto es sólo el valor inicial.
RUN sed -i \
    -e 's|^Downloads\\SavePath=.*|Downloads\\SavePath=/media/downloads|' \
    -e 's|^Downloads\\TempPath=.*|Downloads\\TempPath=/media/downloads/incomplete|' \
    -e '/^\[Preferences\]/a WebUI\\AuthSubnetWhitelistEnabled=true\nWebUI\\AuthSubnetWhitelist=172.16.0.0/12' \
    /defaults/qBittorrent.conf

# Corre después de que existe qBittorrent.conf y antes de arrancar qbittorrent-nox
COPY --chmod=755 custom-cont-init.d/ /custom-cont-init.d/
