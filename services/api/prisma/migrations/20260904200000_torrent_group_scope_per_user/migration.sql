-- Moves TorrentGroupScope from torrent_groups to user_torrent_groups (044-settings-screen-polish).
--
-- Statement order is hand-picked and must not be re-sorted by tooling: the primary key on
-- user_torrent_groups has to widen to (userId, torrentGroupId, scope) *before* duplicate catalog
-- rows are repointed onto their surviving row (step 5), or a user who picked the same group name in
-- both scopes hits a duplicate-key error under the old two-column key and the migration aborts
-- mid-way on a populated database. See ../../../../docs/spec/features/044-settings-screen-polish/plan.md
-- § Migrations for the full rationale.

-- 1. Add the new column, nullable for now so the backfill below can populate it.
ALTER TABLE `user_torrent_groups` ADD COLUMN `scope` ENUM('MOVIE', 'SHOW') NULL;

-- 2. Backfill every existing selection from the scope its group used to carry. The FK guarantees
--    the join always finds a partner. In practice this table is empty on every installation today.
UPDATE `user_torrent_groups` utg
JOIN `torrent_groups` tg ON tg.id = utg.torrentGroupId
SET utg.scope = tg.scope;

-- 3. The backfill above covers every row, so the column can now be required.
ALTER TABLE `user_torrent_groups` MODIFY `scope` ENUM('MOVIE', 'SHOW') NOT NULL;

-- 4. Widen the primary key. This must happen before step 5 — see header comment.
ALTER TABLE `user_torrent_groups` DROP PRIMARY KEY, ADD PRIMARY KEY (`userId`, `torrentGroupId`, `scope`);

-- 5. Repoint every selection at the surviving row for its group name (the lowest id among
--    duplicates). Safe now that the widened key lets "same group, two scopes" coexist as two rows.
UPDATE `user_torrent_groups` utg
JOIN `torrent_groups` tg ON tg.id = utg.torrentGroupId
JOIN (SELECT name, MIN(id) AS keep_id FROM `torrent_groups` GROUP BY name) k ON k.name = tg.name
SET utg.torrentGroupId = k.keep_id;

-- 6. Delete the now-unreferenced losing catalog rows.
DELETE tg FROM `torrent_groups` tg
JOIN (SELECT name, MIN(id) AS keep_id FROM `torrent_groups` GROUP BY name) k ON k.name = tg.name
WHERE tg.id <> k.keep_id;

-- 7. The catalog is scope-free from here on: drop the old composite unique index and the column,
--    and make the name alone unique.
ALTER TABLE `torrent_groups`
    DROP INDEX `torrent_groups_name_scope_key`,
    DROP COLUMN `scope`,
    ADD UNIQUE INDEX `torrent_groups_name_key` (`name`);
