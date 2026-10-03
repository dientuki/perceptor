#!/bin/bash
# Shared Docker preflight, sourced by every bin/ wrapper that talks to the daemon.
#
# Having the `docker` command is not the same as having an engine behind it: both the CLI and the
# Compose plugin answer perfectly well with the daemon stopped, so a wrapper that checks only for
# the command (or for `docker compose version`) carries on and dies later with "Cannot connect to
# the Docker daemon at unix:///var/run/docker.sock", which says nothing about what to do.
#
# Not executable and not a wrapper itself — source it, do not run it. install.sh keeps its own
# copy of these three checks on purpose: it ships alone, with no bin/ beside it.

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not found. Install Docker (with the Compose plugin) and try again." >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker is installed but the Compose plugin (docker compose) is missing. Install it and try again." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but its engine is not running." >&2
    echo >&2
    echo "  Docker Desktop (macOS/Windows): open Docker Desktop and wait until it says \"Engine running\"." >&2
    echo "  Linux: sudo systemctl start docker   (and 'sudo systemctl enable docker' to start it at boot)" >&2
    echo >&2
    echo "Then try again. 'docker run hello-world' confirms the engine is reachable." >&2
    exit 1
  fi
}

# The Compose project name this directory's stack runs under, derived the same way Compose derives
# it: COMPOSE_PROJECT_NAME when set, the lowercased directory name otherwise. It is what prefixes
# every container and volume (perceptor-api-1, perceptor_mariadb_data), and the reason a checkout
# cloned into a differently named directory is a different stack to Docker.
compose_project_name() {
  if [ -n "${COMPOSE_PROJECT_NAME}" ]; then
    echo "${COMPOSE_PROJECT_NAME}"
  else
    # printf, not echo: `tr -c` would turn basename's own trailing newline into a '-' as well,
    # yielding "perceptor-" for a directory named "perceptor" — close enough to look right and
    # wrong enough to never match a real container or volume name.
    printf '%s' "$(basename "$PWD")" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-'
    echo
  fi
}
