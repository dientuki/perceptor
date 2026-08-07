#!/bin/bash
# Se invoca con /bin/bash explícito desde la línea `program` de [AutoRun]
# (ver custom-cont-init.d/20-qbittorrent-autorun), no por shebang: el script
# llega por bind mount y así no depende de que el bit +x sobreviva al montaje.
#
# Avisa al api que un torrent terminó, mandando el info hash por GraphQL.
set -euo pipefail

INFO_HASH="${1:-}"
GRAPHQL_URL="${INTERNAL_GRAPHQL_URL:-}"

if [ -z "${INFO_HASH}" ]; then
  echo "[on-torrent-completed] ERROR: falta el info hash (primer argumento, %I de qBittorrent)." >&2
  exit 1
fi

if [ -z "${GRAPHQL_URL}" ]; then
  echo "[on-torrent-completed] ERROR: INTERNAL_GRAPHQL_URL está vacío. No se puede avisar al api." >&2
  exit 1
fi

# Variables de GraphQL en vez de interpolar el hash en el query string: el
# formato de printf va entre comillas simples, así $h sobrevive a bash y no
# hay tres niveles de escapado de comillas dobles.
curl -sS -X POST "${GRAPHQL_URL}" \
  -H 'Content-Type: application/json' \
  --data-raw "$(printf '{"query":"mutation T($h: String!) { torrentCompleted(infoHash: $h) }","variables":{"h":"%s"}}' "${INFO_HASH}")"
