PRAGMA foreign_keys = ON;

-- Finite states use compact integer codes. The repository maps them to domain names.
CREATE TABLE event_receipts (
  platform INTEGER NOT NULL CHECK (platform IN (0, 1)), -- 0 Discord, 1 Twitch
  delivery_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  twitch_reply_text TEXT,
  twitch_reply_to_message_id TEXT,
  reply_status INTEGER CHECK (reply_status IN (0, 1, 2)), -- pending, sent, failed
  reply_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reply_attempts >= 0),
  platform_message_id TEXT,
  last_error_code TEXT,
  PRIMARY KEY (platform, delivery_id)
) WITHOUT ROWID;

CREATE TABLE user_mappings (
  twitch_login TEXT PRIMARY KEY
    CHECK (twitch_login = lower(trim(twitch_login)) AND length(twitch_login) > 0),
  twitch_user_id TEXT UNIQUE,
  discord_user_id TEXT UNIQUE,
  discord_display_name TEXT,
  in_game_name TEXT CHECK (in_game_name IS NULL OR length(trim(in_game_name)) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE help_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_platform INTEGER NOT NULL CHECK (source_platform IN (0, 1)),
  source_delivery_id TEXT NOT NULL,
  discord_user_id TEXT,
  twitch_user_id TEXT,
  twitch_login TEXT NOT NULL REFERENCES user_mappings (twitch_login) ON UPDATE CASCADE,
  in_game_name TEXT NOT NULL CHECK (length(trim(in_game_name)) BETWEEN 1 AND 64),
  map_id TEXT NOT NULL CHECK (length(trim(map_id)) > 0),
  objective TEXT NOT NULL CHECK (length(trim(objective)) BETWEEN 1 AND 150),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) BETWEEN 1 AND 250),
  is_priority INTEGER NOT NULL DEFAULT 0 CHECK (is_priority IN (0, 1)),
  state INTEGER NOT NULL DEFAULT 0 CHECK (state IN (0, 1, 2, 3)), -- waiting..canceled
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (source_platform, source_delivery_id),
  CHECK (discord_user_id IS NOT NULL OR twitch_user_id IS NOT NULL)
);

CREATE TABLE raid_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  is_priority INTEGER NOT NULL DEFAULT 0 CHECK (is_priority IN (0, 1)),
  sort_key INTEGER NOT NULL CHECK (sort_key > 0),
  map_id TEXT NOT NULL,
  requester_capacity INTEGER NOT NULL CHECK (requester_capacity > 0),
  current_member_count INTEGER NOT NULL DEFAULT 0
    CHECK (current_member_count BETWEEN 0 AND requester_capacity),
  leader_discord_user_id TEXT,
  leader_type INTEGER CHECK (leader_type IN (0, 1)), -- streamer, volunteer
  automatic_fill INTEGER NOT NULL DEFAULT 1 CHECK (automatic_fill IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  state INTEGER NOT NULL DEFAULT 0 CHECK (state IN (0, 1, 2, 3)), -- planned..canceled
  outcome INTEGER CHECK (outcome IN (0, 1)), -- helped, not_run
  discord_call_status INTEGER NOT NULL DEFAULT 3 CHECK (discord_call_status IN (0, 1, 2, 3)),
  twitch_call_status INTEGER NOT NULL DEFAULT 3 CHECK (twitch_call_status IN (0, 1, 2, 3)),
  staff_message_id TEXT UNIQUE,
  last_action_key TEXT UNIQUE,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((leader_discord_user_id IS NULL) = (leader_type IS NULL)),
  CHECK (
    (map_id = 'icebreaker' AND requester_capacity <= 2) OR
    (
      map_id IN (
        'factory',
        'customs',
        'woods',
        'lighthouse',
        'shoreline',
        'reserve',
        'interchange',
        'streets-of-tarkov',
        'the-lab',
        'ground-zero',
        'terminal',
        'the-labyrinth'
      )
      AND requester_capacity <= 4
    )
  ),
  CHECK (
    (state IN (0, 1) AND outcome IS NULL AND completed_at IS NULL) OR
    (state IN (2, 3) AND outcome IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE raid_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES raid_groups (id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES help_requests (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  state INTEGER NOT NULL DEFAULT 0 CHECK (state IN (0, 1, 2)), -- planned, completed, removed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE community_state (
  community_id TEXT PRIMARY KEY CHECK (community_id = 'butcoffee'),
  staff_board_message_id TEXT,
  priority_open_raid_count INTEGER NOT NULL DEFAULT 0 CHECK (priority_open_raid_count >= 0),
  ordinary_open_raid_count INTEGER NOT NULL DEFAULT 0 CHECK (ordinary_open_raid_count >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX event_receipts_received_idx ON event_receipts (received_at);
CREATE INDEX help_requests_queue_order_idx
  ON help_requests (is_priority DESC, id) WHERE state IN (0, 1);
CREATE INDEX help_requests_waiting_order_idx
  ON help_requests (is_priority DESC, id) WHERE state = 0;
CREATE INDEX help_requests_twitch_login_idx
  ON help_requests (twitch_login, is_priority DESC, id) WHERE state IN (0, 1);
CREATE UNIQUE INDEX help_requests_one_active_map_per_twitch
  ON help_requests (twitch_login, map_id) WHERE state IN (0, 1);
CREATE INDEX raid_groups_outstanding_idx
  ON raid_groups (is_priority DESC, sort_key) WHERE state IN (0, 1);
CREATE UNIQUE INDEX raid_groups_open_sort_key_idx
  ON raid_groups (is_priority, sort_key) WHERE state IN (0, 1);
CREATE INDEX raid_groups_compatible_idx
  ON raid_groups (is_priority, map_id, sort_key)
  WHERE state = 0 AND automatic_fill = 1
    AND current_member_count < requester_capacity;
CREATE INDEX raid_group_members_group_idx
  ON raid_group_members (group_id, position);
CREATE UNIQUE INDEX raid_group_members_open_position_idx
  ON raid_group_members (group_id, position) WHERE state = 0;
CREATE UNIQUE INDEX raid_group_members_one_open_request_idx
  ON raid_group_members (request_id) WHERE state = 0;

CREATE TRIGGER raid_group_members_capacity_insert
BEFORE INSERT ON raid_group_members
WHEN NEW.state = 0 AND (
  SELECT count(*) FROM raid_group_members
  WHERE group_id = NEW.group_id AND state = 0
) >= (
  SELECT requester_capacity FROM raid_groups WHERE id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'raid group capacity exceeded');
END;

CREATE TRIGGER raid_group_members_capacity_update
BEFORE UPDATE OF group_id, state ON raid_group_members
WHEN NEW.state = 0 AND (OLD.state <> 0 OR OLD.group_id <> NEW.group_id) AND (
  SELECT count(*) FROM raid_group_members
  WHERE group_id = NEW.group_id AND state = 0 AND id <> OLD.id
) >= (
  SELECT requester_capacity FROM raid_groups WHERE id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'raid group capacity exceeded');
END;

CREATE TRIGGER raid_group_members_count_insert
AFTER INSERT ON raid_group_members
WHEN NEW.state = 0
BEGIN
  UPDATE raid_groups
  SET current_member_count = current_member_count + 1
  WHERE id = NEW.group_id;
END;

CREATE TRIGGER raid_group_members_count_delete
AFTER DELETE ON raid_group_members
WHEN OLD.state = 0
BEGIN
  UPDATE raid_groups
  SET current_member_count = current_member_count - 1
  WHERE id = OLD.group_id;
END;

CREATE TRIGGER raid_group_members_count_update
AFTER UPDATE OF group_id, state ON raid_group_members
BEGIN
  UPDATE raid_groups
  SET current_member_count = current_member_count - 1
  WHERE id = OLD.group_id
    AND OLD.state = 0
    AND (NEW.state <> 0 OR NEW.group_id <> OLD.group_id);

  UPDATE raid_groups
  SET current_member_count = current_member_count + 1
  WHERE id = NEW.group_id
    AND NEW.state = 0
    AND (OLD.state <> 0 OR NEW.group_id <> OLD.group_id);
END;

CREATE TRIGGER raid_groups_board_count_insert
AFTER INSERT ON raid_groups
WHEN NEW.state IN (0, 1)
BEGIN
  UPDATE community_state
  SET priority_open_raid_count = priority_open_raid_count + CASE NEW.is_priority WHEN 1 THEN 1 ELSE 0 END,
      ordinary_open_raid_count = ordinary_open_raid_count + CASE NEW.is_priority WHEN 0 THEN 1 ELSE 0 END
  WHERE community_id = 'butcoffee';
END;

CREATE TRIGGER raid_groups_board_count_delete
AFTER DELETE ON raid_groups
WHEN OLD.state IN (0, 1)
BEGIN
  UPDATE community_state
  SET priority_open_raid_count = priority_open_raid_count - CASE OLD.is_priority WHEN 1 THEN 1 ELSE 0 END,
      ordinary_open_raid_count = ordinary_open_raid_count - CASE OLD.is_priority WHEN 0 THEN 1 ELSE 0 END
  WHERE community_id = 'butcoffee';
END;

CREATE TRIGGER raid_groups_board_count_update
AFTER UPDATE OF is_priority, state ON raid_groups
WHEN OLD.is_priority <> NEW.is_priority
  OR (OLD.state IN (0, 1)) <> (NEW.state IN (0, 1))
BEGIN
  UPDATE community_state
  SET priority_open_raid_count = priority_open_raid_count
        - CASE WHEN OLD.state IN (0, 1) AND OLD.is_priority = 1 THEN 1 ELSE 0 END
        + CASE WHEN NEW.state IN (0, 1) AND NEW.is_priority = 1 THEN 1 ELSE 0 END,
      ordinary_open_raid_count = ordinary_open_raid_count
        - CASE WHEN OLD.state IN (0, 1) AND OLD.is_priority = 0 THEN 1 ELSE 0 END
        + CASE WHEN NEW.state IN (0, 1) AND NEW.is_priority = 0 THEN 1 ELSE 0 END
  WHERE community_id = 'butcoffee';
END;

CREATE TRIGGER community_state_board_count_backfill
AFTER INSERT ON community_state
BEGIN
  UPDATE community_state
  SET priority_open_raid_count = (
        SELECT count(*) FROM raid_groups WHERE is_priority = 1 AND state IN (0, 1)
      ),
      ordinary_open_raid_count = (
        SELECT count(*) FROM raid_groups WHERE is_priority = 0 AND state IN (0, 1)
      )
  WHERE community_id = NEW.community_id;
END;

INSERT INTO community_state (community_id, created_at, updated_at)
VALUES ('butcoffee', 0, 0);
