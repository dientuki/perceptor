#!/bin/bash

set -o allexport
[ -f ../.env ] && source ../.env
set +o allexport

curl -X POST http://${HOST:-localhost}:${PORT:-3000}/api/torrents/finished \
  -H "Content-Type: application/json" \
  -d "{\"infoHash\":\"$1\", \"contentPath\":\"$2\"}"
