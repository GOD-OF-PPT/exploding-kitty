# @exploding-kitty/game-core

Deterministic rule kernel for the Exploding Kittens–style turn-based card game.
Pure functions over an immutable `GameState`; no I/O, no network, no timers.

## Idempotency: `commandResults` cache

`GameState.commandResults` is a **bounded, non-authoritative** deduplication
cache inside the kernel. It records the `sequence` at which a command was
applied so a replayed command with the same key is a no-op (`applyCommand`
returns the state unchanged). The cache is capped at
`COMMAND_RESULT_LIMIT` (256 entries) and evicts the oldest entries when full,
so a sufficiently old command ID may no longer be recognized.

This cache is **defense-in-depth only** and does not carry production
correctness responsibility. The authoritative idempotency guarantee is the
server-side receipt tables (`command_receipts` for match commands,
`room_command_receipts` for room commands) checked by `MatchCoordinator` and
`RoomCoordinator` inside their database transactions **before** the kernel is
called. Both production kernel entry points (`execute()` and
`executeDeadline()`) go through that receipt check first. New callers must not
assume this in-kernel cache alone prevents double-execution.
