ALTER TABLE user_mappings
ADD COLUMN twitch_observed_at INTEGER NOT NULL DEFAULT 0
  CHECK (twitch_observed_at >= 0);

CREATE INDEX raid_group_members_removed_request_idx
ON raid_group_members(group_id, request_id, updated_at)
WHERE state = 2;

CREATE TABLE raid_group_follow_ups (
  source_group_id INTEGER NOT NULL REFERENCES raid_groups(id),
  target_group_id INTEGER NOT NULL REFERENCES raid_groups(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_group_id, target_group_id),
  CHECK (source_group_id <> target_group_id)
) WITHOUT ROWID;

INSERT OR IGNORE INTO raid_group_follow_ups
  (source_group_id, target_group_id, created_at, updated_at)
SELECT DISTINCT source_member.group_id, target_member.group_id,
       min(source_member.updated_at, target_member.created_at),
       max(source_member.updated_at, target_member.updated_at)
FROM raid_group_members AS source_member
JOIN raid_group_members AS target_member
  ON target_member.request_id = source_member.request_id
 AND target_member.state = 0
JOIN raid_groups AS target ON target.id = target_member.group_id AND target.state IN (0, 1)
JOIN raid_groups AS source ON source.id = source_member.group_id AND source.state IN (0, 1)
WHERE source_member.state = 2 AND source_member.group_id <> target_member.group_id;

CREATE TRIGGER raid_group_follow_ups_close_cleanup
AFTER UPDATE OF state ON raid_groups
WHEN OLD.state IN (0, 1) AND NEW.state NOT IN (0, 1)
BEGIN
  DELETE FROM raid_group_follow_ups
  WHERE source_group_id = NEW.id OR target_group_id = NEW.id;
END;
