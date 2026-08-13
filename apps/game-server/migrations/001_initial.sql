CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  owner_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('LOBBY', 'ACTIVE', 'FINISHED')),
  settings jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  restart_votes jsonb NOT NULL DEFAULT '[]'::jsonb,
  match_id text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id text NOT NULL,
  name text NOT NULL,
  avatar text,
  is_bot boolean NOT NULL DEFAULT false,
  ready boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT false,
  seat integer NOT NULL,
  PRIMARY KEY (room_id, player_id),
  UNIQUE (room_id, seat)
);
CREATE INDEX IF NOT EXISTS room_members_player_idx ON room_members(player_id) WHERE NOT is_bot;

CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id),
  revision bigint NOT NULL,
  state jsonb NOT NULL,
  card_tokens jsonb NOT NULL,
  deadline_id text,
  deadline_at timestamptz,
  deadline_lease_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_due_deadline_idx
  ON matches(deadline_at)
  WHERE deadline_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS command_receipts (
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  command_id text NOT NULL,
  fingerprint text,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (match_id, actor_id, command_id)
);

CREATE TABLE IF NOT EXISTS match_events (
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  revision bigint NOT NULL,
  type text NOT NULL,
  actor_id text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (match_id, sequence)
);
