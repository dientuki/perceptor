-- El seed viejo dejaba media_server_client='jellyfin' con api key vacía: un
-- default que no puede funcionar y que, ahora que el aviso está cableado,
-- dispararía un POST fallido a localhost:8096 por cada encode. Se baja a
-- 'none' SÓLO lo que nadie configuró (api key vacía) — una instalación con
-- Jellyfin de verdad configurado queda intacta.
UPDATE settings SET value = 'none'
WHERE `key` = 'media_server_client'
  AND value = 'jellyfin'
  AND EXISTS (
    SELECT 1 FROM (SELECT `key`, value FROM settings) AS s
    WHERE s.`key` = 'media_server_api_key' AND s.value = ''
  );
