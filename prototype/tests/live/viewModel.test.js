import { describe, expect, it } from "vitest";
import {
  BASE_CARDS,
  buildPlayCommand,
  deriveScene,
  eligibleTargets,
  normalizeSnapshot,
  selectedCardsAreCompatible,
} from "../../src/live/viewModel.js";

describe("live view model", () => {
  it("describes the complete 2025 base deck", () => {
    expect(BASE_CARDS).toHaveLength(9);
    expect(BASE_CARDS.reduce((total, card) => total + card.count, 0)).toBe(56);
    expect(BASE_CARDS.find((card) => card.type === "EXPLODING_KITTEN")?.nopeable).toBe(false);
    expect(BASE_CARDS.find((card) => card.type === "DEFUSE")?.nopeable).toBe(false);
  });

  it("normalizes common public session aliases without exposing opponent hands", () => {
    const view = normalizeSnapshot({
      authenticated: true,
      playerId: "me",
      room: { roomId: "room", inviteCode: "582913", hostId: "me" },
      game: { matchId: "match", phase: "AWAITING_TURN_ACTION", turn: { playerId: "me", remaining: 3 }, deckCount: 18 },
      players: [
        { playerId: "me", nickname: "我", handCount: 2 },
        { playerId: "them", nickname: "对手", handCount: 7, hand: [{ type: "NOPE" }] },
      ],
      hand: [{ cardToken: "a", cardType: "ATTACK" }, { cardToken: "b", cardType: "ATTACK" }],
      legalActions: ["Draw", "PlayCards"],
    });

    expect(view.room.code).toBe("582913");
    expect(view.game.turnsOwed).toBe(3);
    expect(view.hand.map((card) => card.token)).toEqual(["a", "b"]);
    expect(view.players[1]).not.toHaveProperty("hand");
    expect(deriveScene(view)).toBe("game");
  });

  it("builds locked two and three-card play commands", () => {
    const cards = [
      { token: "a", type: "ATTACK" },
      { token: "b", type: "ATTACK" },
      { token: "c", type: "ATTACK" },
    ];
    expect(selectedCardsAreCompatible(cards)).toBe(true);
    expect(buildPlayCommand(cards, "target", "defuse")).toEqual({
      type: "PlayCards",
      cardTokens: ["a", "b", "c"],
      target: "target",
      declaredCardType: "DEFUSE",
    });
  });

  it("excludes empty targets for Favor/two-card steal but permits them for three-card declaration", () => {
    const view = normalizeSnapshot({
      authenticated: true,
      playerId: "me",
      players: [
        { id: "me", handCount: 3 },
        { id: "empty", handCount: 0 },
        { id: "full", handCount: 4 },
      ],
    });
    expect(eligibleTargets(view, [{ type: "FAVOR" }]).map((player) => player.id)).toEqual(["full"]);
    expect(eligibleTargets(view, [{ type: "ATTACK" }, { type: "ATTACK" }]).map((player) => player.id)).toEqual(["full"]);
    expect(eligibleTargets(view, [{ type: "ATTACK" }, { type: "ATTACK" }, { type: "ATTACK" }]).map((player) => player.id)).toEqual(["empty", "full"]);
  });

  it("prioritizes recovery and pending match scenes", () => {
    const offline = normalizeSnapshot({ authenticated: true, connection: { status: "disconnected" }, game: { id: "m" } });
    expect(deriveScene(offline)).toBe("network");
    expect(deriveScene(normalizeSnapshot({ authenticated: false }))).toBe("login");
    expect(deriveScene(normalizeSnapshot({ authenticated: true, result: { winnerId: "x" } }))).toBe("result");
  });
});
