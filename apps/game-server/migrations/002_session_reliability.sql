ALTER TABLE command_receipts ADD COLUMN IF NOT EXISTS fingerprint text;

CREATE TABLE IF NOT EXISTS player_session_revisions (
  player_id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0,
  snapshot_cursor text NOT NULL DEFAULT ''
);
ALTER TABLE player_session_revisions ADD COLUMN IF NOT EXISTS snapshot_cursor text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS session_command_receipts (
  actor_id text NOT NULL,
  command_id text NOT NULL,
  fingerprint text NOT NULL,
  receipt jsonb NOT NULL,
  snapshot jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, command_id)
);
