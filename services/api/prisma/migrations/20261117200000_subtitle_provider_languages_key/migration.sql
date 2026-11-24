-- Spec 121, REQ-7
DELETE FROM `settings`
WHERE `key` = 'subtitle_provider_languages'
  AND EXISTS (SELECT 1 FROM (SELECT `id` FROM `settings` WHERE `key` = 'subtitle_provider_routes') AS old_row);

UPDATE `settings` SET `key` = 'subtitle_provider_languages' WHERE `key` = 'subtitle_provider_routes';
