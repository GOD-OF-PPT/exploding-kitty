CREATE TABLE IF NOT EXISTS room_events (
  room_id VARCHAR(128) NOT NULL,
  revision BIGINT NOT NULL,
  type VARCHAR(128) NOT NULL,
  actor_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY room_events_room_idx (room_id),
  CONSTRAINT room_events_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
