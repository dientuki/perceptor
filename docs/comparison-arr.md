# Perceptor vs el stack *arr, SickChill y Stremio

Foto al 2026-10-29 (`v0.6.0-rc1`, después de `109`). Las capacidades de los competidores salen de sus
features públicas, no están medidas; volver a chequear antes de citarlas.

**Tesis.** En el stack *arr el release descargado *es* el archivo final, así que toda su complejidad
va a *elegir* un release (perfiles de calidad, custom formats, upgrades). En Perceptor el release es
materia prima y el producto es la salida normalizada por FFmpeg: elegir el release importa menos y
los upgrades no existen a propósito.

## Mapeo de roles

| Función | Ecosistema *arr | Perceptor |
| :-- | :-- | :-- |
| Pedidos / descubrimiento | Jellyseerr / Overseerr | Búsqueda TMDB, billboard, `/lists` (`109`) |
| Películas | Radarr | `movies/`, `acquire_movies` (`076`) |
| Series | Sonarr / SickChill | `shows/`, `acquire_episodes` (`073`), season packs (`059`) |
| Indexadores | Prowlarr | El mismo Prowlarr, con FlareSolverr pre-registrado |
| Cliente de descarga | qBittorrent, Transmission, Deluge, SABnzbd, NZBGet… | Solo qBittorrent |
| Transcode | Tdarr / Unmanic | `worker`, integrado |
| Subtítulos | Bazarr | `101`–`107` (OpenSubtitles, ffsubsync, incrustado en el mkv) | | ➖
| Servidor de medios | Jellyfin / Plex, externo | Jellyfin / Plex, externo, reconciliación en ambos sentidos (`069`) |
| Calendario | Radarr / Sonarr | `/calendar` (`062`, `093`) |

## Resumen por eje

Leyenda: ✅ más fuerte · ➖ comparable / otro trade-off · ❌ más débil o ausente.
Tipo de ❌: **real** (pega en la tesis), **alcance** (declarable fuera), **tiempo** (no lo arregla código).

| Eje | Referencia del lado *arr | Hoy | Tras el plan | Notas |
| :-- | :-- | :-- | :-- | :-- |
| Selección de release | Radarr/Sonarr: perfiles de calidad, custom formats, upgrades, RSS, blocklist | ➖ | ➖ | `candidateRank` del lado servidor, veto de cine (`036`), ventanas de estreno por usuario con piso de calidad (`076`), carrera multi-fuente (`087`/`091`). Sin upgrades (deliberado), sin RSS (sweeps diarios), sin blocklist explícita |
| Normalización de salida | Tdarr: flows/plugins genéricos, GPU, nodos distribuidos, toda la biblioteca | ✅ | ✅ | AV1 + Opus, HDR/DV preservado, techo de resolución, tuning por `contentKind` (`057`), detección de grano (`094`), recorte de créditos de doblaje (`098`), recorte de fin de streams (`099`), remux de Blu-ray (`100`) |
| Throughput de encode | Tdarr: GPU (NVENC/QSV/VAAPI), N nodos | ❌ real | ➖ si GPU / ❌ alcance si no (paso 6) | Solo CPU, un `worker` (lease desde `054`); solo lo que entra, nunca la biblioteca existente |
| Seguridad del encode | Tdarr: health checks | ❌ real | ➖ (paso 3) | Sin passthrough por título (solo `compression_enabled` global, `032`), sin chequeo VMAF/duración antes de limpiar |
| Curaduría de pistas | Plugins de Tdarr (reglas manuales) | ✅ | ✅ | Títulos de pista en escritura nativa (`051`), poda de subtítulos por contenido C0–C3 (`102`), política de formatos (`070`) |
| Subtítulos | Bazarr: muchos proveedores, scoring, upgrades, sidecars | ➖ | ➖ | Umbrales de sync medidos e incrustado en el mkv, pero un solo proveedor (OpenSubtitles) y cuota de ~20/día; traducción en spec (`105`) |
| Manejo de series | Sonarr v4: tipos estándar/diario/anime, numeración absoluta, TheXEM, orden TVDB, monitoreo fino | ❌ alcance | ❌ alcance | Parseo `SxxEyy`, solo TMDB, sin numeración absoluta, auto-acquire binario por dueño (`109`) |
| Pedidos / usuarios | Jellyseerr/Overseerr: aprobaciones, cuotas, SSO Jellyfin/Plex; el *arr en sí es monousuario | ➖ | ➖ | Multiusuario de punta a punta, biblioteca y preferencias por usuario; sin aprobación, sin cuotas, sin SSO con el servidor de medios |
| Seeding / trackers privados | Radarr/Sonarr: hardlinks, seed hasta ratio/tiempo | ❌ real | ➖ si spec / ❌ alcance si se documenta (paso 6) | El torrent se detiene al completar y se elimina tras el último job (`095`); inservible con trackers que exigen ratio |
| Usenet | SABnzbd / NZBGet | ❌ alcance | ❌ alcance | Nada |
| Notificaciones | *arr: decenas de destinos (Discord, Telegram, ntfy, Apprise, webhooks) | ❌ real | ➖ (paso 4) | Nada |
| API externa / ecosistema | REST + API key; LunaSea, Homarr, Notifiarr, Recyclarr, Unpackerr, Maintainerr | ❌ alcance | ❌ alcance | GraphQL + JWT, no es una API pública estable (sin codegen, consumidores tipados a mano) |
| Listas de importación | Trakt, IMDb, watchlist de Plex, TMDB | ➖ | ➖ | Solo listas públicas de TMDB (`109`) |
| Instalación / operación | 6–7 contenedores cableados a mano, API keys copiadas entre apps, perfiles de TRaSH | ✅ | ✅ | Un `install.sh`, un login para app/qBittorrent/Prowlarr (`061`), keys generadas (`104`), auto-migrate con backup (`049`), multi-arch (`083`), HTTPS local (`066`), `/first-step` (`078`) |
| Madurez | Más de 10 años, comunidades grandes, guías de terceros | ❌ tiempo | ❌ tiempo, mejora (pasos 2 y 5) | ~3 meses, alpha cerrada, un mantenedor, 244/1084 ACs sin verificar (`docs/spec/pending-acs.md`) |

**Marcador hoy:** 3 ✅ · 4 ➖ · 8 ❌, de los cuales 4 son reales, 3 de alcance y 1 de tiempo.
Contando solo lo que pega en la tesis: 3 contra 4.

**Marcador tras el plan:** 3 ✅ · 6–8 ➖ · 4–6 ❌, y ninguna ❌ real: las que quedan son de alcance
(declaradas fuera, como los perfiles de calidad) o de tiempo. El rango depende de las dos decisiones
del paso 6 — con spec de seeding y GPU, 3 · 8 · 4; documentando ambas como fuera de alcance, 3 · 6 · 6.
Contando solo lo que pega en la tesis: 3 contra 0.

## SickChill y Stremio

| | SickChill | Stremio | Perceptor |
| :-- | :-- | :-- | :-- |
| Modelo | Gestor de series todo-en-uno (fork de Sick Beard, Python) | Streaming bajo demanda vía add-ons (Torrentio + debrid) | Todo-en-uno: adquirir → normalizar → biblioteca |
| Conserva un archivo | Sí, tal como salió | No | Sí, normalizado |
| Transcode | No | No | Sí |
| Tiempo hasta ver | Tiempo de descarga | Instantáneo (si está cacheado) | Descarga + encode |
| Riesgo de dependencia | Poca actividad upstream | Servicio debrid y add-ons | Autocontenido; externos: TMDB e indexadores |
| Eje vs Perceptor | La misma idea de "un solo stack", sin normalización | Consumir vs poseer | Poseer, curado |

## Brechas ordenadas por impacto en la tesis

| # | Brecha | Por qué importa | Estado |
| :-- | :-- | :-- | :-- |
| 1 | Passthrough por título + chequeo de sanidad del encode antes de limpiar | El transcode es irreversible; una heurística mala no tiene salida | Sin spec |
| 2 | Política de seeding (seed hasta ratio/tiempo, después encodear y limpiar) | Hoy los trackers privados son inusables | Sin spec; como mínimo documentarlo |
| 3 | Adaptadores de notificación (Apprise / webhook) | No hay señal cuando algo termina o falla | Sin spec, nada en el código |
| 4 | Control de espacio en disco antes de descargar y de encodear | Nada chequea el espacio libre | Sin spec |
| 5 | Encode por GPU o un segundo worker | Throughput; choca con el camino único de `024` y el singleton de `054` | Requiere decisión primero |
| 6 | Numeración absoluta de anime | `[Group] Show - 1047` nunca matchea `SxxEyy` | Sin spec |

**No se persigue a propósito:** perfiles de calidad, upgrades, custom formats — contradicen la tesis.

## Plan de acción

Estabilizar primero, con foco: sumar solo las derrotas que también son problemas de estabilidad.

| Paso | Qué | Resultado esperado |
| :-- | :-- | :-- |
| 1 | **Freeze de features corto.** Cerrar o pausar `105` (traducción de subtítulos), hoy a medio camino | Nada nuevo entra hasta el release final |
| 2 | **Pasada en vivo.** Instalación limpia con `install.sh`, una película y una temporada de punta a punta, con un checklist armado desde `docs/spec/pending-acs.md` | ~102 ACs tildados en 15 specs; bugs abiertos con lo que se rompa |
| 3 | **Spec corta: seguridad del encode.** Passthrough por título + chequeo de duración/streams antes de borrar la fuente (brecha 1) | Lo único que hoy puede destruir algo sin vuelta atrás queda cubierto |
| 4 | **Spec corta: notificaciones.** Un adaptador Apprise o webhook (brecha 3) | Las fallas silenciosas de la alpha se ven en el momento |
| 5 | **Release final 0.6.0.** Revertir que `latest` en GHCR apunte a una RC | Primer release final; `latest` vuelve a significar estable |
| 6 | **Decisiones sin código.** Seeding (¿spec o "solo trackers públicos" en el README?) y GPU/segundo worker (¿se rompen `024` y `054`?) | Brechas 2 y 5 resueltas como decisión, no como deuda implícita |
| 7 | **Feedback de la alpha.** Preguntar a los usuarios qué les dolió antes de elegir la siguiente brecha | La próxima prioridad sale del uso real, no de esta tabla |

**Postergado salvo que la alpha lo pida:** Usenet, API pública, numeración absoluta de anime
(brecha 6), control de espacio en disco (brecha 4) si la pasada en vivo no lo vuelve urgente.
