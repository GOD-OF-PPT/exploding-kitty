import { describe, expect, it } from "vitest";
import { ProtocolDecodeError, matchSnapshotCodec, parseClientAction, parseClientEnvelope, parseServerEnvelope } from "./index.js";

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

describe("ClientAction variant — CreateRoom", () => {
  const validSettings = {
    maxPlayers: 4,
    turnSeconds: 45,
    responseSeconds: 5,
    choiceSeconds: 15,
    allowBots: true,
    rulesetVersion: "original-2025@1",
  };

  it("parses a well-formed CreateRoom action", () => {
    expect(parseClientAction({ type: "CreateRoom", settings: validSettings })).toEqual({
      type: "CreateRoom",
      settings: validSettings,
    });
  });

  it.each([1, 6, 0])("rejects out-of-range maxPlayers %i", (maxPlayers) => {
    expect(() => parseClientAction({ type: "CreateRoom", settings: { ...validSettings, maxPlayers } }))
      .toThrow(ProtocolDecodeError);
  });

  it("rejects missing settings field", () => {
    expect(() => parseClientAction({ type: "CreateRoom" })).toThrow(ProtocolDecodeError);
  });

  it("rejects an unknown ruleset version", () => {
    expect(() => parseClientAction({ type: "CreateRoom", settings: { ...validSettings, rulesetVersion: "unknown@2" } }))
      .toThrow(ProtocolDecodeError);
  });
});

describe("ClientAction variant — JoinRoom", () => {
  it("parses a well-formed JoinRoom action", () => {
    expect(parseClientAction({ type: "JoinRoom", code: "123456" })).toEqual({
      type: "JoinRoom",
      code: "123456",
    });
  });

  it("rejects a missing code field", () => {
    expect(() => parseClientAction({ type: "JoinRoom" })).toThrow(ProtocolDecodeError);
  });

  it("rejects a non-string code", () => {
    expect(() => parseClientAction({ type: "JoinRoom", code: 123456 })).toThrow(ProtocolDecodeError);
  });

  it("rejects an empty code (too short)", () => {
    expect(() => parseClientAction({ type: "JoinRoom", code: "" })).toThrow(ProtocolDecodeError);
  });
});

describe("ClientAction variant — PlayNope", () => {
  it("parses a well-formed PlayNope action", () => {
    expect(parseClientAction({ type: "PlayNope", windowId: "window-1", cardToken: "token-1" })).toEqual({
      type: "PlayNope",
      windowId: "window-1",
      cardToken: "token-1",
    });
  });

  it("rejects an unexpected extra field", () => {
    expect(() => parseClientAction({ type: "PlayNope", windowId: "window-1", cardToken: "token-1", extra: "bad" }))
      .toThrow(ProtocolDecodeError);
  });
});

describe("ClientAction variant — InsertKitten", () => {
  it("parses a well-formed InsertKitten with position in range", () => {
    expect(parseClientAction({ type: "InsertKitten", promptId: "prompt-1", position: 5 })).toEqual({
      type: "InsertKitten",
      promptId: "prompt-1",
      position: 5,
    });
  });

  it("rejects a negative position", () => {
    expect(() => parseClientAction({ type: "InsertKitten", promptId: "prompt-1", position: -1 }))
      .toThrow(ProtocolDecodeError);
  });

  it("rejects a missing position", () => {
    expect(() => parseClientAction({ type: "InsertKitten", promptId: "prompt-1" }))
      .toThrow(ProtocolDecodeError);
  });

  it("rejects a non-integer position", () => {
    expect(() => parseClientAction({ type: "InsertKitten", promptId: "prompt-1", position: 1.5 }))
      .toThrow(ProtocolDecodeError);
  });
});

describe("ClientAction variant — UpdateSettings", () => {
  it("parses a full UpdateSettings with both fields", () => {
    expect(parseClientAction({ type: "UpdateSettings", sound: true, vibration: false })).toEqual({
      type: "UpdateSettings",
      sound: true,
      vibration: false,
    });
  });

  it("parses a partial UpdateSettings with only sound", () => {
    expect(parseClientAction({ type: "UpdateSettings", sound: true })).toEqual({
      type: "UpdateSettings",
      sound: true,
    });
  });

  it("parses a partial UpdateSettings with only vibration", () => {
    expect(parseClientAction({ type: "UpdateSettings", vibration: false })).toEqual({
      type: "UpdateSettings",
      vibration: false,
    });
  });

  it("rejects both fields absent", () => {
    expect(() => parseClientAction({ type: "UpdateSettings" })).toThrow(ProtocolDecodeError);
  });

  it("rejects an invalid sound type", () => {
    expect(() => parseClientAction({ type: "UpdateSettings", sound: "yes" })).toThrow(ProtocolDecodeError);
  });
});

describe("ClientAction variant — all union variants have dedicated parse coverage", () => {
  it.each([
    ["AddBot", { type: "AddBot" }],
    ["StartMatch", { type: "StartMatch" }],
    ["StartTutorial", { type: "StartTutorial" }],
    ["Concede", { type: "Concede" }],
    ["LeaveRoom", { type: "LeaveRoom" }],
    ["RestartMatch", { type: "RestartMatch" }],
    ["VoteRestart", { type: "VoteRestart" }],
  ])("parses no-payload action %s", (_label, action) => {
    expect(parseClientAction(action)).toEqual(action);
  });

  it.each([
    ["SetReady", { type: "SetReady", ready: true }],
    ["RemoveBot", { type: "RemoveBot", playerId: "bot-1" }],
    ["PassResponse", { type: "PassResponse", windowId: "w-1" }],
    ["ChooseCard", { type: "ChooseCard", promptId: "p-1", cardToken: "t-1" }],
    ["AcknowledgePeek", { type: "AcknowledgePeek", promptId: "p-1" }],
    ["UseDefuse", { type: "UseDefuse", promptId: "p-1", cardToken: "t-1" }],
  ])("parses payload action %s", (_label, action) => {
    expect(parseClientAction(action)).toEqual(action);
  });

  it("rejects an extra field on a no-payload action", () => {
    expect(() => parseClientAction({ type: "AddBot", extra: "bad" })).toThrow(ProtocolDecodeError);
  });

  it("rejects an unknown action type", () => {
    expect(() => parseClientAction({ type: "UnknownAction" })).toThrow(ProtocolDecodeError);
  });
});
