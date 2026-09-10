-- A live source can outlast many completed follow-ups. Retain only live relations.
CREATE INDEX raid_group_follow_ups_target_idx
  ON raid_group_follow_ups (target_group_id, source_group_id);

DELETE FROM raid_group_follow_ups
WHERE EXISTS (
  SELECT 1 FROM raid_groups
  WHERE id = source_group_id AND state NOT IN (0, 1)
) OR EXISTS (
  SELECT 1 FROM raid_groups
  WHERE id = target_group_id AND state NOT IN (0, 1)
);

DROP TRIGGER raid_group_follow_ups_close_cleanup;
CREATE TRIGGER raid_group_follow_ups_close_cleanup
AFTER UPDATE OF state ON raid_groups
WHEN OLD.state IN (0, 1) AND NEW.state NOT IN (0, 1)
BEGIN
  DELETE FROM raid_group_follow_ups WHERE source_group_id = NEW.id;
  DELETE FROM raid_group_follow_ups WHERE target_group_id = NEW.id;
END;
