-- Merge open queues without changing raid identities or their memberships.
CREATE TABLE migration_0012_raid_order (
  id INTEGER PRIMARY KEY,
  unified_sort_key INTEGER NOT NULL
);
INSERT INTO migration_0012_raid_order
SELECT id, row_number() OVER (ORDER BY is_priority DESC, sort_key, id) * 1000000
FROM raid_groups WHERE state IN (0, 1);

DROP INDEX raid_groups_open_sort_key_idx;
UPDATE raid_groups
SET sort_key = (SELECT unified_sort_key FROM migration_0012_raid_order WHERE id = raid_groups.id),
    is_priority = 0
WHERE state IN (0, 1);
UPDATE help_requests SET is_priority = 0 WHERE state IN (0, 1) AND is_priority <> 0;
DROP TABLE migration_0012_raid_order;
CREATE UNIQUE INDEX raid_groups_open_sort_key_idx
  ON raid_groups (sort_key) WHERE state IN (0, 1);

-- Legacy queue and attempt columns remain readable for retained history.
ALTER TABLE raid_groups ADD COLUMN manual_order INTEGER NOT NULL DEFAULT 0 CHECK (manual_order >= 0);
ALTER TABLE raid_groups ADD COLUMN service_lane INTEGER
  GENERATED ALWAYS AS (CASE state WHEN 1 THEN 0 ELSE 1 END) VIRTUAL;
ALTER TABLE raid_groups ADD COLUMN service_key INTEGER
  GENERATED ALWAYS AS (CASE WHEN state = 0 AND manual_order > 0 THEN -manual_order ELSE sort_key END) VIRTUAL;

CREATE INDEX raid_groups_service_order_idx
  ON raid_groups (service_lane, service_key, id) WHERE state IN (0, 1);
CREATE INDEX raid_groups_mode_service_order_idx
  ON raid_groups (game_mode, service_lane, service_key, id, current_member_count) WHERE state IN (0, 1);
CREATE INDEX raid_groups_mode_sort_order_idx
  ON raid_groups (game_mode, map_id, sort_key) WHERE state IN (0, 1);
DROP INDEX raid_groups_compatible_mode_idx;
CREATE INDEX raid_groups_compatible_mode_idx
  ON raid_groups (game_mode, map_id, sort_key)
  WHERE state = 0 AND automatic_fill = 1 AND current_member_count < requester_capacity;
DROP INDEX raid_groups_pull_source_idx;
CREATE INDEX raid_groups_pull_source_idx
  ON raid_groups (game_mode, map_id, service_key)
  WHERE state = 0 AND staff_message_id IS NULL
    AND (automatic_fill = 1 OR leader_discord_user_id IS NOT NULL);
-- Remove indexes used exclusively by the retired split queues.
DROP INDEX help_requests_waiting_order_idx;
DROP INDEX help_requests_waiting_mode_order_idx;
DROP INDEX help_requests_mode_queue_order_idx;
DROP INDEX raid_groups_outstanding_mode_idx;
CREATE INDEX help_requests_waiting_idx ON help_requests (id) WHERE state = 0;

DROP TRIGGER raid_group_members_compatibility_insert;
DROP TRIGGER raid_group_members_compatibility_update;
CREATE TRIGGER raid_group_members_compatibility_insert
BEFORE INSERT ON raid_group_members
WHEN NEW.state = 0 AND NOT EXISTS (
  SELECT 1 FROM help_requests AS request
  JOIN raid_groups AS raid ON raid.id = NEW.group_id
  WHERE request.id = NEW.request_id AND request.game_mode = raid.game_mode AND request.map_id = raid.map_id
)
BEGIN
  SELECT RAISE(ABORT, 'raid group membership is incompatible');
END;
CREATE TRIGGER raid_group_members_compatibility_update
BEFORE UPDATE OF group_id, request_id, state ON raid_group_members
WHEN NEW.state = 0
  AND (OLD.state <> 0 OR OLD.group_id <> NEW.group_id OR OLD.request_id <> NEW.request_id)
  AND NOT EXISTS (
    SELECT 1 FROM help_requests AS request
    JOIN raid_groups AS raid ON raid.id = NEW.group_id
    WHERE request.id = NEW.request_id AND request.game_mode = raid.game_mode AND request.map_id = raid.map_id
  )
BEGIN
  SELECT RAISE(ABORT, 'raid group membership is incompatible');
END;

ALTER TABLE community_state ADD COLUMN raid_count INTEGER
  GENERATED ALWAYS AS (priority_open_raid_count + ordinary_open_raid_count) VIRTUAL;
ALTER TABLE community_state ADD COLUMN board_page_number INTEGER NOT NULL DEFAULT 1 CHECK (board_page_number > 0);
ALTER TABLE community_state ADD COLUMN board_page_direction INTEGER NOT NULL DEFAULT 0 CHECK (board_page_direction IN (-1, 0, 1));
ALTER TABLE community_state ADD COLUMN board_page_lane INTEGER NOT NULL DEFAULT 0 CHECK (board_page_lane IN (0, 1));
ALTER TABLE community_state ADD COLUMN board_page_key INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_state ADD COLUMN board_page_id INTEGER NOT NULL DEFAULT 0 CHECK (board_page_id >= 0);
UPDATE community_state SET board_dirty_version = board_dirty_version + 1;
