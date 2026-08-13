import type { CardType } from "@exploding-kitty/game-core";
import { describe, expect, it } from "vitest";
import {
  CARD_CATALOG,
  DECLARABLE_CARD_TYPES,
  SCENE_IDS,
  buildPlayCardsAction,
  canonicalCardType,
  deriveScene,
  eligibleTargets,
  legalSelectionKind,
  materializeProductAction,
  normalizeProductView,
  selectionCanExtend,
  selectionNeedsTarget,
  selectedCards,
  selectedCardsAreCompatible,
  type ProductCard,
  type ProductView,
} from "./index";

const card = (type: CardType, token: string, overrides: Partial<ProductCard> = {}): ProductCard => ({
  token,
  type,
  name: CARD_CATALOG[type].name,
  image: CARD_CATALOG[type].image,
  playable: true,
  singlePlayable: CARD_CATALOG[type].singlePlayable,
  ...overrides,
});

const view: ProductView = {
  authenticated: true, phase: "MATCH", status: "ACTIVE", viewerId: "you",
  user: { id: "you", name: "You", avatar: "you.png" },
  room: { id: "room", code: "123456", ownerId: "you", maxPlayers: 4, allowBots: true, turnSeconds: 45, rulesetVersion: "original-2025@1", tutorial: false },
  game: { id: "match", turnId: "turn", turnPlayerId: "you", turnNumber: 1, turnsOwed: 1, drawPileCount: 20, direction: "顺时针" },
  players: [], hand: [], legalActions: ["Draw"], legalActionDetails: [{ type: "Draw", turnId: "turn" }], pending: null, events: [], eliminated: false, settings: { sound: true, vibration: true },
};

describe("presentation model", () => {
  it("enumerates the 25 reviewed scenes and derives specific match states", () => {
    expect(SCENE_IDS).toHaveLength(25);
    expect(deriveScene(view)).toBe("game");
    expect(deriveScene({ ...view, game: { ...view.game, turnsOwed: 3 } })).toBe("attack");
    expect(deriveScene(view, { overlay: "rules" })).toBe("rules");
  });

  it("normalizes authoritative wire snapshots before deriving scenes", () => {
    const normalized = normalizeProductView({
      phase: "MATCH", viewerId: "you", serverTime: 10_000, matchId: "m1",
      room: { id: "room", code: "123456", ownerId: "you", maxPlayers: 4, allowBots: true, turnSeconds: 45 },
      you: { id: "you", alive: true, hand: [{ token: "a", type: "ATTACK" }] },
      players: [{ id: "you", name: "You", alive: true, handCount: 1 }],
      turn: { id: "turn", playerId: "you", number: 2, remaining: 1, deadlineAt: 20_000 },
      legalActions: [{ type: "PlayCards", turnId: "turn", cardTokens: ["a"] }],
    }, "online");

    expect(normalized.hand[0]).toMatchObject({ token: "a", type: "ATTACK", playable: true, singlePlayable: true });
    expect(normalized.game).toMatchObject({ id: "m1", turnId: "turn", drawPileCount: 0, deadline: 20_000 });
    expect(deriveScene(normalized, { connectivity: "online" })).toBe("game");
  });

  it("keeps every connection state connecting until the first snapshot arrives", () => {
    for (const connectivity of ["local", "online", "offline", "connecting", "custom-state"]) {
      const normalized = normalizeProductView(null, connectivity);

      expect(normalized).toMatchObject({ authenticated: false, connectivity: "connecting" });
    }

    expect(normalizeProductView({ authenticated: false }, "ONLINE").connectivity).toBe("online");
    expect(normalizeProductView({ authenticated: false }, "custom-state").connectivity).toBe("custom-state");
  });

  it("uses SEE_FUTURE as canonical name while accepting the legacy input alias", () => {
    expect(CARD_CATALOG.SEE_FUTURE.name).toBe("预见未来");
    expect(canonicalCardType("SEE_THE_FUTURE")).toBe("SEE_FUTURE");
    expect(Object.keys(CARD_CATALOG)).not.toContain("SEE_THE_FUTURE");
  });

  it("only accepts playable single cards and same-type playable combinations", () => {
    expect(selectedCardsAreCompatible([])).toBe(false);
    expect(selectedCardsAreCompatible([card("ATTACK", "attack-1")])).toBe(true);
    expect(selectedCardsAreCompatible([card("ATTACK", "attack-1", { playable: false })])).toBe(false);
    expect(selectedCardsAreCompatible([card("CAT_TACO", "cat-1")])).toBe(false);
    expect(selectedCardsAreCompatible([card("CAT_TACO", "cat-1"), card("CAT_TACO", "cat-2")])).toBe(true);
    expect(selectedCardsAreCompatible([card("CAT_TACO", "cat-1"), card("CAT_BEARD", "cat-2")])).toBe(false);
    expect(selectedCardsAreCompatible([card("CAT_TACO", "cat-1"), card("CAT_TACO", "cat-1")])).toBe(false);
  });

  it("requires the fields needed by Favor, pair, and triple actions", () => {
    const favor = [card("FAVOR", "favor-1")];
    const pair = [card("CAT_TACO", "cat-1"), card("CAT_TACO", "cat-2")];
    const triple = [...pair, card("CAT_TACO", "cat-3")];

    expect(() => buildPlayCardsAction("turn", favor)).toThrow("TARGET_REQUIRED");
    expect(buildPlayCardsAction("turn", favor, "other")).toMatchObject({ targetId: "other" });
    expect(() => buildPlayCardsAction("turn", pair)).toThrow("TARGET_REQUIRED");
    expect(buildPlayCardsAction("turn", pair, "other")).toMatchObject({ targetId: "other" });
    expect(() => buildPlayCardsAction("turn", triple, "other")).toThrow("TARGET_AND_DECLARATION_REQUIRED");
    expect(() => buildPlayCardsAction("turn", triple, undefined, "ATTACK")).toThrow("TARGET_AND_DECLARATION_REQUIRED");
  });

  it("allows every card type, including all cat cards, as a triple declaration", () => {
    const triple = [card("CAT_TACO", "cat-1"), card("CAT_TACO", "cat-2"), card("CAT_TACO", "cat-3")];
    const declarations = Object.keys(CARD_CATALOG) as CardType[];

    expect(declarations).toEqual(expect.arrayContaining([
      "CAT_TACO",
      "CAT_BEARD",
      "CAT_POTATO",
      "CAT_RAINBOW",
      "CAT_WATERMELON",
    ]));
    for (const declaredCardType of declarations) {
      expect(buildPlayCardsAction("turn", triple, "other", declaredCardType).declaredCardType).toBe(declaredCardType);
    }
  });

  it("offers only legal targets for target-dependent selections", () => {
    const withTargets: ProductView = {
      ...view,
      players: [
        { id: "you", name: "You", avatar: "you.png", handCount: 4, alive: true, ready: true, bot: false, host: true, connected: true },
        { id: "holding", name: "Holding", avatar: "holding.png", handCount: 2, alive: true, ready: true, bot: false, host: false, connected: true },
        { id: "empty", name: "Empty", avatar: "empty.png", handCount: 0, alive: true, ready: true, bot: false, host: false, connected: true },
        { id: "dead", name: "Dead", avatar: "dead.png", handCount: 3, alive: false, ready: true, bot: false, host: false, connected: true },
      ],
    };
    const ids = (cards: readonly ProductCard[]) => eligibleTargets(withTargets, cards).map((player) => player.id);

    expect(ids([])).toEqual([]);
    expect(ids([card("ATTACK", "attack-1")])).toEqual([]);
    expect(ids([card("FAVOR", "favor-1")])).toEqual(["holding"]);
    expect(ids([card("CAT_TACO", "cat-1"), card("CAT_TACO", "cat-2")])).toEqual(["holding"]);
    expect(ids([card("CAT_TACO", "cat-1"), card("CAT_TACO", "cat-2"), card("CAT_TACO", "cat-3")])).toEqual(["holding", "empty"]);
  });

  it("uses authoritative legal-action tuples for selection compatibility and extension", () => {
    const first = card("CAT_TACO", "cat-1");
    const second = card("CAT_TACO", "cat-2");
    const withLegalSelection: ProductView = {
      ...view,
      hand: [first, second],
      legalActions: ["PlayCards"],
      legalActionDetails: [{ type: "PlayCards", turnId: "turn", cardTokens: ["cat-1", "cat-2"] }],
    };

    expect(selectedCards(withLegalSelection, ["cat-1"])).toEqual([first]);
    expect(legalSelectionKind(withLegalSelection, ["cat-1"])).toBe("prefix");
    expect(legalSelectionKind(withLegalSelection, ["cat-1", "cat-2"])).toBe("exact");
    expect(selectionCanExtend(withLegalSelection, ["cat-1"], "cat-2")).toBe(true);
    expect(selectionCanExtend(withLegalSelection, ["cat-1"], "attack")).toBe(false);
    expect(selectionNeedsTarget([first])).toBe(false);
    expect(selectionNeedsTarget([first, second])).toBe(true);
  });

  it("materializes rule-aware actions through the shared presentation seam", () => {
    const favor = card("FAVOR", "favor-1");
    const actionView: ProductView = {
      ...view,
      hand: [favor],
      legalActions: ["PlayCards", "PlayNope", "ChooseCard", "InsertKitten"],
      legalActionDetails: [
        { type: "PlayCards", turnId: "turn", cardTokens: ["favor-1"] },
        { type: "PlayNope", windowId: "window", cardTokens: ["favor-1"] },
        { type: "ChooseCard", promptId: "prompt", cardTokens: ["favor-1"] },
        { type: "InsertKitten", promptId: "insert" },
      ],
      pending: { kind: "DEFUSE_INSERTION", id: "insert", promptId: "insert", playerId: "you", deadline: 0, deckSize: 4 },
    };

    expect(materializeProductAction({ type: "PlayCards" }, actionView, { selectedTokens: ["favor-1"], selectedTargetId: "other" }))
      .toEqual({ type: "PlayCards", turnId: "turn", cardTokens: ["favor-1"], targetId: "other" });
    expect(materializeProductAction({ type: "ChooseCard", promptId: "prompt" }, actionView, { selectedTokens: ["favor-1"] }))
      .toEqual({ type: "ChooseCard", promptId: "prompt", cardToken: "favor-1" });
    expect(materializeProductAction({ type: "InsertKitten", promptId: "insert" }, actionView, { insertionPosition: 9 }))
      .toEqual({ type: "InsertKitten", promptId: "insert", position: 4 });
    expect(DECLARABLE_CARD_TYPES).toContain("CAT_WATERMELON");
  });
});
