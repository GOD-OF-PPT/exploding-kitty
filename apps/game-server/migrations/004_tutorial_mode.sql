ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS tutorial boolean NOT NULL DEFAULT false;

-- Before tutorial mode existed, durable idempotency receipts could contain a
-- lobby or match snapshot without room.tutorial. Replayed receipts bypass the
-- normal projector, so normalize those historical v1 snapshots as ordinary
-- rooms before the strict client codec sees them.
UPDATE session_command_receipts
SET snapshot = jsonb_set(snapshot, '{room,tutorial}', 'false'::jsonb, true)
WHERE snapshot IS NOT NULL
  AND snapshot ? 'room'
  AND jsonb_typeof(snapshot->'room') = 'object'
  AND NOT (snapshot->'room' ? 'tutorial');
