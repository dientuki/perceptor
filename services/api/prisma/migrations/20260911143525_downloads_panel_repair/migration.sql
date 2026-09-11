-- AlterTable
ALTER TABLE `process_jobs` ADD COLUMN `encodeSpeed` DOUBLE NULL;

-- Data migration (REQ-3): rewrite legacy uppercase infoHash rows lowercase.
-- Tolerates rows already lowercase; cannot collide, since the column's collation
-- is case-insensitive and unique, so two rows can never already differ only by case.
-- Note: the actual column is `infoHash` (camelCase, no @map on the field) — the
-- `info_hash` spelling in spec.md/plan.md/the task brief does not match the schema.
UPDATE `media_sources` SET `infoHash` = LOWER(`infoHash`) WHERE `infoHash` IS NOT NULL;
