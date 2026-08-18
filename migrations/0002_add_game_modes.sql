ALTER TABLE help_requests
ADD COLUMN game_mode INTEGER NOT NULL DEFAULT 2 CHECK (game_mode IN (0, 1, 2));

ALTER TABLE raid_groups
ADD COLUMN game_mode INTEGER NOT NULL DEFAULT 2 CHECK (game_mode IN (0, 1, 2));

DROP INDEX help_requests_one_active_map_per_twitch;
CREATE UNIQUE INDEX help_requests_one_active_mode_map_per_twitch
  ON help_requests (twitch_login, game_mode, map_id) WHERE state IN (0, 1);

CREATE INDEX help_requests_mode_queue_order_idx
  ON help_requests (game_mode, is_priority DESC, id) WHERE state IN (0, 1);

DROP INDEX raid_groups_compatible_idx;
CREATE INDEX raid_groups_compatible_mode_idx
  ON raid_groups (is_priority, game_mode, map_id, sort_key)
  WHERE state = 0 AND automatic_fill = 1
    AND current_member_count < requester_capacity;

CREATE INDEX raid_groups_outstanding_mode_idx
  ON raid_groups (is_priority, game_mode, sort_key) WHERE state IN (0, 1);

CREATE TRIGGER raid_group_members_compatibility_insert
BEFORE INSERT ON raid_group_members
WHEN NEW.state = 0 AND NOT EXISTS (
  SELECT 1
  FROM help_requests AS request
  JOIN raid_groups AS raid ON raid.id = NEW.group_id
  WHERE request.id = NEW.request_id
    AND request.game_mode = raid.game_mode
    AND request.map_id = raid.map_id
    AND request.is_priority = raid.is_priority
)
BEGIN
  SELECT RAISE(ABORT, 'raid group membership is incompatible');
END;

CREATE TRIGGER raid_group_members_compatibility_update
BEFORE UPDATE OF group_id, request_id, state ON raid_group_members
WHEN NEW.state = 0
  AND (OLD.state <> 0 OR OLD.group_id <> NEW.group_id OR OLD.request_id <> NEW.request_id)
  AND NOT EXISTS (
    SELECT 1
    FROM help_requests AS request
    JOIN raid_groups AS raid ON raid.id = NEW.group_id
    WHERE request.id = NEW.request_id
      AND request.game_mode = raid.game_mode
      AND request.map_id = raid.map_id
      AND request.is_priority = raid.is_priority
  )
BEGIN
  SELECT RAISE(ABORT, 'raid group membership is incompatible');
END;
