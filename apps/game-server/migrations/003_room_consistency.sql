-- A real player may belong to at most one room. Besides enforcing the domain
-- rule, this closes the race between concurrent create/join requests.
CREATE UNIQUE INDEX IF NOT EXISTS room_members_real_player_unique_idx
  ON room_members(player_id)
  WHERE NOT is_bot;
