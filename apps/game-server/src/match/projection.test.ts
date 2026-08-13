import { createMatch, type CardType, type DomainEvent } from "@exploding-kitty/game-core";
import { describe, expect, it } from "vitest";
import type { MatchRecord, RoomRecord } from "../model.js";
import { projectMatch } from "./projection.js";

function fixture() {
  const playerIds = ["alice", "bob", "carol"];
  const state = createMatch({ playerIds, seed: "event-privacy", firstPlayerId: "alice" });
  const transferred: DomainEvent[] = [
    {
      sequence: state.sequence + 1,
      type: "CARD_STOLEN",
      fromId: "alice",
      toId: "bob",
      cardId: "private-stolen-card",
      cardType: "FAVOR" satisfies CardType,
    },
    {
      sequence: state.sequence + 2,
      type: "CARD_GIVEN",
      fromId: "bob",
      toId: "alice",
      cardId: "private-given-card",
      cardType: "NOPE" satisfies CardType,
    },
    {
      sequence: state.sequence + 3,
      type: "CARD_GIVEN",
      fromId: "alice",
      toId: "bob",
      cardId: "private-unknown-card",
      cardType: "CAT_TACO" satisfies CardType,
    },
    {
      sequence: state.sequence + 4,
      type: "CARD_DRAWN",
      playerId: "alice",
      cardId: "private-drawn-card",
      cardType: "DEFUSE" satisfies CardType,
    },
  ];
  state.events.push(...transferred);
  state.sequence = transferred.at(-1)!.sequence;

  const room: RoomRecord = {
    id: "room-1",
    code: "123456",
    ownerId: "alice",
    tutorial: false,
    settings: {
      maxPlayers: 3,
      turnSeconds: 45,
      responseSeconds: 5,
      choiceSeconds: 15,
      allowBots: false,
      rulesetVersion: "original-2025@1",
    },
    members: playerIds.map((id) => ({ id, name: id, bot: false, ready: true, connected: true })),
    status: "ACTIVE",
    matchId: state.matchId,
    revision: 1,
    createdAt: 0,
  };
  const match: MatchRecord = {
    id: state.matchId,
    roomId: room.id,
    revision: 1,
    state,
    tokens: playerIds.flatMap((ownerId) => state.players[ownerId].hand.map((card) => ({
      token: `token-${card.id}-${ownerId}`,
      cardId: card.id,
      ownerId,
    }))),
    deadline: null,
    createdAt: 0,
    updatedAt: 0,
  };
  return { match, room };
}

describe("viewer-specific event projection", () => {
  it("shows transferred card types only to the sender and receiver", () => {
    const { match, room } = fixture();
    const aliceEvents = projectMatch(match, room, "alice", 1).events?.filter((event) => event.type === "CARD_STOLEN" || event.type === "CARD_GIVEN");
    const bobEvents = projectMatch(match, room, "bob", 1).events?.filter((event) => event.type === "CARD_STOLEN" || event.type === "CARD_GIVEN");
    const carolEvents = projectMatch(match, room, "carol", 1).events?.filter((event) => event.type === "CARD_STOLEN" || event.type === "CARD_GIVEN");

    expect(aliceEvents?.map((event) => event.cardType)).toEqual(["FAVOR", "NOPE", "CAT_TACO"]);
    expect(bobEvents?.map((event) => event.cardType)).toEqual(["FAVOR", "NOPE", "CAT_TACO"]);
    expect(carolEvents).toEqual([
      { sequence: 3, type: "CARD_STOLEN" },
      { sequence: 4, type: "CARD_GIVEN" },
      { sequence: 5, type: "CARD_GIVEN" },
    ]);
  });

  it("shows draws to every observer without exposing the drawn card", () => {
    const { match, room } = fixture();

    for (const viewerId of ["alice", "bob", "carol"]) {
      const draw = projectMatch(match, room, viewerId, 1).events?.find((event) => event.type === "CARD_DRAWN");
      expect(draw).toEqual({ sequence: 6, type: "CARD_DRAWN", actorId: "alice" });
      expect(draw).not.toHaveProperty("cardType");
      expect(draw).not.toHaveProperty("cardId");
    }
  });
});
