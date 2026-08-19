CREATE TABLE IF NOT EXISTS room_command_receipts (
  room_id VARCHAR(128) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  command_id VARCHAR(128) NOT NULL,
  fingerprint TEXT NULL,
  receipt JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (room_id, actor_id, command_id),
  CONSTRAINT room_command_receipts_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
