import { describe, expect, it } from "vitest";
import { ProtocolDecodeError, matchSnapshotCodec, parseClientEnvelope, parseServerEnvelope } from "./index.js";

const matchSnapshot = () => ({
  phase: "MATCH",
  viewerId: "alice",
  serverTime: 1_000,
  room: { id: "room-1", code: "123456", ownerId: "alice", maxPlayers: 2, allowBots: true, turnSeconds: 45, rulesetVersion: "original-2025@1", tutorial: false },
  matchId: "match-1",
  status: "ACTIVE",
  you: { id: "alice", alive: true, hand: [{ token: "opaque-card", type: "ATTACK" }] },
  players: [
    { id: "alice", name: "Alice", handCount: 1, alive: true, ready: true, bot: false, connected: true },
    { id: "bob", name: "Bob", handCount: 8, alive: true, ready: true, bot: false, connected: true },
  ],
  restartVotes: [],
  deckCount: 35,
  discard: [],
  turn: { id: "turn-1", playerId: "alice", number: 1, remaining: 1, direction: "CLOCKWISE", deadlineAt: 46_000, deadlineId: "deadline-turn-1" },
  pending: null,
  privatePeek: [],
  legalActions: [{ type: "Draw", turnId: "turn-1" }, { type: "PlayCards", turnId: "turn-1", cardTokens: ["opaque-card"] }],
  events: [{ sequence: 1, type: "MATCH_STARTED" }],
});

describe("version 1 wire protocol", () => {
  it("parses a strict play command without authority metadata", () => {
    const result = parseClientEnvelope({
      type: "command",
      protocolVersion: 1,
      sessionId: "session-1",
      commandId: "command-1",
      expectedRevision: 7,
      action: { type: "PlayCards", turnId: "turn-2", cardTokens: ["opaque-a"], targetId: "p2" },
    });
    expect(result).toMatchObject({ type: "command", expectedRevision: 7, action: { type: "PlayCards" } });
    expect(JSON.stringify(result)).not.toMatch(/actorId|sentAt|DeadlineElapsed/);
  });

  it.each(["actorId", "sentAt"])("rejects forged %s metadata", (field) => {
    expect(() => parseClientEnvelope({
      type: "command", protocolVersion: 1, sessionId: "s", commandId: "c", expectedRevision: 0,
      action: { type: "Draw", turnId: "t", [field]: field === "sentAt" ? 123 : "other" },
    })).toThrow(ProtocolDecodeError);
  });

  it("rejects deadline callbacks and accepts revisions that skip values", () => {
    expect(() => parseClientEnvelope({
      type: "command", protocolVersion: 1, sessionId: "s", commandId: "c", expectedRevision: 0,
      action: { type: "DeadlineElapsed", deadlineId: "deadline-1" },
    })).toThrow(ProtocolDecodeError);
    expect(parseServerEnvelope({
      type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 200,
      snapshot: { state: "MATCH" },
    })).toMatchObject({ revision: 200, snapshot: { state: "MATCH" } });
  });

  it("strictly validates the authoritative mini-game snapshot", () => {
    const { tutorial: _legacyTutorial, ...legacyRoom } = matchSnapshot().room;
    expect(parseServerEnvelope({
      type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 20, snapshot: matchSnapshot(),
    }, matchSnapshotCodec)).toMatchObject({ type: "snapshot", revision: 20, snapshot: { phase: "MATCH", viewerId: "alice" } });

    expect(() => parseServerEnvelope({
      type: "snapshot", protocolVersion: 2, sessionId: "s", revision: 20, snapshot: matchSnapshot(),
    }, matchSnapshotCodec)).toThrow(ProtocolDecodeError);
    expect(() => parseServerEnvelope({
      type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 20,
      snapshot: { ...matchSnapshot(), deckOrder: ["secret-card"] },
    }, matchSnapshotCodec)).toThrow(/\.snapshot\.deckOrder/);
    expect(() => parseServerEnvelope({
      type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 20,
      snapshot: { ...matchSnapshot(), you: { id: "mallory", alive: true, hand: [] } },
    }, matchSnapshotCodec)).toThrow(/\.snapshot\.you\.id/);
    expect(() => parseServerEnvelope({
      type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 20,
      snapshot: { ...matchSnapshot(), room: legacyRoom },
    }, matchSnapshotCodec)).toThrow(/\.snapshot\.room\.tutorial/);
  });
});
