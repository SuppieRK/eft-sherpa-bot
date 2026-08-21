DROP INDEX help_requests_queue_order_idx;

CREATE INDEX help_requests_waiting_mode_order_idx
  ON help_requests (is_priority DESC, game_mode, id) WHERE state = 0;

ALTER TABLE community_state
ADD COLUMN receipt_cleanup_after INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER raid_group_members_capacity_insert;

CREATE TRIGGER raid_group_members_capacity_insert
BEFORE INSERT ON raid_group_members
WHEN NEW.state = 0 AND EXISTS (
  SELECT 1 FROM raid_groups
  WHERE id = NEW.group_id AND current_member_count >= requester_capacity
)
BEGIN
  SELECT RAISE(ABORT, 'raid group capacity exceeded');
END;

DROP TRIGGER raid_group_members_capacity_update;

CREATE TRIGGER raid_group_members_capacity_update
BEFORE UPDATE OF group_id, state ON raid_group_members
WHEN NEW.state = 0 AND (OLD.state <> 0 OR OLD.group_id <> NEW.group_id) AND EXISTS (
  SELECT 1 FROM raid_groups
  WHERE id = NEW.group_id AND current_member_count >= requester_capacity
)
BEGIN
  SELECT RAISE(ABORT, 'raid group capacity exceeded');
END;

DROP TRIGGER raid_group_members_count_insert;

CREATE TRIGGER raid_group_members_count_insert
AFTER INSERT ON raid_group_members
WHEN NEW.state = 0
BEGIN
  UPDATE raid_groups
  SET current_member_count = current_member_count + 1
  WHERE id = NEW.group_id;

  UPDATE help_requests
  SET state = 1, updated_at = NEW.updated_at
  WHERE id = NEW.request_id AND state = 0;
END;

DROP TRIGGER staff_statistics_request_state_update;

CREATE TRIGGER staff_statistics_request_state_update
AFTER UPDATE OF state ON help_requests
WHEN (OLD.state = 2) <> (NEW.state = 2)
  OR (OLD.state IN (0, 1)) <> (NEW.state IN (0, 1))
  OR (OLD.state = 3) <> (NEW.state = 3)
BEGIN
  UPDATE staff_statistics_summary
  SET helped_requests = helped_requests - (OLD.state = 2) + (NEW.state = 2),
      open_requests = open_requests - (OLD.state IN (0, 1)) + (NEW.state IN (0, 1)),
      canceled_requests = canceled_requests - (OLD.state = 3) + (NEW.state = 3)
  WHERE singleton = 1;
END;
