#!/bin/bash
# Se invoca con /bin/bash explícito desde la línea `program` de [AutoRun]
# (ver custom-cont-init.d/20-qbittorrent-autorun), no por shebang: el script
# llega por bind mount y así no depende de que el bit +x sobreviva al montaje.
#
# Avisa al api que un torrent terminó, mandando el info hash por GraphQL.
set -euo pipefail

INFO_HASH="${1:-}"
GRAPHQL_URL="${INTERNAL_GRAPHQL_URL:-}"
# The machine credential (002-auth-login, REQ-5) — same one the worker uses,
# minted by `bin/npm api run token:service`, injected via docker-compose.yaml.
SERVICE_TOKEN="${SERVICE_TOKEN:-}"

if [ -z "${INFO_HASH}" ]; then
  echo "[on-torrent-completed] ERROR: falta el info hash (primer argumento, %I de qBittorrent)." >&2
  exit 1
fi

if [ -z "${GRAPHQL_URL}" ]; then
  echo "[on-torrent-completed] ERROR: INTERNAL_GRAPHQL_URL está vacío. No se puede avisar al api." >&2
  exit 1
fi

if [ -z "${SERVICE_TOKEN}" ]; then
  echo "[on-torrent-completed] ERROR: SERVICE_TOKEN está vacío. La api va a rechazar el aviso." >&2
  exit 1
fi

# Variables de GraphQL en vez de interpolar el hash en el query string: el
# formato de printf va entre comillas simples, así $h sobrevive a bash y no
# hay tres niveles de escapado de comillas dobles.
#
# -w agrega el status HTTP al final del body (separado por un newline) para
# poder chequear los dos: con el guard puesto, un fallo de auth es HTTP 200
# con un array "errors" en el body (así responde Apollo ante una excepción de
# GraphQL) — un chequeo de sólo status (--fail) lo vería como éxito y sería
# exactamente la ruptura silenciosa que este chequeo existe para evitar.
response="$(curl -sS -X POST "${GRAPHQL_URL}" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${SERVICE_TOKEN}" \
  -w $'\n%{http_code}' \
  --data-raw "$(printf '{"query":"mutation T($h: String!) { torrentCompleted(infoHash: $h) }","variables":{"h":"%s"}}' "${INFO_HASH}")")" || {
  echo "[on-torrent-completed] ERROR: curl falló contra ${GRAPHQL_URL}." >&2
  exit 1
}

http_code="${response##*$'\n'}"
body="${response%$'\n'*}"

if [ "${http_code}" -lt 200 ] || [ "${http_code}" -ge 300 ]; then
  echo "[on-torrent-completed] ERROR: la api respondió HTTP ${http_code}: ${body}" >&2
  exit 1
fi

case "${body}" in
  *'"errors"'*)
    echo "[on-torrent-completed] ERROR: la api devolvió errores: ${body}" >&2
    exit 1
    ;;
esac

echo "[on-torrent-completed] OK: ${body}"
