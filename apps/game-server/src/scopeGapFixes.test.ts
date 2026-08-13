import { createMatch } from "@exploding-kitty/game-core";
import { describe, expect, it } from "vitest";
import { projectMatch } from "./match/projection.js";
import type { MatchRecord, RoomRecord } from "./model.js";
import { MemoryGameStore } from "./persistence/memoryStore.js";
import { RoomCoordinator } from "./room/roomCoordinator.js";

const settings = {
  maxPlayers: 2,
  turnSeconds: 45,
  responseSeconds: 5,
  choiceSeconds: 15,
  allowBots: true,
  rulesetVersion: "original-2025@1",
} as const;

describe("scope-gap regressions", () => {
  it("projects a response action's target and triple declaration", () => {
    const state = createMatch({ playerIds: ["alice", "bob"], seed: "response-details", firstPlayerId: "alice" });
    state.pending = {
      kind: "RESPONSE",
      windowId: "window-1",
      deadlineId: "deadline-window-1",
      deadline: 6_000,
      action: {
        actorId: "alice",
        turnId: state.turn!.id,
        cardIds: ["committed-1", "committed-2", "committed-3"],
        cardType: "CAT_TACO",
        mode: "TRIPLE",
        targetId: "bob",
        declaredCardType: "DEFUSE",
      },
      nopeCount: 0,
      passedPlayerIds: [],
    };
    const room: RoomRecord = {
      id: "room-1",
      code: "123456",
      ownerId: "alice",
      tutorial: false,
      settings,
      members: ["alice", "bob"].map((id) => ({ id, name: id, bot: false, ready: true, connected: true })),
      status: "ACTIVE",
      matchId: state.matchId,
      revision: 1,
      createdAt: 1_000,
    };
    const match: MatchRecord = {
      id: state.matchId,
      roomId: room.id,
      revision: 1,
      state,
      tokens: Object.values(state.players).flatMap((player) => player.hand.map((card) => ({
        token: `token-${player.id}-${card.id}`,
        cardId: card.id,
        ownerId: player.id,
      }))),
      deadline: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    };

    expect(projectMatch(match, room, "bob", 1_000).pending).toMatchObject({
      kind: "RESPONSE",
      actorId: "alice",
      targetId: "bob",
      declaredCardType: "DEFUSE",
    });
  });

  it("deletes a lobby when its last human leaves bots behind", async () => {
    const store = new MemoryGameStore();
    let sequence = 0;
    const rooms = new RoomCoordinator({
      store,
      clock: { now: () => 1_000 },
      ids: { next: (prefix) => `${prefix}-${++sequence}` },
      codes: { next: () => "123456" },
    });
    const host = { playerId: "alice", sessionToken: "session-alice" } as const;
    const room = await rooms.create(host, settings);
    await rooms.addBot(host, room.id);

    const result = await rooms.leave(host);

    expect(result.snapshot.phase).toBe("HOME");
    expect(await store.getRoomById(room.id)).toBeNull();
    expect(await store.getRoomByCode(room.code)).toBeNull();
  });
});
