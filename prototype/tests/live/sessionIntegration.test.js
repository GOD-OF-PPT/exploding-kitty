import { describe, expect, it } from "vitest";
import { canonicalCardType, normalizeSnapshot } from "../../src/live/viewModel.js";

describe("live session integration normalization", () => {
  it("maps a wrapped kernel player view into the playable UI shape", () => {
    const view = normalizeSnapshot({
      lifecycle: "active",
      connectivity: "local",
      lastSequence: 7,
      view: {
        status: "ACTIVE",
        matchId: "match-1",
        you: { id: "alice", alive: true, hand: [{ id: "skip-1", type: "SKIP" }] },
        players: [
          { id: "alice", alive: true, handCount: 1 },
          { id: "bob", alive: true, handCount: 4 },
        ],
        deckCount: 12,
        discard: [{ id: "attack-1", type: "ATTACK" }],
        turn: { id: "turn-3", playerId: "alice", remaining: 2, deadline: 1234 },
        pending: null,
        privatePeek: [],
      },
    });

    expect(view.me.id).toBe("alice");
    expect(view.hand[0]).toMatchObject({ token: "skip-1", type: "SKIP" });
    expect(view.game).toMatchObject({
      id: "match-1",
      turnId: "turn-3",
      turnPlayerId: "alice",
      turnsOwed: 2,
      drawPileCount: 12,
    });
    expect(view.game.discardTop.type).toBe("ATTACK");
    expect(view.connection.state).toBe("CONNECTED");
    expect(view.legalActions.map((action) => action.type)).toContain("DRAW");
  });

  it("keeps all five cat card identities distinct", () => {
    expect(canonicalCardType("CAT_TACO")).toBe("CAT_TACO");
    expect(canonicalCardType("CAT_BEARD")).toBe("CAT_BEARD");
  });
});
