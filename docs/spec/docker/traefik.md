---
title: Traefik Infrastructure Service
spec_version: 1.0.0
author: Juan Farias
created_at: 2026-08-04
last_updated: 2026-08-04
status: Approved
target_service: perceptor-traefik
---

# SPEC: Traefik Infrastructure Service (`spec.md`)

## Context & Goal
The Traefik service acts as the primary ingress edge router for the `perceptor` stack. It provides dynamic service discovery via the Docker daemon socket and routes external HTTP/HTTPS traffic to internal services using container labels.

## Requirements

### Functional Requirements
- [x] **REQ-1 (Dynamic Routing)**: Must monitor the Docker daemon socket (`/var/run/docker.sock`) in read-only mode to detect running containers.
- [x] **REQ-2 (Explicit Opt-In)**: Must only expose containers that explicitly declare `traefik.enable=true` (`--providers.docker.exposedbydefault=false`).
- [x] **REQ-3 (Entrypoints)**: Must accept external incoming connections on port `80` (HTTP) and port `443` (HTTPS).
- [x] **REQ-4 (Ping Endpoint)**: Must expose an internal `--ping` endpoint to enable automated healthchecks.

### Non-Functional & Operational Requirements
- [x] **NFR-1 (Isolation)**: Must operate independently without hard container dependencies (`depends_on`).
- [x] **NFR-2 (Resilience)**: Must maintain the restart policy `unless-stopped`.
- [x] **NFR-3 (Health Status)**: Must execute healthcheck every `10s` with a `3s` timeout, marking the container unhealthy after `3` failed retries.

## Contracts & Interfaces

### Exposed System Ports
| Host Port | Container Port | Protocol | Purpose |
| :--- | :--- | :--- | :--- |
| `80` | `80` | TCP | Web HTTP entrypoint |
| `443` | `443` | TCP | WebSecure HTTPS entrypoint |

### Target Service Contracts (Docker Labels)
Any application service connecting to `perceptor-net` must satisfy the following label contract to be routable:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.<service_name>.rule=Host(`<domain_pattern>`)"
  - "traefik.http.routers.<service_name>.entrypoints=web"
  - "traefik.http.services.<service_name>.loadbalancer.server.port=<internal_container_port>"