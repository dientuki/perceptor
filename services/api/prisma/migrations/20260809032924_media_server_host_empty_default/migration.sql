-- El seed viejo dejaba media_server_host='localhost': parece un valor válido
-- pero adentro del container api resuelve al propio api, no a la PC del
-- usuario — es justo la confusión que motivó este cambio (ver
-- MediaServerFields.tsx). Se vacía SÓLO el default exacto que nadie tocó; un
-- host custom queda como está.
UPDATE settings SET value = ''
WHERE `key` = 'media_server_host' AND value = 'localhost';
