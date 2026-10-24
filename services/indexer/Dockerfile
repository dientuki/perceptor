FROM lscr.io/linuxserver/prowlarr:2.6.5

# jq edits the JSON of /api/v1/config/host; curl already ships in the base image
# (docker-compose.yaml's healthcheck uses it).
RUN apk add --no-cache jq

# Runs alongside the Prowlarr process, not before it: see the comment in
# custom-services.d/10-prowlarr-credentials on why it cannot be
# custom-cont-init.d as in services/torrent.
COPY --chmod=755 custom-services.d/ /custom-services.d/

# Runs before Prowlarr starts, writing INDEXER_API_KEY into config.xml — see the comment in
# custom-cont-init.d/10-prowlarr-apikey for why this one can be custom-cont-init.d.
COPY --chmod=755 custom-cont-init.d/ /custom-cont-init.d/
