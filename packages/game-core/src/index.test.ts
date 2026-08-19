import { describe, expect, it } from "vitest";
import { applyCommand, createBotCommand, createMatch, legalActions, projectView, type Card, type GameState } from "./index.js";

function cardCount(state: GameState): number {
  return state.deck.length
    + state.discard.length
    + state.removed.length
    + Object.values(state.players).reduce((total, player) => total + player.hand.length, 0)
    + state.eliminatedZone.length
    + ((state.pending?.kind === "EXPLOSION" || state.pending?.kind === "DEFUSE_INSERTION") ? 1 : 0);
}

function takeCard(state: GameState, type: Card["type"]): Card {
  for (const zone of [state.deck, state.removed]) {
    const index = zone.findIndex((card) => card.type === type);
    if (index >= 0) return zone.splice(index, 1)[0]!;
  }
  throw new Error(`Missing ${type}`);
}

function moveCardsToPlayer(state: GameState, playerId: string, type: Card["type"], count = 1): Card[] {
  const cards: Card[] = [];
  const destinations = Object.values(state.players)
    .filter((player) => player.id !== playerId)
    .map((player) => player.hand);
  for (const zone of [state.deck, state.removed, ...destinations]) {
    for (let index = zone.length - 1; index >= 0 && cards.length < count; index -= 1) {
      if (zone[index]?.type === type) cards.push(zone.splice(index, 1)[0]!);
    }
  }
  if (cards.length !== count) throw new Error(`Missing ${count} ${type} card(s)`);
  state.players[playerId].hand.push(...cards);
  return cards;
}

function passResponse(state: GameState, prefix = "pass"): GameState {
  let next = state;
  while (next.pending?.kind === "RESPONSE") {
    const window = next.pending;
    const actorId = next.order.find((id) => next.players[id].alive && !window.passedPlayerIds.includes(id));
    if (!actorId) throw new Error("No eligible response actor");
    next = applyCommand(next, {
      type: "PassResponse",
      commandId: `${prefix}-${actorId}-${next.sequence}`,
      actorId,
      windowId: window.windowId,
    });
  }
  return next;
}

describe("deterministic authoritative game core", () => {
  it("replays the same seed and commands byte-for-byte", () => {
    const create = () => createMatch({ playerIds: ["a", "b", "c"], seed: "replay-seed", firstPlayerId: "a", now: 10 });
    const first = create();
    const second = create();
    expect(second).toEqual(first);
    const command = { type: "Concede" as const, commandId: "command-1", actorId: "c" };
    expect(applyCommand(second, command)).toEqual(applyCommand(first, command));
  });

  it("projects no deck order or opponent cards", () => {
    const state = createMatch({ playerIds: ["a", "b"], seed: 7 });
    const view = projectView(state, "a");
    expect(view.deckCount).toBeGreaterThan(0);
    expect(view as object).not.toHaveProperty("deck");
    expect(view.players.find((player) => player.id === "b")).toEqual({ id: "b", alive: true, handCount: 8 });
  });

  it.each(["EXPLOSION", "DEFUSE_INSERTION"] as const)("keeps all 56 cards when conceding during %s", (kind) => {
    const state = createMatch({ playerIds: ["a", "b", "c"], seed: 11, firstPlayerId: "a" });
    const explodingCard = takeCard(state, "EXPLODING_KITTEN");
    state.pending = kind === "EXPLOSION"
      ? { kind, promptId: "explode", deadlineId: "deadline-explode", deadline: 10, playerId: "a", explodingCard }
      : { kind, promptId: "insert", deadlineId: "deadline-insert", deadline: 10, playerId: "a", explodingCard };

    const next = applyCommand(state, { type: "Concede", commandId: `concede-${kind}`, actorId: "a" });

    expect(cardCount(next)).toBe(56);
    expect(next.pending).toBeNull();
    expect(next.eliminatedZone).toContainEqual({ ownerId: "a", card: explodingCard, faceUp: true });
    expect(next.turn?.playerId).toBe("b");
  });

  it.each(["actor", "target"] as const)("cancels a response safely when its %s concedes", (who) => {
    const state = createMatch({ playerIds: ["a", "b", "c"], seed: 12, firstPlayerId: "a" });
    state.pending = {
      kind: "RESPONSE",
      windowId: "window",
      deadlineId: "deadline-window",
      deadline: 10,
      action: {
        actorId: "a",
        turnId: state.turn!.id,
        cardIds: ["favor-committed"],
        cardType: "FAVOR",
        mode: "SINGLE",
        targetId: "b",
      },
      nopeCount: 0,
      passedPlayerIds: [],
    };

    const concedingId = who === "actor" ? "a" : "b";
    const next = applyCommand(state, { type: "Concede", commandId: `concede-${who}`, actorId: concedingId });

    expect(next.pending).toBeNull();
    if (who === "actor") expect(next.events.at(-1)?.type).toBe("TURN_STARTED");
    else expect(next.events.at(-1)?.type).toBe("ACTION_CANCELLED");
    expect(next.events.some((event) => event.type === "CHOICE_REQUESTED")).toBe(false);
    expect(next.players[concedingId].alive).toBe(false);
  });

  it("scopes idempotency keys by actor and never advertises Nope outside a response", () => {
    const state = createMatch({ playerIds: ["a", "b", "c", "d"], seed: 13, firstPlayerId: "a" });
    state.players.a.hand.push(takeCard(state, "NOPE"));
    expect(legalActions(state, "a").some((action) => action.type === "PlayNope")).toBe(false);

    const afterC = applyCommand(state, { type: "Concede", commandId: "same-id", actorId: "c" });
    const afterB = applyCommand(afterC, { type: "Concede", commandId: "same-id", actorId: "b" });
    expect(afterB.players.c.alive).toBe(false);
    expect(afterB.players.b.alive).toBe(false);
    expect(afterB.commandResults).toHaveProperty("player:c:same-id");
    expect(afterB.commandResults).toHaveProperty("player:b:same-id");
  });

  it("tracks a monotonic turn number and normalizes older persisted states", () => {
    const state = createMatch({ playerIds: ["a", "b", "c"], seed: 14, firstPlayerId: "a" });
    expect(state.turnNumber).toBe(1);
    const ordinaryIndex = state.deck.findIndex((card) => card.type !== "EXPLODING_KITTEN");
    state.deck.unshift(state.deck.splice(ordinaryIndex, 1)[0]!);
    const next = applyCommand(state, { type: "Draw", commandId: "draw", actorId: "a", turnId: state.turn!.id });
    expect(next.turnNumber).toBe(2);
    expect(projectView(next, "a").turnNumber).toBe(2);

    const legacy = createMatch({ playerIds: ["a", "b", "c"], seed: 15, firstPlayerId: "a" }) as GameState & { turnNumber?: number };
    delete legacy.turnNumber;
    const restored = applyCommand(legacy as GameState, { type: "Concede", commandId: "legacy", actorId: "c" });
    expect(restored.turnNumber).toBe(1);
  });

  it.each([
    [2, 35, 5],
    [3, 29, 3],
    [4, 23, 1],
    [5, 16, 0],
  ] as const)("creates a complete %i-player deck recipe", (playerCount, deckCount, removedCount) => {
    const state = createMatch({
      playerIds: Array.from({ length: playerCount }, (_, index) => `p${index + 1}`),
      seed: `setup-${playerCount}`,
    });
    expect(state.deck).toHaveLength(deckCount);
    expect(state.removed).toHaveLength(removedCount);
    expect(Object.values(state.players).every((player) => player.hand.length === 8)).toBe(true);
    expect(cardCount(state)).toBe(56);
  });

  it("resolves an even Nope chain and accumulates Attack debt", () => {
    let state = createMatch({ playerIds: ["a", "b", "c"], seed: "nope-attack", firstPlayerId: "a" });
    const attack = moveCardsToPlayer(state, "a", "ATTACK")[0]!;
    const nopes = moveCardsToPlayer(state, "b", "NOPE", 2);
    state = applyCommand(state, { type: "PlayCards", commandId: "attack", actorId: "a", turnId: state.turn!.id, cardIds: [attack.id] });
    state = applyCommand(state, { type: "PlayNope", commandId: "nope-1", actorId: "b", windowId: state.pending!.kind === "RESPONSE" ? state.pending.windowId : "", cardId: nopes[0]!.id });
    state = applyCommand(state, { type: "PlayNope", commandId: "nope-2", actorId: "b", windowId: state.pending!.kind === "RESPONSE" ? state.pending.windowId : "", cardId: nopes[1]!.id });
    state = passResponse(state, "attack-pass");
    expect(state.turn).toMatchObject({ playerId: "b", remaining: 2, source: "ATTACK" });

    const secondAttack = moveCardsToPlayer(state, "b", "ATTACK")[0]!;
    state = applyCommand(state, { type: "PlayCards", commandId: "attack-again", actorId: "b", turnId: state.turn!.id, cardIds: [secondAttack.id] });
    state = passResponse(state, "second-attack-pass");
    expect(state.turn).toMatchObject({ playerId: "c", remaining: 4, source: "ATTACK" });
  });

  it("resolves pair, triple, Favor and private peek without leaking or blocking the turn", () => {
    let state = createMatch({ playerIds: ["a", "b", "c"], seed: "choices", firstPlayerId: "a" });
    const pair = moveCardsToPlayer(state, "a", "CAT_TACO", 2);
    const beforePair = state.players.a.hand.length;
    state = applyCommand(state, { type: "PlayCards", commandId: "pair", actorId: "a", turnId: state.turn!.id, cardIds: pair.map((card) => card.id), targetId: "b" });
    state = passResponse(state, "pair-pass");
    expect(state.players.a.hand.length).toBe(beforePair - 1);

    const triple = moveCardsToPlayer(state, "a", "CAT_BEARD", 3);
    const requested = state.players.b.hand.find((card) => card.type === "DEFUSE")!;
    state = applyCommand(state, { type: "PlayCards", commandId: "triple", actorId: "a", turnId: state.turn!.id, cardIds: triple.map((card) => card.id), targetId: "b", declaredCardType: "DEFUSE" });
    state = passResponse(state, "triple-pass");
    expect(state.players.a.hand).toContainEqual(requested);

    const favor = moveCardsToPlayer(state, "a", "FAVOR")[0]!;
    state = applyCommand(state, { type: "PlayCards", commandId: "favor", actorId: "a", turnId: state.turn!.id, cardIds: [favor.id], targetId: "b" });
    state = passResponse(state, "favor-pass");
    expect(state.pending?.kind).toBe("FAVOR_CHOICE");
    const gift = state.players.b.hand[0]!;
    state = applyCommand(state, { type: "Choose", commandId: "give", actorId: "b", promptId: state.pending!.kind === "FAVOR_CHOICE" ? state.pending.promptId : "", value: { cardId: gift.id } });
    expect(state.players.a.hand).toContainEqual(gift);

    const peek = moveCardsToPlayer(state, "a", "SEE_FUTURE")[0]!;
    const topThree = state.deck.slice(0, 3);
    state = applyCommand(state, { type: "PlayCards", commandId: "peek", actorId: "a", turnId: state.turn!.id, cardIds: [peek.id] });
    state = passResponse(state, "peek-pass");
    expect(projectView(state, "a").privatePeek).toEqual(topThree);
    expect(projectView(state, "b").privatePeek).toEqual([]);
    state = applyCommand(state, { type: "Choose", commandId: "peek-ack", actorId: "a", promptId: state.pending!.kind === "PRIVATE_PEEK" ? state.pending.promptId : "", value: { acknowledged: true } });
    expect(state.pending).toBeNull();
    expect(state.turn?.playerId).toBe("a");
  });

  it("allows a three-Favor declaration against an empty target and lists every real combination", () => {
    let state = createMatch({ playerIds: ["a", "b", "c"], seed: "favor-triple", firstPlayerId: "a" });
    const favors = moveCardsToPlayer(state, "a", "FAVOR", 3);
    state.removed.push(...state.players.b.hand);
    state.players.b.hand = [];

    expect(() => applyCommand(state, {
      type: "PlayCards",
      commandId: "favor-triple",
      actorId: "a",
      turnId: state.turn!.id,
      cardIds: favors.map((card) => card.id),
      targetId: "b",
      declaredCardType: "NOPE",
    })).not.toThrow();

    moveCardsToPlayer(state, "a", "CAT_TACO", 4);
    const catIds = state.players.a.hand.filter((card) => card.type === "CAT_TACO").map((card) => card.id);
    const catActions = legalActions(state, "a")
      .filter((action) => action.type === "PlayCards" && action.cardIds?.every((id) => catIds.includes(id)))
      .map((action) => action.cardIds);
    expect(catActions.filter((ids) => ids?.length === 2)).toHaveLength(6);
    expect(catActions.filter((ids) => ids?.length === 3)).toHaveLength(4);
  });

  it("does not advertise Favor or pairs without an eligible hand-bearing target", () => {
    const state = createMatch({ playerIds: ["a", "b", "c"], seed: "no-target", firstPlayerId: "a" });
    const favor = moveCardsToPlayer(state, "a", "FAVOR")[0]!;
    const pair = moveCardsToPlayer(state, "a", "CAT_TACO", 2);
    for (const playerId of ["b", "c"]) {
      state.removed.push(...state.players[playerId].hand);
      state.players[playerId].hand = [];
    }

    const plays = legalActions(state, "a").filter((action) => action.type === "PlayCards");
    expect(plays.some((action) => action.cardIds?.includes(favor.id))).toBe(false);
    expect(plays.some((action) => action.cardIds?.length === 2 && pair.every((card) => action.cardIds?.includes(card.id)))).toBe(false);
  });

  it("rejects target and declaration fields outside their action modes", () => {
    const state = createMatch({ playerIds: ["a", "b", "c"], seed: "extra-fields", firstPlayerId: "a" });
    const shuffleCard = moveCardsToPlayer(state, "a", "SHUFFLE")[0]!;
    expect(() => applyCommand(state, {
      type: "PlayCards",
      commandId: "target-not-allowed",
      actorId: "a",
      turnId: state.turn!.id,
      cardIds: [shuffleCard.id],
      targetId: "b",
    })).toThrowError(expect.objectContaining({ code: "TARGET_NOT_ALLOWED" }));
    expect(() => applyCommand(state, {
      type: "PlayCards",
      commandId: "declaration-not-allowed",
      actorId: "a",
      turnId: state.turn!.id,
      cardIds: [shuffleCard.id],
      declaredCardType: "NOPE",
    })).toThrowError(expect.objectContaining({ code: "DECLARATION_NOT_ALLOWED" }));
  });

  it("handles action, Favor, peek, defuse insertion and turn deadlines", () => {
    let state = createMatch({ playerIds: ["a", "b", "c"], seed: "deadlines", firstPlayerId: "a", now: 100 });
    const shuffleCard = moveCardsToPlayer(state, "a", "SHUFFLE")[0]!;
    state = applyCommand(state, { type: "PlayCards", commandId: "shuffle", actorId: "a", turnId: state.turn!.id, cardIds: [shuffleCard.id] });
    const response = state.pending!;
    state = applyCommand(state, { type: "DeadlineElapsed", commandId: "response-timeout", deadlineId: response.deadlineId, now: response.deadline });
    expect(state.pending).toBeNull();

    const favor = moveCardsToPlayer(state, "a", "FAVOR")[0]!;
    state = applyCommand(state, { type: "PlayCards", commandId: "favor", actorId: "a", turnId: state.turn!.id, cardIds: [favor.id], targetId: "b" });
    state = applyCommand(state, { type: "DeadlineElapsed", commandId: "favor-response-timeout", deadlineId: state.pending!.deadlineId, now: state.pending!.deadline });
    const favorPrompt = state.pending!;
    const aBeforeFavor = state.players.a.hand.length;
    state = applyCommand(state, { type: "DeadlineElapsed", commandId: "favor-choice-timeout", deadlineId: favorPrompt.deadlineId, now: favorPrompt.deadline });
    expect(state.players.a.hand.length).toBe(aBeforeFavor + 1);

    const peek = moveCardsToPlayer(state, "a", "SEE_FUTURE")[0]!;
    state = applyCommand(state, { type: "PlayCards", commandId: "peek", actorId: "a", turnId: state.turn!.id, cardIds: [peek.id] });
    state = applyCommand(state, { type: "DeadlineElapsed", commandId: "peek-response-timeout", deadlineId: state.pending!.deadlineId, now: state.pending!.deadline });
    const peekPrompt = state.pending!;
    state = applyCommand(state, { type: "DeadlineElapsed", commandId: "peek-timeout", deadlineId: peekPrompt.deadlineId, now: peekPrompt.deadline });
    expect(state.privatePeeks.a).toEqual([]);

    const defuse = state.players.a.hand.find((card) => card.type === "DEFUSE")!;
    const explodingCard = takeCard(state, "EXPLODING_KITTEN");
    state.deck.unshift(explodingCard);
    state = applyCommand(state, { type: "Draw", commandId: "draw-kitten", actorId: "a", turnId: state.turn!.id });
    state = applyCommand(state, { type: "UseDefuse", commandId: "defuse", actorId: "a", promptId: state.pending!.kind === "EXPLOSION" ? state.pending.promptId : "", cardId: defuse.id });
    const insertion = state.pending!;
    state = applyCommand(state, { type: "DeadlineElapsed", commandId: "insertion-timeout", deadlineId: insertion.deadlineId, now: insertion.deadline });
    expect(state.deck).toContainEqual(explodingCard);
    expect(state.turn?.playerId).toBe("b");

    const deadlineTurn = state.turn!;
    const nextTop = state.deck.findIndex((card) => card.type !== "EXPLODING_KITTEN");
    state.deck.unshift(state.deck.splice(nextTop, 1)[0]!);
    state = applyCommand(state, { type: "DeadlineElapsed", commandId: "turn-timeout", deadlineId: deadlineTurn.deadlineId, now: deadlineTurn.deadline });
    expect(state.turn?.playerId).toBe("c");
    expect(cardCount(state)).toBe(56);
  });

  it("plays a bare SKIP card to end the turn without drawing and pass to the next player", () => {
    let state = createMatch({ playerIds: ["a", "b", "c"], seed: "skip-test", firstPlayerId: "a" });
    const skip = moveCardsToPlayer(state, "a", "SKIP")[0]!;
    const deckBefore = state.deck.length;
    const handBefore = state.players.a.hand.length;

    state = applyCommand(state, { type: "PlayCards", commandId: "skip", actorId: "a", turnId: state.turn!.id, cardIds: [skip.id] });
    state = passResponse(state, "skip-pass");

    expect(state.players.a.hand).not.toContainEqual(skip);
    expect(state.players.a.hand.length).toBe(handBefore - 1);
    expect(state.deck.length).toBe(deckBefore);
    expect(state.turn?.playerId).toBe("b");
    expect(state.turn?.remaining).toBe(1);
    expect(cardCount(state)).toBe(56);
  });

  it("finishes after explosion and creates a bot turn command", () => {
    let state = createMatch({ playerIds: ["a", "bot"], seed: "finish", firstPlayerId: "a" });
    const kitten = takeCard(state, "EXPLODING_KITTEN");
    state.deck.unshift(kitten);
    const defuse = state.players.a.hand.findIndex((card) => card.type === "DEFUSE");
    state.removed.push(...state.players.a.hand.splice(defuse, 1));
    state = applyCommand(state, { type: "Draw", commandId: "boom", actorId: "a", turnId: state.turn!.id });
    expect(state).toMatchObject({ status: "FINISHED", winnerId: "bot", turn: null, pending: null });
    expect(cardCount(state)).toBe(56);

    const botStates = createMatch({ playerIds: ["a", "bot", "c"], seed: "bot-actions", firstPlayerId: "bot" });
    expect(createBotCommand(botStates, "bot")).toMatchObject({ type: "Draw", actorId: "bot" });
  });
});
