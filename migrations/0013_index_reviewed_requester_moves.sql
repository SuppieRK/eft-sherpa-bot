-- Seek the next eligible destination without scanning full or reviewed raids.
CREATE INDEX raid_groups_move_destination_idx
  ON raid_groups (game_mode, map_id, service_key, id)
  WHERE state = 0 AND automatic_fill = 1 AND staff_message_id IS NULL
    AND current_member_count < requester_capacity;

-- Refresh existing review controls without calls or request-state changes.
UPDATE community_state SET board_dirty_version = board_dirty_version + 1,
  board_page_number = 1, board_page_direction = 0, board_page_lane = 0,
  board_page_key = 0, board_page_id = 0;
