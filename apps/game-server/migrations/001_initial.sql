CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NULL,
  avatar_url TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY users_provider_subject_unique (provider, provider_subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(128) NOT NULL,
  code VARCHAR(32) NOT NULL,
  owner_id VARCHAR(128) NOT NULL,
  status ENUM('LOBBY', 'ACTIVE', 'FINISHED') NOT NULL,
  tutorial TINYINT(1) NOT NULL DEFAULT 0,
  settings JSON NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  restart_votes JSON NOT NULL,
  match_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY rooms_code_unique (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS room_members (
  room_id VARCHAR(128) NOT NULL,
  player_id VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  avatar TEXT NULL,
  is_bot TINYINT(1) NOT NULL DEFAULT 0,
  ready TINYINT(1) NOT NULL DEFAULT 0,
  connected TINYINT(1) NOT NULL DEFAULT 0,
  seat INT NOT NULL,
  real_player_id VARCHAR(128)
    GENERATED ALWAYS AS (CASE WHEN is_bot = 0 THEN player_id ELSE NULL END) STORED,
  PRIMARY KEY (room_id, player_id),
  UNIQUE KEY room_members_room_seat_unique (room_id, seat),
  UNIQUE KEY room_members_real_player_unique_idx (real_player_id),
  KEY room_members_player_idx (player_id),
  CONSTRAINT room_members_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS matches (
  id VARCHAR(128) NOT NULL,
  room_id VARCHAR(128) NOT NULL,
  revision BIGINT NOT NULL,
  state JSON NOT NULL,
  card_tokens JSON NOT NULL,
  deadline_id VARCHAR(128) NULL,
  deadline_at DATETIME(3) NULL,
  deadline_lease_until DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY matches_due_deadline_idx (deadline_at),
  CONSTRAINT matches_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS command_receipts (
  match_id VARCHAR(128) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  command_id VARCHAR(128) NOT NULL,
  fingerprint TEXT NULL,
  receipt JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (match_id, actor_id, command_id),
  CONSTRAINT command_receipts_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS match_events (
  match_id VARCHAR(128) NOT NULL,
  sequence BIGINT NOT NULL,
  revision BIGINT NOT NULL,
  type VARCHAR(128) NOT NULL,
  actor_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (match_id, sequence),
  CONSTRAINT match_events_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS player_session_revisions (
  player_id VARCHAR(128) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  snapshot_cursor TEXT NOT NULL,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS session_command_receipts (
  actor_id VARCHAR(128) NOT NULL,
  command_id VARCHAR(128) NOT NULL,
  fingerprint TEXT NOT NULL,
  receipt JSON NOT NULL,
  snapshot JSON NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (actor_id, command_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
