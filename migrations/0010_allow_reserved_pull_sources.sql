DROP INDEX raid_groups_pull_source_idx;

CREATE INDEX raid_groups_pull_source_idx
  ON raid_groups (is_priority, game_mode, map_id, sort_key)
  WHERE state = 0 AND staff_message_id IS NULL
    AND (automatic_fill = 1 OR leader_discord_user_id IS NOT NULL);
