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

echo "Instalando Perceptor..."
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "No se encontró Docker. Instalá Docker (con el plugin de Compose) y volvé a correr este script."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker está instalado pero falta el plugin de Compose (docker compose). Instalalo y volvé a intentar."
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
  echo "Instalación existente: manteniendo la versión ya instalada (${PERCEPTOR_TAG})."
else
  echo "Buscando la última versión publicada..."
  resolved_tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
  PERCEPTOR_TAG="${resolved_tag:-latest}"
  echo "Instalando ${PERCEPTOR_TAG}."
fi

# docker-compose.yaml no es dato de usuario — se refresca siempre a lo que dice la versión
# resuelta arriba, así una reinstalación con la misma versión no lo deja desactualizado.
raw_ref="$PERCEPTOR_TAG"
[ "$raw_ref" = "latest" ] && raw_ref="master"
echo "Descargando docker-compose.yaml (${raw_ref})..."
curl -fsSL "https://raw.githubusercontent.com/${REPO}/${raw_ref}/docker-compose.yaml" -o docker-compose.yaml

if [ "$fresh_install" = true ]; then
  echo "Descargando .env.example..."
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/${raw_ref}/.env.example" -o .env
  echo ".env creado."
else
  echo "Reparando la instalación existente en este directorio."
fi

ensure_env_var PERCEPTOR_TAG "$PERCEPTOR_TAG"

# ---------------------------------------------------------------------------
# Las cinco preguntas de REQ-5. Sólo se hacen en una instalación nueva — .env.example ya trae
# un valor de plantilla para cada una de estas, así que "sigue vacía" no sirve para decidir si
# ya se respondieron (ver fresh_install más arriba).
# ---------------------------------------------------------------------------

if [ "$fresh_install" = true ]; then
  read -rp "Carpeta de descargas [./data/downloads]: " downloads_dir </dev/tty
  downloads_dir="${downloads_dir:-./data/downloads}"
  set_env_var HOST_DOWNLOADS_DIR "$downloads_dir"

  read -rp "Carpeta de tu biblioteca / media server [./data/library]: " destinations_dir </dev/tty
  destinations_dir="${destinations_dir:-./data/library}"
  set_env_var HOST_DESTINATIONS_DIR "$destinations_dir"

  read -rp "Usuario administrador [admin]: " admin_user </dev/tty
  set_env_var ADMIN_USER "${admin_user:-admin}"

  read -rsp "Contraseña de administrador: " admin_password </dev/tty
  echo
  while [ -z "$admin_password" ]; do
    read -rsp "No puede estar vacía. Contraseña de administrador: " admin_password </dev/tty
    echo
  done
  set_env_var ADMIN_PASSWORD "$admin_password"

  # Misma pregunta y misma redacción que bin/install (docs/spec/features/049.../infra/plan.md
  # § Existing code to reuse). true habilita Traefik (Host() por dominio); false expone cada
  # servicio directo en su puerto. Desde T010, Traefik también necesita el profile encendido
  # (COMPOSE_PROFILES=traefik) — sin eso, `docker compose up -d` no lo arranca aunque
  # USE_TRAEFIK=true.
  read -rp "¿Usar Traefik para rutear por dominio? [y/N] " use_traefik </dev/tty
  case "$use_traefik" in
    [yY]*)
      read -rp "Dominio a usar (ej: perceptor.local): " domain </dev/tty
      set_env_var USE_TRAEFIK true
      set_env_var DOMAIN "${domain}"
      set_env_var COMPOSE_PROFILES traefik
      echo
      echo "Listo. Agregá esto a /etc/hosts para que resuelva:"
      echo "  127.0.0.1  ${domain} api.${domain} torrent.${domain} indexer.${domain}"
      ;;
    *)
      set_env_var USE_TRAEFIK false
      echo
      echo "Traefik desactivado. Vas a acceder a cada servicio por su puerto en localhost"
      echo "(WEB_PORT, API_PORT, INDEXER_PORT, QBITTORRENT_WEBUI_PORT)."
      ;;
  esac

  read -rp "TMDB API key (opcional, Enter para saltear y cargarla después desde Ajustes): " tmdb_api_key </dev/tty
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
fi

# Secretos generados por instalación (REQ-6): nunca en un archivo versionado, nunca un default.
# Estos sí ship vacíos en .env.example, así que "sigue vacío" alcanza para decidir.
if env_var_is_empty JWT_SECRET; then
  echo "Generando JWT_SECRET..."
  ensure_env_var JWT_SECRET "$(openssl rand -hex 32)"
fi

if env_var_is_empty INDEXER_API_KEY; then
  echo "Buscando una INDEXER_API_KEY existente en el volumen de indexer..."
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
    echo "Encontrada, adoptando la key existente del volumen de indexer."
    ensure_env_var INDEXER_API_KEY "$existing_key"
  else
    echo "No hay volumen previo, generando INDEXER_API_KEY..."
    ensure_env_var INDEXER_API_KEY "$(openssl rand -hex 16)"
  fi
fi

# Usuario dedicado de base de datos (REQ-7), sólo en una instalación nueva. NFR-4: MariaDB sólo
# crea MARIADB_USER cuando el volumen está vacío — si ya existe un volumen de este proyecto,
# las credenciales que tenga son las que valen, y no se tocan acá.
if [ "$fresh_install" = true ]; then
  project="$(basename "$PWD" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-')"
  if docker volume inspect "${project}_mariadb_data" >/dev/null 2>&1; then
    echo "Aviso: existe un volumen de base de datos de una instalación anterior sin .env."
    echo "No se pueden adivinar sus credenciales — restaurá el .env original o borrá el volumen"
    echo "(docker volume rm ${project}_mariadb_data) antes de continuar con una instalación nueva."
    exit 1
  fi
  echo "Generando credenciales de base de datos..."
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
echo "Descargando las imágenes (${PERCEPTOR_TAG})..."
docker compose pull

echo
echo "Levantando el stack... la primera vez puede tardar varios minutos (migración + seed de api)."
docker compose up -d --wait --wait-timeout 600

if env_var_is_empty SERVICE_TOKEN; then
  echo "Minteando SERVICE_TOKEN..."
  # </dev/null por el mismo motivo que el `docker compose run` de arriba: bajo `curl | bash` el
  # stdin de bash es el script mismo, y compose lo adjunta al contenedor aunque no lo lea nadie.
  service_token=$(docker compose exec -T api node dist/scripts/mint-service-token.js </dev/null)
  ensure_env_var SERVICE_TOKEN "$service_token"
  echo "Reiniciando torrent/worker para que tomen el SERVICE_TOKEN nuevo..."
  docker compose up -d torrent worker
fi

echo
echo "Listo. Perceptor está corriendo."
if [ "${USE_TRAEFIK}" = "true" ]; then
  echo "URL: http://${DOMAIN}"
else
  echo "URL: http://localhost:${WEB_PORT}"
fi
echo "Usuario administrador: ${ADMIN_USER}"
