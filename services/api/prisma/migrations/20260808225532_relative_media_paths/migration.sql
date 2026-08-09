-- path_movies/path_shows nunca los leyó ningún código hasta ahora: cualquier
-- valor absoluto ahí es basura sembrada (el seed viejo escribía
-- /media/destinations/movies|shows, que ni siquiera coincidía con el mount
-- real), se puede resetear sin perder nada real que el usuario haya configurado.
UPDATE settings SET value = 'Movies' WHERE `key` = 'path_movies' AND value LIKE '/%';
UPDATE settings SET value = 'Shows'  WHERE `key` = 'path_shows'  AND value LIKE '/%';

-- path_downloads SÍ está vivo (qBittorrent, uploads): sólo se reescribe el
-- default exacto que nadie configuró a mano. Un valor absoluto custom queda
-- absoluto -- la validación nueva de updateSettings lo rechaza ruidosamente
-- la próxima vez que se guarde desde Settings, en vez de que esta migración
-- adivine mal a qué segmento relativo equivalía.
UPDATE settings SET value = '.' WHERE `key` = 'path_downloads' AND value = '/media/downloads';
