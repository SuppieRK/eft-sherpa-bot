CREATE TABLE staff_statistics_summary (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  submitted_requests INTEGER NOT NULL CHECK (submitted_requests >= 0),
  helped_requests INTEGER NOT NULL CHECK (helped_requests >= 0),
  open_requests INTEGER NOT NULL CHECK (open_requests >= 0),
  canceled_requests INTEGER NOT NULL CHECK (canceled_requests >= 0),
  successful_raids INTEGER NOT NULL CHECK (successful_raids >= 0),
  credited_leader_count INTEGER NOT NULL CHECK (credited_leader_count >= 0)
) WITHOUT ROWID;

CREATE TABLE staff_leader_statistics (
  discord_user_id TEXT PRIMARY KEY,
  helped_requests INTEGER NOT NULL CHECK (helped_requests >= 0),
  successful_raids INTEGER NOT NULL CHECK (successful_raids >= 0),
  CHECK (helped_requests > 0 OR successful_raids > 0)
) WITHOUT ROWID;

CREATE INDEX staff_leader_statistics_rank_idx
  ON staff_leader_statistics (helped_requests DESC, successful_raids DESC, discord_user_id);

INSERT INTO staff_statistics_summary
  (singleton, submitted_requests, helped_requests, open_requests, canceled_requests,
   successful_raids, credited_leader_count)
SELECT 1,
       count(*),
       coalesce(sum(state = 2), 0),
       coalesce(sum(state IN (0, 1)), 0),
       coalesce(sum(state = 3), 0),
       (SELECT count(*) FROM raid_groups WHERE state = 2 AND outcome = 0),
       0
FROM help_requests;

INSERT INTO staff_leader_statistics
  (discord_user_id, helped_requests, successful_raids)
SELECT raid.leader_discord_user_id,
       count(member.id),
       count(DISTINCT raid.id)
FROM raid_groups AS raid
JOIN raid_group_members AS member
  ON member.group_id = raid.id AND member.state = 1
WHERE raid.state = 2 AND raid.outcome = 0
  AND raid.leader_discord_user_id IS NOT NULL
GROUP BY raid.leader_discord_user_id;

UPDATE staff_statistics_summary
SET credited_leader_count = (SELECT count(*) FROM staff_leader_statistics)
WHERE singleton = 1;

CREATE TRIGGER staff_statistics_leader_insert
AFTER INSERT ON staff_leader_statistics
BEGIN
  UPDATE staff_statistics_summary
  SET credited_leader_count = credited_leader_count + 1
  WHERE singleton = 1;
END;

CREATE TRIGGER staff_statistics_leader_delete
AFTER DELETE ON staff_leader_statistics
BEGIN
  UPDATE staff_statistics_summary
  SET credited_leader_count = credited_leader_count - 1
  WHERE singleton = 1;
END;

CREATE TRIGGER staff_statistics_request_insert
AFTER INSERT ON help_requests
BEGIN
  UPDATE staff_statistics_summary
  SET submitted_requests = submitted_requests + 1,
      helped_requests = helped_requests + (NEW.state = 2),
      open_requests = open_requests + (NEW.state IN (0, 1)),
      canceled_requests = canceled_requests + (NEW.state = 3)
  WHERE singleton = 1;
END;

CREATE TRIGGER staff_statistics_request_delete
AFTER DELETE ON help_requests
BEGIN
  UPDATE staff_statistics_summary
  SET submitted_requests = submitted_requests - 1,
      helped_requests = helped_requests - (OLD.state = 2),
      open_requests = open_requests - (OLD.state IN (0, 1)),
      canceled_requests = canceled_requests - (OLD.state = 3)
  WHERE singleton = 1;
END;

CREATE TRIGGER staff_statistics_request_state_update
AFTER UPDATE OF state ON help_requests
WHEN OLD.state <> NEW.state
BEGIN
  UPDATE staff_statistics_summary
  SET helped_requests = helped_requests - (OLD.state = 2) + (NEW.state = 2),
      open_requests = open_requests - (OLD.state IN (0, 1)) + (NEW.state IN (0, 1)),
      canceled_requests = canceled_requests - (OLD.state = 3) + (NEW.state = 3)
  WHERE singleton = 1;
END;

CREATE TRIGGER staff_statistics_raid_success_insert
AFTER INSERT ON raid_groups
WHEN NEW.state = 2 AND NEW.outcome = 0
BEGIN
  UPDATE staff_statistics_summary
  SET successful_raids = successful_raids + 1
  WHERE singleton = 1;

  INSERT INTO staff_leader_statistics
    (discord_user_id, helped_requests, successful_raids)
  SELECT NEW.leader_discord_user_id,
         (SELECT count(*) FROM raid_group_members WHERE group_id = NEW.id AND state = 1),
         1
  WHERE NEW.leader_discord_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = NEW.id AND state = 1
    )
  ON CONFLICT(discord_user_id) DO UPDATE SET
    helped_requests = helped_requests + excluded.helped_requests,
    successful_raids = successful_raids + 1;
END;

CREATE TRIGGER staff_statistics_raid_success_delete
BEFORE DELETE ON raid_groups
WHEN OLD.state = 2 AND OLD.outcome = 0
BEGIN
  UPDATE staff_statistics_summary
  SET successful_raids = successful_raids - 1
  WHERE singleton = 1;

  DELETE FROM staff_leader_statistics
  WHERE discord_user_id = OLD.leader_discord_user_id
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = OLD.id AND state = 1
    )
    AND helped_requests =
      (SELECT count(*) FROM raid_group_members WHERE group_id = OLD.id AND state = 1)
    AND successful_raids = 1;

  UPDATE staff_leader_statistics
  SET helped_requests = helped_requests -
        (SELECT count(*) FROM raid_group_members WHERE group_id = OLD.id AND state = 1),
      successful_raids = successful_raids - 1
  WHERE discord_user_id = OLD.leader_discord_user_id
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = OLD.id AND state = 1
    );
END;

CREATE TRIGGER staff_statistics_raid_success_enter
AFTER UPDATE OF state, outcome ON raid_groups
WHEN NEW.state = 2 AND NEW.outcome = 0
  AND NOT (OLD.state = 2 AND OLD.outcome = 0)
BEGIN
  UPDATE staff_statistics_summary
  SET successful_raids = successful_raids + 1
  WHERE singleton = 1;

  INSERT INTO staff_leader_statistics
    (discord_user_id, helped_requests, successful_raids)
  SELECT NEW.leader_discord_user_id,
         (SELECT count(*) FROM raid_group_members WHERE group_id = NEW.id AND state = 1),
         1
  WHERE NEW.leader_discord_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = NEW.id AND state = 1
    )
  ON CONFLICT(discord_user_id) DO UPDATE SET
    helped_requests = helped_requests + excluded.helped_requests,
    successful_raids = successful_raids + 1;
END;

CREATE TRIGGER staff_statistics_raid_success_leave
AFTER UPDATE OF state, outcome ON raid_groups
WHEN OLD.state = 2 AND OLD.outcome = 0
  AND NOT (NEW.state = 2 AND NEW.outcome = 0)
BEGIN
  UPDATE staff_statistics_summary
  SET successful_raids = successful_raids - 1
  WHERE singleton = 1;

  DELETE FROM staff_leader_statistics
  WHERE discord_user_id = OLD.leader_discord_user_id
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = OLD.id AND state = 1
    )
    AND helped_requests =
      (SELECT count(*) FROM raid_group_members WHERE group_id = OLD.id AND state = 1)
    AND successful_raids = 1;

  UPDATE staff_leader_statistics
  SET helped_requests = helped_requests -
        (SELECT count(*) FROM raid_group_members WHERE group_id = OLD.id AND state = 1),
      successful_raids = successful_raids - 1
  WHERE discord_user_id = OLD.leader_discord_user_id
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = OLD.id AND state = 1
    );
END;

CREATE TRIGGER staff_statistics_raid_success_reassign
AFTER UPDATE OF leader_discord_user_id ON raid_groups
WHEN OLD.state = 2 AND OLD.outcome = 0
  AND NEW.state = 2 AND NEW.outcome = 0
  AND OLD.leader_discord_user_id IS NOT NEW.leader_discord_user_id
BEGIN
  DELETE FROM staff_leader_statistics
  WHERE discord_user_id = OLD.leader_discord_user_id
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = OLD.id AND state = 1
    )
    AND helped_requests =
      (SELECT count(*) FROM raid_group_members WHERE group_id = OLD.id AND state = 1)
    AND successful_raids = 1;

  UPDATE staff_leader_statistics
  SET helped_requests = helped_requests -
        (SELECT count(*) FROM raid_group_members WHERE group_id = OLD.id AND state = 1),
      successful_raids = successful_raids - 1
  WHERE discord_user_id = OLD.leader_discord_user_id
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = OLD.id AND state = 1
    );

  INSERT INTO staff_leader_statistics
    (discord_user_id, helped_requests, successful_raids)
  SELECT NEW.leader_discord_user_id,
         (SELECT count(*) FROM raid_group_members WHERE group_id = NEW.id AND state = 1),
         1
  WHERE NEW.leader_discord_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = NEW.id AND state = 1
    )
  ON CONFLICT(discord_user_id) DO UPDATE SET
    helped_requests = helped_requests + excluded.helped_requests,
    successful_raids = successful_raids + 1;
END;

CREATE TRIGGER staff_statistics_member_completed_insert
AFTER INSERT ON raid_group_members
WHEN NEW.state = 1
  AND EXISTS (
    SELECT 1 FROM raid_groups
    WHERE id = NEW.group_id AND state = 2 AND outcome = 0
      AND leader_discord_user_id IS NOT NULL
  )
BEGIN
  INSERT INTO staff_leader_statistics
    (discord_user_id, helped_requests, successful_raids)
  SELECT leader_discord_user_id, 1,
         ((SELECT count(*) FROM raid_group_members
           WHERE group_id = NEW.group_id AND state = 1) = 1)
  FROM raid_groups
  WHERE id = NEW.group_id
  ON CONFLICT(discord_user_id) DO UPDATE SET
    helped_requests = helped_requests + 1,
    successful_raids = successful_raids + excluded.successful_raids;
END;

CREATE TRIGGER staff_statistics_member_completed_delete
AFTER DELETE ON raid_group_members
WHEN OLD.state = 1
  AND EXISTS (
    SELECT 1 FROM raid_groups
    WHERE id = OLD.group_id AND state = 2 AND outcome = 0
      AND leader_discord_user_id IS NOT NULL
  )
BEGIN
  DELETE FROM staff_leader_statistics
  WHERE discord_user_id = (
      SELECT leader_discord_user_id FROM raid_groups WHERE id = OLD.group_id
    )
    AND helped_requests = 1 AND successful_raids = 1
    AND NOT EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = OLD.group_id AND state = 1
    );

  UPDATE staff_leader_statistics
  SET helped_requests = helped_requests - 1,
      successful_raids = successful_raids - (NOT EXISTS (
        SELECT 1 FROM raid_group_members WHERE group_id = OLD.group_id AND state = 1
      ))
  WHERE discord_user_id = (
    SELECT leader_discord_user_id FROM raid_groups WHERE id = OLD.group_id
  );
END;

CREATE TRIGGER staff_statistics_member_completed_update
AFTER UPDATE OF group_id, state ON raid_group_members
WHEN OLD.group_id <> NEW.group_id OR OLD.state <> NEW.state
BEGIN
  DELETE FROM staff_leader_statistics
  WHERE OLD.state = 1
    AND discord_user_id = (
      SELECT leader_discord_user_id FROM raid_groups
      WHERE id = OLD.group_id AND state = 2 AND outcome = 0
    )
    AND helped_requests = 1 AND successful_raids = 1
    AND NOT EXISTS (
      SELECT 1 FROM raid_group_members WHERE group_id = OLD.group_id AND state = 1
    );

  UPDATE staff_leader_statistics
  SET helped_requests = helped_requests - 1,
      successful_raids = successful_raids - (NOT EXISTS (
        SELECT 1 FROM raid_group_members WHERE group_id = OLD.group_id AND state = 1
      ))
  WHERE OLD.state = 1
    AND discord_user_id = (
      SELECT leader_discord_user_id FROM raid_groups
      WHERE id = OLD.group_id AND state = 2 AND outcome = 0
    );

  INSERT INTO staff_leader_statistics
    (discord_user_id, helped_requests, successful_raids)
  SELECT leader_discord_user_id, 1,
         ((SELECT count(*) FROM raid_group_members
           WHERE group_id = NEW.group_id AND state = 1) = 1)
  FROM raid_groups
  WHERE NEW.state = 1 AND id = NEW.group_id AND state = 2 AND outcome = 0
    AND leader_discord_user_id IS NOT NULL
  ON CONFLICT(discord_user_id) DO UPDATE SET
    helped_requests = helped_requests + 1,
    successful_raids = successful_raids + excluded.successful_raids;
END;
