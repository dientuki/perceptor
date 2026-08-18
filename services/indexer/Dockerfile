FROM lscr.io/linuxserver/prowlarr:2.5.2

# jq para editar el JSON de /api/v1/config/host; curl ya viene en la imagen base
# (lo usa el healthcheck de docker-compose.yaml).
RUN apk add --no-cache jq

# Corre en paralelo al proceso de Prowlarr, no antes: ver el comentario en
# custom-services.d/10-prowlarr-credentials sobre por qué no puede ser
# custom-cont-init.d como en services/torrent.
COPY --chmod=755 custom-services.d/ /custom-services.d/

# Runs before Prowlarr starts, writing INDEXER_API_KEY into config.xml — see the comment in
# custom-cont-init.d/10-prowlarr-apikey for why this one can be custom-cont-init.d.
COPY --chmod=755 custom-cont-init.d/ /custom-cont-init.d/
