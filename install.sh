#!/bin/bash
# Instalador de Perceptor para una máquina con Docker y sin checkout del repositorio (049).
# Uso previsto:
#   curl -fsSL https://raw.githubusercontent.com/dientuki/perceptor/master/install.sh | bash
# Corre en el directorio actual (se espera vacío la primera vez) y deja ahí exactamente dos
# archivos que importan — docker-compose.yaml y .env — más ./backups una vez que el stack corrió
# al menos una vez (REQ-3, AC-2). No requiere Node, prisma ni ninguna otra herramienta en el host
# (Artículo I): todo lo que hace es escribir esos dos archivos y llamar a `docker compose`.
#
# Reentrante a propósito (REQ-8): si ya hay un .env en este directorio, sólo completa lo que
# falta — nunca pisa un valor ya configurado, nunca toca las credenciales de un volumen de base
# de datos existente (NFR-4), nunca corre nada destructivo (NFR-3).
set -e

REPO="dientuki/perceptor"

echo "Installing Perceptor..."
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Install Docker (with the Compose plugin) and run this script again."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker is installed but the Compose plugin (docker compose) is missing. Install it and try again."
  exit 1
fi

# fresh_install es el gate de todo lo que sigue: distingue "recién copié .env.example, cada
# valor ahí es un default de plantilla que hay que reemplazar" de "ya hay un .env de una
# instalación anterior, no tocar nada que ya esté resuelto" (REQ-8). No sirve mirar si una
# variable puntual está vacía — .env.example trae valores no vacíos para la mayoría (ADMIN_USER,
# HOST_DOWNLOADS_DIR, DB_USER, PUID, los puertos...); sólo JWT_SECRET/SERVICE_TOKEN/
# INDEXER_API_KEY/TMDB_API_KEY viajan vacíos ahí y a esos sí les alcanza con chequear el valor.
fresh_install=true
[ -f .env ] && fresh_install=false

# ---------------------------------------------------------------------------
# Helpers reusados tal cual de bin/install: mismo shape, mismo motivo de cada uno.
# ---------------------------------------------------------------------------
set_env_var() {
  # sed -i no es portable (GNU vs BSD/macOS piden flags distintos): escribir a un temporal y
  # mover evita la diferencia por completo. Delimitador '|' porque algunos valores (rutas,
  # DATABASE_URL) contienen '/'.
  sed "s|^${1}=.*|${1}=${2}|" .env > .env.tmp && mv .env.tmp .env
}

ensure_env_var() {
  # Como set_env_var, pero agrega la línea si no existe todavía.
  if grep -q "^${1}=" .env; then
    set_env_var "$1" "$2"
  else
    echo "${1}=${2}" >> .env
  fi
}

# Sólo para las variables que .env.example ya trae vacías (JWT_SECRET, SERVICE_TOKEN,
# INDEXER_API_KEY, TMDB_API_KEY): "todavía vacía" es una señal confiable de "falta generarla".
env_var_is_empty() {
  ! grep -q "^${1}=.\+" .env 2>/dev/null
}

# ---------------------------------------------------------------------------
# Resolver qué versión instalar/mantener. Una instalación ya existente nunca se mueve sola
# (REQ-14): si .env ya trae PERCEPTOR_TAG, se respeta; si no, se resuelve el último release
# publicado y se fija ese valor exacto (nunca "latest" mismo, para que "volver a la versión
# anterior" tenga un número concreto al que volver).
# ---------------------------------------------------------------------------
if [ "$fresh_install" = false ] && grep -q '^PERCEPTOR_TAG=.\+' .env; then
  PERCEPTOR_TAG=$(grep '^PERCEPTOR_TAG=' .env | cut -d= -f2-)
  echo "Existing installation: keeping the version already installed (${PERCEPTOR_TAG})."
else
  echo "Looking for the latest published version..."
  resolved_tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
  PERCEPTOR_TAG="${resolved_tag:-latest}"
  echo "Installing ${PERCEPTOR_TAG}."
fi

# docker-compose.yaml no es dato de usuario — se refresca siempre a lo que dice la versión
# resuelta arriba, así una reinstalación con la misma versión no lo deja desactualizado.
raw_ref="$PERCEPTOR_TAG"
[ "$raw_ref" = "latest" ] && raw_ref="master"
echo "Downloading docker-compose.yaml (${raw_ref})..."
curl -fsSL "https://raw.githubusercontent.com/${REPO}/${raw_ref}/docker-compose.yaml" -o docker-compose.yaml

if [ "$fresh_install" = true ]; then
  echo "Downloading .env.example..."
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/${raw_ref}/.env.example" -o .env
  echo ".env created."
else
  echo "Repairing the existing installation in this directory."
fi

ensure_env_var PERCEPTOR_TAG "$PERCEPTOR_TAG"

# ---------------------------------------------------------------------------
# Las cinco preguntas de REQ-5. Sólo se hacen en una instalación nueva — .env.example ya trae
# un valor de plantilla para cada una de estas, así que "sigue vacía" no sirve para decidir si
# ya se respondieron (ver fresh_install más arriba).
# ---------------------------------------------------------------------------

if [ "$fresh_install" = true ]; then
  read -rp "Downloads folder [./data/downloads]: " downloads_dir </dev/tty
  downloads_dir="${downloads_dir:-./data/downloads}"
  set_env_var HOST_DOWNLOADS_DIR "$downloads_dir"

  read -rp "Your library / media server folder [./data/library]: " destinations_dir </dev/tty
  destinations_dir="${destinations_dir:-./data/library}"
  set_env_var HOST_DESTINATIONS_DIR "$destinations_dir"

  read -rp "Administrator username [admin]: " admin_user </dev/tty
  set_env_var ADMIN_USER "${admin_user:-admin}"

  while true; do
    read -rsp "Administrator password (minimum 6 characters): " admin_password </dev/tty
    echo
    if [ "${#admin_password}" -lt 6 ]; then
      echo "It must be at least 6 characters long."
      continue
    fi
    read -rsp "Repeat the password: " admin_password_confirm </dev/tty
    echo
    [ "$admin_password" = "$admin_password_confirm" ] && break
    echo "The passwords do not match."
  done
  unset admin_password_confirm

  # Misma pregunta y misma redacción que bin/install (docs/spec/features/049.../infra/plan.md
  # § Existing code to reuse). true habilita Traefik (Host() por dominio); false expone cada
  # servicio directo en su puerto. Desde T010, Traefik también necesita el profile encendido
  # (COMPOSE_PROFILES=traefik) — sin eso, `docker compose up -d` no lo arranca aunque
  # USE_TRAEFIK=true.
  read -rp "Use Traefik to route by domain? [y/N] " use_traefik </dev/tty
  case "$use_traefik" in
    [yY]*)
      read -rp "Domain to use (e.g. perceptor.local): " domain </dev/tty
      set_env_var USE_TRAEFIK true
      set_env_var DOMAIN "${domain}"
      set_env_var COMPOSE_PROFILES traefik
      echo
      echo "Done. Add this to /etc/hosts so it resolves:"
      echo "  127.0.0.1  ${domain} api.${domain} torrent.${domain} indexer.${domain}"
      ;;
    *)
      set_env_var USE_TRAEFIK false
      echo
      echo "Traefik disabled. You will reach each service on its own localhost port"
      echo "(WEB_PORT, API_PORT, INDEXER_PORT, QBITTORRENT_WEBUI_PORT)."
      ;;
  esac

  read -rp "TMDB API key (optional, press Enter to skip and set it later from Settings): " tmdb_api_key </dev/tty
  [ -n "$tmdb_api_key" ] && set_env_var TMDB_API_KEY "$tmdb_api_key"
fi

downloads_dir=$(grep '^HOST_DOWNLOADS_DIR=' .env | cut -d= -f2-)
destinations_dir=$(grep '^HOST_DESTINATIONS_DIR=' .env | cut -d= -f2-)
mkdir -p "$downloads_dir" "$destinations_dir"

# ---------------------------------------------------------------------------
# Todo lo demás se deriva, no se pregunta (REQ-5) — también sólo en una instalación nueva:
# un PUID/puerto/etc ya resuelto en una reinstalación es una elección que no se vuelve a tocar.
# ---------------------------------------------------------------------------

if [ "$fresh_install" = true ]; then
  set_env_var PUID "$(id -u)"
  set_env_var PGID "$(id -g)"

  # Gid dueño de la carpeta de biblioteca, no un default fijo (docs/spec/.../plan.md § Risks:
  # "MEDIA_GID guessed wrong" -> el encode termina en un archivo que el media server no puede
  # leer, sin ningún error visible). stat difiere entre GNU (Linux) y BSD/macOS.
  if stat -c %g "$destinations_dir" >/dev/null 2>&1; then
    media_gid=$(stat -c %g "$destinations_dir")
  else
    media_gid=$(stat -f %g "$destinations_dir")
  fi
  set_env_var MEDIA_GID "$media_gid"

  if [ -f /etc/timezone ]; then
    tz=$(cat /etc/timezone)
  elif command -v timedatectl >/dev/null 2>&1 && timedatectl show -p Timezone --value >/dev/null 2>&1; then
    tz=$(timedatectl show -p Timezone --value)
  elif [ -L /etc/localtime ]; then
    tz=$(readlink /etc/localtime | sed 's#.*/zoneinfo/##')
  else
    tz="UTC"
  fi
  set_env_var TZ "$tz"

  # Puerto libre más cercano al default, empezando por el default mismo.
  port_is_free() {
    ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  }
  pick_free_port() {
    local port="$1"
    while ! port_is_free "$port"; do
      port=$((port + 1))
    done
    echo "$port"
  }
  for pair in "WEB_PORT:3000" "API_PORT:4000" "QBITTORRENT_WEBUI_PORT:8080" \
              "QBITTORRENT_TORRENTING_PORT:6881" "INDEXER_PORT:9696"; do
    var="${pair%%:*}"
    default="${pair##*:}"
    set_env_var "$var" "$(pick_free_port "$default")"
  done

  # PUBLIC_UPLOAD_URL: el navegador pega ahí directo (POST /uploads, tus), no por la red
  # docker interna que usa INTERNAL_GRAPHQL_URL, así que .env.example no puede traer un
  # default útil — quedaba hardcodeado a "perceptor.local" sin importar el DOMAIN elegido,
  # rompiendo la subida en silencio en cualquier instalación con un dominio distinto. Recién
  # acá abajo porque el valor sin Traefik necesita el API_PORT ya definitivo (recién asignado
  # arriba, puede no ser el default si estaba ocupado).
  api_port=$(grep '^API_PORT=' .env | cut -d= -f2-)
  if [ "$(grep '^USE_TRAEFIK=' .env | cut -d= -f2-)" = "true" ]; then
    upload_domain=$(grep '^DOMAIN=' .env | cut -d= -f2-)
    set_env_var PUBLIC_UPLOAD_URL "http://api.${upload_domain}/uploads"
  else
    # IP de la interfaz con ruta a internet, no localhost: HOST_DOWNLOADS_DIR aparte, éste es
    # el único valor que el navegador (no el host) tiene que poder resolver, y "localhost"
    # sólo funciona si accedés desde la misma máquina. macOS no tiene `ip`, de ahí el fallback.
    if command -v ip >/dev/null 2>&1; then
      host_ip=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
    fi
    if [ -z "$host_ip" ] && command -v ipconfig >/dev/null 2>&1; then
      host_ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
    fi
    host_ip="${host_ip:-localhost}"
    set_env_var PUBLIC_UPLOAD_URL "http://${host_ip}:${api_port}/uploads"
    echo
    echo "PUBLIC_UPLOAD_URL is set to http://${host_ip}:${api_port}/uploads. If you will upload"
    echo "files from another computer or phone on the network and that is not the right IP, fix it"
    echo "by hand in .env."
  fi
fi

# Secretos generados por instalación (REQ-6): nunca en un archivo versionado, nunca un default.
# Estos sí ship vacíos en .env.example, así que "sigue vacío" alcanza para decidir.
if env_var_is_empty JWT_SECRET; then
  echo "Generating JWT_SECRET..."
  ensure_env_var JWT_SECRET "$(openssl rand -hex 32)"
fi

if env_var_is_empty INDEXER_API_KEY; then
  echo "Looking for an existing INDEXER_API_KEY in the indexer volume..."
  # --entrypoint /bin/sh evita la cadena /init de LinuxServer (no arranca nada) y --no-deps
  # evita arrastrar a flaresolverr sólo para leer un archivo. Mismo truco que bin/install; acá
  # corre contra la imagen publicada (docker-compose.yaml ya no tiene build:) en vez de construir.
  # -T y </dev/null son obligatorios bajo `curl | bash`: sin eso `docker compose run` adjunta el
  # stdin de bash — que es el pipe con el resto del script — y el contenedor se lo come entero,
  # dejando al script terminando en silencio con código 0 en esta misma línea.
  set -a; . ./.env; set +a
  existing_key=$(docker compose run --rm -T --no-deps --entrypoint /bin/sh indexer \
    -c 'sed -n "s:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p" /config/config.xml 2>/dev/null' </dev/null | tr -d '\r\n')
  if [ -n "$existing_key" ]; then
    echo "Found it, adopting the existing key from the indexer volume."
    ensure_env_var INDEXER_API_KEY "$existing_key"
  else
    echo "No previous volume found, generating INDEXER_API_KEY..."
    ensure_env_var INDEXER_API_KEY "$(openssl rand -hex 16)"
  fi
fi

# Usuario dedicado de base de datos (REQ-7), sólo en una instalación nueva. NFR-4: MariaDB sólo
# crea MARIADB_USER cuando el volumen está vacío — si ya existe un volumen de este proyecto,
# las credenciales que tenga son las que valen, y no se tocan acá.
if [ "$fresh_install" = true ]; then
  project="$(basename "$PWD" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-')"
  if docker volume inspect "${project}_mariadb_data" >/dev/null 2>&1; then
    echo "Warning: a database volume from a previous installation exists but there is no .env."
    echo "Its credentials cannot be guessed — restore the original .env or delete the volume"
    echo "(docker volume rm ${project}_mariadb_data) before continuing with a fresh installation."
    exit 1
  fi
  echo "Generating database credentials..."
  db_password="$(openssl rand -hex 20)"
  db_root_password="$(openssl rand -hex 20)"
  set_env_var DB_USER "perceptor"
  set_env_var DB_PASSWORD "$db_password"
  set_env_var DB_ROOT_PASSWORD "$db_root_password"
  set_env_var DATABASE_URL "mysql://perceptor:${db_password}@db:3306/perceptor"
fi

# ---------------------------------------------------------------------------
# Levantar el stack. api aplica sus migraciones y siembra los datos de producción sola al
# arrancar (PERCEPTOR_AUTO_MIGRATE, boot de api) — install.sh nunca corre prisma ni un seed acá.
# ---------------------------------------------------------------------------
set -a; . ./.env; set +a

echo
echo "Downloading images (${PERCEPTOR_TAG})..."
docker compose pull

echo
echo "Starting the stack... the first time can take several minutes (api migration + seed)."
if ! docker compose up -d --wait --wait-timeout 600; then
  # Sin este mensaje, `set -e` corta acá con sólo el error crudo de compose, y quien lo lea no
  # tiene forma de saber si el stack quedó a medio levantar o si hace falta empezar de cero.
  # `up -d` ya lanzó los containers antes de fallar el --wait — por eso pueden seguir corriendo
  # de fondo aunque el instalador se corte — y el propio script es reentrante (ver el comentario
  # sobre `fresh_install` al principio), así que la salida es simplemente correrlo de nuevo.
  echo >&2
  echo "ERROR: the stack did not become 'healthy' within the 600-second wait." >&2
  echo "The containers may still be running — check with:" >&2
  echo "  docker compose ps" >&2
  echo "If api is still migrating/seeding, wait a moment and run this same" >&2
  echo "installer again: it is re-entrant and does not overwrite anything already configured." >&2
  exit 1
fi

if env_var_is_empty SERVICE_TOKEN; then
  echo "Minting SERVICE_TOKEN..."
  # </dev/null por el mismo motivo que el `docker compose run` de arriba: bajo `curl | bash` el
  # stdin de bash es el script mismo, y compose lo adjunta al contenedor aunque no lo lea nadie.
  service_token=$(docker compose exec -T api node dist/scripts/mint-service-token.js </dev/null)
  # Un SERVICE_TOKEN vacío escrito en .env es peor que fallar acá: la instalación queda
  # arriba y sin ningún error visible en los logs de api/worker (torrent/worker jamás
  # reciben el aviso de torrent completado, y no hay dónde loguear eso salvo el propio
  # AutoRun hook, que nadie mira). Mejor abortar fuerte, con la salida cruda para diagnosticar.
  if [ -z "$service_token" ]; then
    echo "ERROR: minting SERVICE_TOKEN returned nothing. The installation is left without that token:" >&2
    echo "torrent and worker will not be able to authenticate against the api (download-complete notices" >&2
    echo "and encode reports will fail silently)." >&2
    echo "Retry manually with:" >&2
    echo "  docker compose exec api node dist/scripts/mint-service-token.js" >&2
    echo "and paste the result into SERVICE_TOKEN in .env, then run:" >&2
    echo "  docker compose up -d torrent worker" >&2
    exit 1
  fi
  ensure_env_var SERVICE_TOKEN "$service_token"
  echo "Restarting torrent/worker so they pick up the new SERVICE_TOKEN..."
  docker compose up -d torrent worker
fi

if [ "$fresh_install" = true ]; then
  echo "Setting the administrator password..."
  if ! printf '%s\n%s\n' "$admin_password" "$admin_password" \
    | docker compose exec -T api node dist/scripts/reset-password.js "$ADMIN_USER"; then
    echo "ERROR: could not set the administrator password." >&2
    echo "Retry manually with:" >&2
    echo "  docker compose exec api node dist/scripts/reset-password.js ${ADMIN_USER}" >&2
    exit 1
  fi
  unset admin_password
fi

echo
echo "Done. Perceptor is running."
if [ "${USE_TRAEFIK}" = "true" ]; then
  echo "URL: http://${DOMAIN}"
else
  echo "URL: http://localhost:${WEB_PORT}"
fi
echo "Administrator username: ${ADMIN_USER}"
echo "To change or recover the password, run:"
echo "  docker compose exec api node dist/scripts/reset-password.js ${ADMIN_USER}"
