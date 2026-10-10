# Specs con Acceptance Criteria pendientes

<!-- pending-acs:begin intro -->
Medido el **2026-10-10**. Una fila por spec que todavia tiene al menos un `- [ ]` bajo
`## Acceptance Criteria`; las 50 specs que no aparecen estan en 100%.
<!-- pending-acs:end intro -->

**No editar a mano los bloques entre los marcadores `pending-acs:begin`/`end`.** Los regenera
`bin/pending-acs` parseando `^- \[([ x])\] \*\*AC-N\*\*` en cada `docs/spec/features/*/spec.md`;
`bin/pending-acs --check` falla si quedaron desactualizados. El comando `/pending-acs` corre eso y
despues escribe lo unico que la maquina no puede: la columna `obs`.

Esa columna resume el bloque `**Verification status**` que cada spec de la lista lleva adentro,
donde el detalle por AC esta escrito completo. Su primera oracion en negrita es el nombre del
blocker, y es la clave con la que se agrupa la tabla "Por blocker" — cambiarla cambia el rollup.

<!-- pending-acs:begin stats -->
| | |
| :-- | --: |
| Specs con ACs pendientes | **41** de 91 |
| ACs pendientes | **244** |
| ACs totales del proyecto | 1084 |
| ACs verificados | 840 (77%) |
<!-- pending-acs:end stats -->

## Por spec

<!-- pending-acs:begin specs -->
| spec | titulo | status | AC pendientes | detalle AC | obs |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 091 | race-loser-cleanup | Approved | 8/9 | 1, 2, 3, 4, 5, 6, 7, 8 | **Una corrida de pipeline.** Las ocho son carreras reales: dos o tres torrents sobre un mismo titulo, uno gana, y hay que ver que los perdedores se barran. Necesita pipeline corrido mas limpiar el huerfano de Inception desde la UI (su propio Out of Scope prohibe hacerlo por SQL). |
| 087 | force-replacement-arbitration | Implemented | 1/12 | 3 | **Una corrida de pipeline.** AC-3 pide que la carpeta de biblioteca del film quede con exactamente un archivo despues de que el reemplazo encodee. Es el paso 7 de la pasada viva de 091. |
| 085 | dependency-update-cadence | Implemented | 3/17 | 1, 2, 3 | **La UI de GitHub.** Las tres se leen en la UI de GitHub (Insights -> Dependency graph -> Dependabot) y dependen de que Dependabot haya abierto PRs. No hay camino local. |
| 083 | multi-arch-images | Implemented | 5/11 | 2, 3, 3b, 5, 6c | **Un host arm64 / GHCR.** AC-6/6b/7/8 fueron corridas el 2026-10-02 y observadas. Lo que falta: AC-2/AC-3/AC-3b leen manifests publicados en GHCR, y la clausula de `bin/dev` sobre un host arm64 de desarrollo no se puede correr aca (este host es x86_64). |
| 081 | library-layout-migration | Draft | 17/17 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17 | **Nada: no esta implementada.** `Draft`, nunca planeada, nunca implementada. Esta bloqueada por una enmienda al Articulo XII de la constitucion. **No deberia contarse en este backlog.** |
| 080 | installable-pwa | Approved | 9/10 | 1, 2, 3, 4, 5, 6, 7, 8, 9 | **Un browser que registre service workers.** El de esta sesion no puede: `register('/sw.js')` falla con `An unknown error occurred when fetching the script` incluso contra un origen de control, y `GET /sw.js` responde 200. AC-9 ademas destapo una divergencia: la fila de instalabilidad se decide por `window.isSecureContext`, no por `USE_HTTPS`, asi que en un `localhost` sin TLS leeria **Disponible** y el texto "requiere HTTPS" seria falso. AC-8 necesita un iPhone. |
| 079 | mobile-legibility-pass | Implemented | 1/10 | 6 | **Un dispositivo real.** AC-6 esta marcada *unverified on device*: es el zoom del input en iOS Safari. Necesita un telefono real, no un emulador. |
| 078 | first-step-tutorial | Implemented | 4/11 | 1, 3, 5, 9 | **Un segundo usuario, y decisiones del duenio.** AC-3 y la mitad negativa de AC-8 necesitan una sesion no-admin; AC-1 necesita un Prowlarr arriba con cero indexers (borrarle los dos); AC-9, taggear un indexer como `flaresolverr`; AC-5, recrear los contenedores con `USE_TRAEFIK=false`. |
| 077 | title-detail-three-column-layout | Approved | 1/12 | 7 | **Un problema de disenio, no una medicion.** Solo queda AC-7: con `api` caido, guardar en el modal no muestra un rechazo adentro — la Server Action responde con un re-render de la ruta que tambien falla, y se lleva la pagina. El refusal esta bien escrito y nunca llega al cliente. |
| 076 | automatic-movie-acquisition | Implemented | 13/18 | 3, 4, 5, 5b, 6, 7, 8, 9, 10, 11, 12, 14, 15 | **Adquisiciones reales.** Casi todo lo que queda hace que el sweep adjunte un release y arranque una descarga en la maquina del duenio. Conviene correr AC-3 a AC-15 juntas, con permiso, en una sola sesion. AC-17 ya esta tildada: el modal de la pelicula se corrio entero (127 filas, 14 candidatas, chips completos). |
| 075 | movie-refresh-sweep | Implemented | 2/14 | 6, 7 | **Dos peliculas que esta biblioteca no tiene.** AC-6 necesita un film que TMDB reporte `Canceled` y AC-7 uno sin ninguna fecha; ninguno se puede fixturear, porque el propio sweep reescribe esas columnas desde el catalogo. |
| 073 | automatic-episode-acquisition | Implemented | 5/11 | 4, 6, 7, 8, 11 | **Adquisiciones reales.** AC-4, AC-6, AC-7 y AC-11 adjuntan releases de verdad; AC-8 ademas necesita una fuente en vuelo, que tambien es una adquisicion. Para quien las corra: el candidato #1 de Reacher S04E08 medido hoy es `Reacher S04E08 Cut 2160P AMZN WEB-DL DD+ 5.1 Atmos DV HDR10+. H.265`. |
| 072 | plex-media-server | Implemented | 12/14 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13 | **Plex (descartado).** **No hay Plex y el dueno pidio explicitamente no probar nada contra Plex.** `media_server_client` = `none`, `media_server_host` vacio, y el media server corre deliberadamente fuera del stack. |
| 071 | tmdb-key-onboarding | Approved | 1/7 | 2 | **Un segundo usuario.** Vaciar la key de TMDB resulto seguro y reversible (se hizo dos veces, via tabla scratch, sin leerla nunca). Lo unico que falta es un no-admin que mire el panel. |
| 070 | subtitle-format-selection | Approved | 8/11 | 3, 4, 5, 6, 7, 8, 9, 10 | **Una corrida de pipeline.** AC-3/4/5 son `updateSettings` desde una sesion admin; AC-6-AC-10 piden inspeccionar las pistas de un MKV producido por un encode que nunca corrio. |
| 069 | title-refresh | Implemented | 8/14 | 2, 4, 5, 5b, 5c, 6, 7, 11 | **Un media server configurado.** Tres blockers: un media server configurado (`media_server_client` = `none`, y no hay Plex), una sesion, y titulos con datos de catalogo que cambien. |
| 068 | season-multi-file-upload | Approved | 6/12 | 2, 3, 4, 5, 6, 8 | **Archivos de video locales.** El upload tus es la unica ruta REST del proyecto: no hay equivalente CLI ni GraphQL, y hacen falta varios archivos de episodio reales. |
| 067 | title-removal | Implemented | 16/17 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17 | **Una corrida de pipeline.** AC-1-AC-8 y AC-13 estaban marcadas *unit tests only* y la marca es correcta. Necesitan borrar titulos reales con cosas en vuelo; AC-2/7/12/17 ademas un segundo dueno. |
| 066 | https-local-ca | Approved | 10/12 | 1, 2, 4, 4b, 6, 7, 8, 9, 11, 10 | **Una instalacion fresca.** Mucho mas verificable de lo que parecia: AC-3/AC-5 y el grueso de AC-11 ya quedaron cerrados con `openssl`. De las que faltan, AC-1/AC-10 necesitan un `install.sh` fresco, AC-2/AC-4/AC-7/AC-8/AC-9 un browser (el candado, el warning, el CA instalado por dispositivo). |
| 065 | pipeline-error-resume | Implemented | 13/13 | 1, 2, 3, 4, 5, 6, 7, 8, 8b, 9, 10, 11, 12 | **Una corrida de pipeline.** Las doce arrancan de una falla fabricada sobre un pipeline vivo. La feature es "reanudar desde la etapa que fallo": sin nada corrido, no hay nada que reanudar. AC-11 es un curl con token de usuario. |
| 064 | global-downloads-page | Approved | 10/13 | 1, 2, 3, 4, 5, 6, 7, 8, 10, 11 | **Fuentes en vuelo, y un segundo usuario.** AC-7/AC-8 necesitan un usuario B; el resto necesita descargas reales — la spec misma dice que escribirlas a mano produce filas que leen como errores en vez del escenario. |
| 063 | downloads-panel-filters | Approved | 8/10 | 1, 2, 3, 4, 5, 6, 7, 8 | **Fuentes en vuelo.** AC-1 pide un film con cuatro sources en cuatro estados y AC-6/AC-8 un season pack; hoy hay un solo `media_sources`, huerfano. |
| 062 | release-calendar | Implemented | 4/14 | 6, 9, 10, 11 | **Tres cosas distintas, ninguna la sesion.** AC-6 un segundo usuario; AC-9 un token de usuario logueado; AC-11 un browser al que se le pueda fijar el timezone. **AC-10 se corrio y no se cumple**: con `api` caido `/calendar` no renderiza ni la grilla ni la navegacion, y el error sale en ingles con locale `es`. |
| 061 | admin-password-off-env | Approved | 10/10 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 | **Una instalacion fresca.** Nueve de diez son sobre el instalador y `reset-password`, y correrlas significa **fijar una credencial real** en app + qBittorrent + Prowlarr. Este checkout es pre-061 (su `.env` todavia trae las tres variables), asi que es el sujeto de AC-8, no de AC-1. |
| 060 | duplicate-torrent-add | Implemented | 7/9 | 1, 2, 3, 4, 5, 6, 7 | **Una corrida de pipeline.** Las siete necesitan un torrent vivo mas un pre-estado especifico que solo produce una adquisicion real. |
| 058 | compression-resolution | Implemented | 11/15 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13 | **Una corrida de pipeline.** Diez de once piden `ffprobe` sobre un output encodeado real, a cinco techos de resolucion distintos y sobre H264/HEVC/AV1/DV/MPEG-2. AC-13 ya quedo probado estructuralmente (no existe la columna). |
| 054 | interrupted-encode-recovery | Implemented | 2/9 | 4, 5 | **Una corrida de pipeline.** Las dos necesitan un encode vivo para interrumpir. Cubiertas a nivel unitario (`cancellation.spec.ts`). |
| 052 | deselected-torrent-files | Approved | 6/8 | 1, 2, 3, 4, 5, 6 | **Una corrida de pipeline.** Las seis necesitan un torrent real en qBittorrent con archivos deseleccionados a mano: el bug depende de un archivo con su tamano anunciado y cero bytes. |
| 049 | published-images-install | Implemented | 3/13 | 5, 9, 12 | **Una instalacion fresca.** AC-5 necesita pipeline completo sobre un install de imagenes publicadas; AC-9/AC-12 un `install.sh` fresco en un directorio vacio. |
| 042 | encode-global-language-preferences | Implemented | 1/7 | 7 | **Un segundo usuario.** AC-7 lee `movie(id:)` como usuario A: hace falta un segundo usuario *y* una sesion. La tabla `users` tiene una sola fila. |
| 039 | per-title-language-split | Implemented | 2/14 | 5, 6 | **Un token de usuario logueado.** Solo quedan AC-5 y AC-6, dos curls con un tag desconocido y un tag duplicado. La UI no los puede producir, y la cookie de sesion es `httpOnly` y de `localhost:3000`, asi que no se replica contra `localhost:4000`. |
| 038 | encode-report-durability | Approved | 10/11 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 | **Una corrida de pipeline.** Diez de once son observaciones de un encode en vuelo al que hay que romperle algo a proposito. AC-4 ya tiene 2 de 3 clausulas medidas; falta contar lineas de log de una corrida real. |
| 037 | indexer-result-loss | Implemented | 1/8 | 3 | **Un token de usuario logueado.** AC-3 es una medicion de latencia: necesita el bearer de un usuario logueado. Prowlarr ya tiene 2 indexers habilitados, el indexer no es el blocker. |
| 036 | torrent-ranking-heuristic | Implemented | 3/39 | 4e, 6, 18 | **Sujetos que el indexer no devuelve.** AC-4e necesita una lista de puros CAM, AC-6 una de puros AV1/VP9 y AC-18 un release de episodio que nombre SPA. El modal corre entero y el ranking responde; lo que falta es material. |
| 032 | optional-compression | Implemented | 2/9 | 6, 8 | **Una corrida de pipeline.** AC-6 tiene su mitad de path-building probada en 24 casos unitarios; falta que llegue un archivo real. AC-8 es leer una columna despues de un encode. |
| 023 | ffprobe-log | Implemented | 4/10 | 1, 4, 5, 7 | **Una corrida de pipeline.** AC-1/4/5 necesitan un encode (la tabla `ffprobe_logs` nunca tuvo una fila aca). AC-7 necesita un segundo usuario. |
| 015 | reproducible-image-builds | Implemented | 2/10 | 7, 8 | **Una instalacion fresca.** Las dos necesitan el stack levantado con `bin/prod` (reemplaza el dev que esta corriendo) y despues login. |
| 013 | season-pack-processing | Implemented | 6/11 | 3, 4, 5, 6, 6b, 7 | **Una corrida de pipeline.** Necesita un season pack multi-episodio real: el fan-out a un `ProcessJob` por episodio no se puede fixturear. |
| 012 | post-download-processing | Implemented | 7/15 | 1, 2, 8, 9, 10, 11, 12 | **Una corrida de pipeline.** Siete ACs sobre lo que pasa despues de la descarga — scan, encode, destino — y ninguno se observa sin un release que termine de bajar y pase por el worker. |
| 007 | library-listing | Implemented | 1/13 | 12 | **Una biblioteca vacia.** Solo AC-12. Lo barato es un segundo usuario — `/shows` es per-user, asi que su biblioteca esta vacia por construccion — y eso mismo destraba 064 AC-7/AC-8 y 071 AC-2. |
| 002 | auth-login | Implemented | 1/13 | 9 | **Una corrida de pipeline.** AC-9 es una corrida completa (magnet -> descarga -> encode) con el guard puesto. `process_jobs` = 0 filas. |
<!-- pending-acs:end specs -->

## Por blocker

<!-- pending-acs:begin blockers -->
Los 244 ACs pendientes no son 244 problemas distintos. Se reducen a 21 destrabes, y los dos primeros se llevan el 52%:

| blocker | ACs | specs |
| :-- | --: | :-- |
| Una corrida de pipeline | 102 | 002, 012, 013, 023, 032, 038, 052, 054, 058, 060, 065, 067, 070, 087, 091 |
| Una instalacion fresca | 25 | 015, 049, 061, 066 |
| Adquisiciones reales | 18 | 073, 076 |
| Nada: no esta implementada | 17 | 081 |
| Plex (descartado) | 12 | 072 |
| Fuentes en vuelo, y un segundo usuario | 10 | 064 |
| Un browser que registre service workers | 9 | 080 |
| Fuentes en vuelo | 8 | 063 |
| Un media server configurado | 8 | 069 |
| Archivos de video locales | 6 | 068 |
| Un host arm64 / GHCR | 5 | 083 |
| Tres cosas distintas, ninguna la sesion | 4 | 062 |
| Un segundo usuario, y decisiones del duenio | 4 | 078 |
| Sujetos que el indexer no devuelve | 3 | 036 |
| Un token de usuario logueado | 3 | 037, 039 |
| La UI de GitHub | 3 | 085 |
| Un segundo usuario | 2 | 042, 071 |
| Dos peliculas que esta biblioteca no tiene | 2 | 075 |
| Una biblioteca vacia | 1 | 007 |
| Un problema de disenio, no una medicion | 1 | 077 |
| Un dispositivo real | 1 | 079 |
<!-- pending-acs:end blockers -->

## El grupo barato

Cinco criterios no necesitan ni browser ni pipeline — solo el bearer de **un usuario logueado**,
porque las operaciones que tocan no llevan `@AllowService()` y el `SERVICE_TOKEN` de la instalacion
es rechazado en `JwtAuthGuard` con `error.auth.unauthenticated` (las cinco fueron intentadas con el
token de maquina en la pasada del 2026-10-09 y correctamente refutadas):

| AC | Que mide |
| :-- | :-- |
| 037 AC-3 | `searchTorrents` para la query reportada responde en menos de 2 s |
| 039 AC-5 | `setMoviePreferredTrackLanguages` guarda y vuelve a leer |
| 039 AC-6 | `setShowPreferredTrackLanguages`, idem |
| 062 AC-9 | `calendar(from, to)` con un rango invertido devuelve el error esperado |
| 065 AC-11 | un usuario no puede fingir un `sourceScanFailed` |

Cinco ACs, cinco curls, cero setup mas alla del login.

## Orden sugerido

1. **Una sesion admin** — destraba ~60 ACs por si sola y es precondicion de casi todo lo demas.
2. **074 + 075** (20 ACs) — fixture de DB mas el boton "Ejecutar ahora". Lo mas barato por AC de
   todo el backlog una vez que hay sesion.
3. **El grupo barato de arriba** (5 ACs, cinco curls).
4. **Una corrida de pipeline completa** — el item de mayor palanca: 102 ACs en 15 specs esperan
   que exista *un* encode terminado en esta instalacion.
5. **077 + 080 + 007** (21 ACs) — browser puro, sin pipeline, sin segundo usuario.
6. **Un segundo usuario** — 042, y las mitades de 023, 064, 067, 071.
7. **Una instalacion fresca** (`install.sh` / `bin/prod`) — 015, 049, 061, 066.
8. Lo que no se puede cerrar aca: **072** (no hay Plex, y el dueno pidio no probarlo), **085** (UI de
   GitHub), **079 AC-6** (un telefono real), **083** (un host arm64), **081** (no implementada).
