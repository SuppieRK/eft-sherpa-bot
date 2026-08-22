DROP TRIGGER raid_group_follow_ups_close_cleanup;

CREATE TRIGGER raid_group_follow_ups_close_cleanup
AFTER UPDATE OF state ON raid_groups
WHEN OLD.state IN (0, 1) AND NEW.state NOT IN (0, 1)
BEGIN
  DELETE FROM raid_group_follow_ups
  WHERE source_group_id = NEW.id;
END;
