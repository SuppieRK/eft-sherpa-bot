ALTER TABLE community_state
ADD COLUMN board_dirty_version INTEGER NOT NULL DEFAULT 0 CHECK (board_dirty_version >= 0);

ALTER TABLE community_state
ADD COLUMN board_rendered_version INTEGER NOT NULL DEFAULT 0 CHECK (board_rendered_version >= 0);

ALTER TABLE community_state
ADD COLUMN board_lease_until INTEGER NOT NULL DEFAULT 0 CHECK (board_lease_until >= 0);

ALTER TABLE community_state
ADD COLUMN board_lease_token TEXT;

ALTER TABLE community_state
ADD COLUMN stable_identity_repair_count INTEGER NOT NULL DEFAULT 0
  CHECK (stable_identity_repair_count >= 0);

ALTER TABLE event_receipts
ADD COLUMN discord_mutation_status INTEGER CHECK (discord_mutation_status IN (0, 1));

ALTER TABLE event_receipts
ADD COLUMN discord_claim_until INTEGER CHECK (discord_claim_until IS NULL OR discord_claim_until >= 0);

DROP INDEX help_requests_twitch_login_idx;

DROP INDEX raid_groups_outstanding_idx;

UPDATE community_state
SET stable_identity_repair_count = (
  SELECT count(*)
  FROM help_requests AS duplicate
  WHERE duplicate.state IN (0, 1)
    AND duplicate.twitch_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM help_requests AS retained
      WHERE retained.state IN (0, 1)
        AND retained.twitch_user_id = duplicate.twitch_user_id
        AND retained.game_mode = duplicate.game_mode
        AND retained.map_id = duplicate.map_id
        AND retained.id < duplicate.id
    )
)
WHERE community_id = 'butcoffee';

UPDATE raid_group_members
SET state = 2,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE state = 0
  AND request_id IN (
    SELECT duplicate.id
    FROM help_requests AS duplicate
    WHERE duplicate.state IN (0, 1)
      AND duplicate.twitch_user_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM help_requests AS retained
        WHERE retained.state IN (0, 1)
          AND retained.twitch_user_id = duplicate.twitch_user_id
          AND retained.game_mode = duplicate.game_mode
          AND retained.map_id = duplicate.map_id
          AND retained.id < duplicate.id
      )
  );

UPDATE help_requests AS duplicate
SET state = 3,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE duplicate.state IN (0, 1)
  AND duplicate.twitch_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM help_requests AS retained
    WHERE retained.state IN (0, 1)
      AND retained.twitch_user_id = duplicate.twitch_user_id
      AND retained.game_mode = duplicate.game_mode
      AND retained.map_id = duplicate.map_id
      AND retained.id < duplicate.id
  );

UPDATE raid_groups
SET state = 3,
    outcome = 1,
    completed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE state IN (0, 1) AND current_member_count = 0;

CREATE UNIQUE INDEX help_requests_one_active_mode_map_per_twitch_id
  ON help_requests (twitch_user_id, game_mode, map_id)
  WHERE state IN (0, 1) AND twitch_user_id IS NOT NULL;

CREATE INDEX raid_group_members_completed_position_idx
  ON raid_group_members (group_id, position) WHERE state = 1;
