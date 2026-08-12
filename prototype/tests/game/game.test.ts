import { describe, expect, it } from "vitest";
import {
  applyCommand,
  CARD_COUNTS,
  createBotCommand,
  createMatch,
  legalActions,
  projectView,
  type Card,
  type CardType,
  type GameState,
} from "../../src/game";

const totalCards = (state: GameState) =>
  state.deck.length + state.discard.length + state.removed.length
  + Object.values(state.players).reduce((count, player) => count + player.hand.length, 0)
  + state.eliminatedZone.length
  + (state.pending?.kind === "EXPLOSION" || state.pending?.kind === "DEFUSE_INSERTION" ? 1 : 0);

function card(type: CardType, id = `test-${type}`): Card {
  return { id, type };
}

function forceTop(state: GameState, type: CardType): GameState {
  const index = state.deck.findIndex((candidate) => candidate.type === type);
  const next = structuredClone(state);
  const [chosen] = next.deck.splice(index, 1);
  next.deck.unshift(chosen);
  return next;
}

function passAll(state: GameState, prefix: string): GameState {
  const window = state.pending;
  if (!window || window.kind !== "RESPONSE") throw new Error("response expected");
  let next = state;
  for (const id of next.order.filter((playerId) => next.players[playerId].alive)) {
    next = applyCommand(next, { type: "PassResponse", commandId: `${prefix}-${id}`, actorId: id, windowId: window.windowId });
  }
  return next;
}

describe("original-2025@1 game kernel", () => {
  it.each([[2, 35], [3, 29], [4, 23], [5, 16]])("sets up %i players with the official recipe", (count, deckCount) => {
    const playerIds = Array.from({ length: count }, (_, index) => `p${index + 1}`);
    const state = createMatch({ playerIds, seed: 17, firstPlayerId: playerIds[0] });
    expect(state.rulesetVersion).toBe("original-2025@1");
    expect(state).toMatchObject({
      kernelVersion: "1.0.0",
      cardCatalogVersion: "original-2025-cards@1",
      prngVersion: "xorshift32@1",
      eventSchemaVersion: 1,
    });
    expect(state.deck).toHaveLength(deckCount);
    expect(state.deck.filter((c) => c.type === "EXPLODING_KITTEN")).toHaveLength(count - 1);
    expect(Object.values(state.players).every((player) => player.hand.length === 8 && player.hand.some((c) => c.type === "DEFUSE"))).toBe(true);
    expect(Object.values(CARD_COUNTS).reduce((sum, value) => sum + value, 0)).toBe(56);
    expect(totalCards(state)).toBe(56);
  });

  it("draws safely, advances clockwise, and makes duplicate commands idempotent", () => {
    let state = forceTop(createMatch({ playerIds: ["alice", "bob"], seed: 17, firstPlayerId: "alice" }), "NOPE");
    const command = { type: "Draw" as const, commandId: "draw-1", actorId: "alice", turnId: state.turn!.id };
    state = applyCommand(state, command);
    expect(projectView(state, "alice").you.hand).toHaveLength(9);
    expect(state.turn?.playerId).toBe("bob");
    expect(applyCommand(state, command)).toBe(state);
    expect(totalCards(state)).toBe(56);
  });

  it("reveals an explosion, consumes Defuse, secretly reinserts it, and completes one owed turn", () => {
    let state = forceTop(createMatch({ playerIds: ["alice", "bob", "cara"], seed: 8, firstPlayerId: "alice" }), "EXPLODING_KITTEN");
    state.turn!.remaining = 2;
    state.turn!.source = "ATTACK";
    state = applyCommand(state, { type: "Draw", commandId: "boom", actorId: "alice", turnId: state.turn!.id });
    expect(state.pending?.kind).toBe("EXPLOSION");
    expect(projectView(state, "bob").pending).toMatchObject({ kind: "WAITING_PRIVATE_CHOICE", playerId: "alice" });
    expect(projectView(state, "bob").pending?.deadlineId).toBe(state.pending?.deadlineId);
    const defuse = state.players.alice.hand.find((c) => c.type === "DEFUSE")!;
    state = applyCommand(state, { type: "UseDefuse", commandId: "defuse", actorId: "alice", promptId: (state.pending as any).promptId, cardId: defuse.id });
    const insertionPrompt = (state.pending as any).promptId;
    expect(projectView(state, "bob").pending).toMatchObject({ kind: "WAITING_PRIVATE_CHOICE" });
    state = applyCommand(state, { type: "Choose", commandId: "insert", actorId: "alice", promptId: insertionPrompt, value: 0 });
    expect(state.deck[0].type).toBe("EXPLODING_KITTEN");
    expect(state.turn).toMatchObject({ playerId: "alice", remaining: 1, source: "ATTACK" });
    expect(totalCards(state)).toBe(56);
  });

  it("uses odd/even Nope parity and leaves every committed card in discard", () => {
    let state = createMatch({ playerIds: ["a", "b", "c"], seed: 9, firstPlayerId: "a" });
    state = structuredClone(state);
    state.players.a.hand.push(card("SHUFFLE", "shuffle-x"));
    state.players.b.hand.push(card("NOPE", "nope-x"));
    state.players.c.hand.push(card("NOPE", "nope-y"));
    state.removed.splice(0, 3);
    state = applyCommand(state, { type: "PlayCards", commandId: "play", actorId: "a", turnId: state.turn!.id, cardIds: ["shuffle-x"] });
    const firstWindow = (state.pending as any).windowId;
    state = applyCommand(state, { type: "PlayNope", commandId: "n1", actorId: "b", windowId: firstWindow, cardId: "nope-x" });
    const secondWindow = (state.pending as any).windowId;
    state = applyCommand(state, { type: "PlayNope", commandId: "n2", actorId: "c", windowId: secondWindow, cardId: "nope-y" });
    state = passAll(state, "pass");
    expect(state.events.some((event) => event.type === "DECK_SHUFFLED")).toBe(true);
    expect(state.discard.map((c) => c.id)).toEqual(expect.arrayContaining(["shuffle-x", "nope-x", "nope-y"]));
    expect(totalCards(state)).toBe(56);
  });

  it("transfers Attack debt, lets Skip clear one, and resolves Favor plus pair/triple combos", () => {
    let attack = createMatch({ playerIds: ["a", "b", "c"], seed: 3, firstPlayerId: "a" });
    attack = structuredClone(attack);
    attack.players.a.hand.push(card("ATTACK", "attack-x")); attack.removed.shift();
    attack = applyCommand(attack, { type: "PlayCards", commandId: "attack", actorId: "a", turnId: attack.turn!.id, cardIds: ["attack-x"] });
    attack = passAll(attack, "attack-pass");
    expect(attack.turn).toMatchObject({ playerId: "b", remaining: 2, source: "ATTACK" });
    attack.players.b.hand.push(card("SKIP", "skip-x")); attack.removed.shift();
    attack = applyCommand(attack, { type: "PlayCards", commandId: "skip", actorId: "b", turnId: attack.turn!.id, cardIds: ["skip-x"] });
    attack = passAll(attack, "skip-pass");
    expect(attack.turn).toMatchObject({ playerId: "b", remaining: 1 });

    let favor = createMatch({ playerIds: ["a", "b"], seed: 7, firstPlayerId: "a" });
    favor = structuredClone(favor);
    favor.players.a.hand.push(card("FAVOR", "favor-x")); favor.removed.shift();
    favor = applyCommand(favor, { type: "PlayCards", commandId: "favor", actorId: "a", turnId: favor.turn!.id, cardIds: ["favor-x"], targetId: "b" });
    favor = passAll(favor, "favor-pass");
    const gift = favor.players.b.hand[0];
    favor = applyCommand(favor, { type: "Choose", commandId: "gift", actorId: "b", promptId: (favor.pending as any).promptId, value: gift.id });
    expect(favor.players.a.hand.some((c) => c.id === gift.id)).toBe(true);

    let combo = createMatch({ playerIds: ["a", "b"], seed: 11, firstPlayerId: "a" });
    combo = structuredClone(combo);
    combo.players.a.hand.push(card("SHUFFLE", "pair-1"), card("SHUFFLE", "pair-2")); combo.removed.splice(0, 2);
    const before = combo.players.b.hand.length;
    combo = applyCommand(combo, { type: "PlayCards", commandId: "pair", actorId: "a", turnId: combo.turn!.id, cardIds: ["pair-1", "pair-2"], targetId: "b" });
    combo = passAll(combo, "pair-pass");
    expect(combo.players.b.hand).toHaveLength(before - 1);
  });

  it("keeps hidden information private, supports deadlines, bots, concede, and atomic victory", () => {
    let state = createMatch({ playerIds: ["human", "bot"], seed: 12, firstPlayerId: "bot" });
    expect(projectView(state, "human") as any).not.toHaveProperty("deck");
    expect(projectView(state, "human").players.find((p) => p.id === "bot")).toHaveProperty("handCount", 8);
    expect(legalActions(state, "bot").some((a) => a.type === "Draw")).toBe(true);
    expect(createBotCommand(state, "bot")).toMatchObject({ type: "Draw", actorId: "bot" });
    state = forceTop(state, "NOPE");
    state = applyCommand(state, { type: "DeadlineElapsed", commandId: "timeout", deadlineId: state.turn!.deadlineId, now: 45_000 });
    expect(state.turn?.playerId).toBe("human");
    state = applyCommand(state, { type: "Concede", commandId: "quit", actorId: "bot" });
    expect(state).toMatchObject({ status: "FINISHED", winnerId: "human", turn: null, pending: null });
    expect(state.events.filter((event) => event.type === "GAME_FINISHED")).toHaveLength(1);
    expect(totalCards(state)).toBe(56);
  });

  it("rejects a matching deadline before its due time without changing the match", () => {
    const state = createMatch({
      playerIds: ["alice", "bob"],
      seed: 12,
      firstPlayerId: "alice",
      now: 1_000,
      turnDurationMs: 45_000,
    });

    expect(() => applyCommand(state, {
      type: "DeadlineElapsed",
      commandId: "too-early",
      deadlineId: state.turn!.deadlineId,
      now: state.turn!.deadline - 1,
    })).toThrowError("DEADLINE_NOT_ELAPSED");
    expect(state.turn).toMatchObject({ playerId: "alice", deadline: 46_000 });
    expect(state.commandResults).not.toHaveProperty("too-early");
  });

  it("rejects a stale deadline id without changing the current deadline", () => {
    const state = createMatch({ playerIds: ["alice", "bob"], firstPlayerId: "alice", now: 1_000 });

    expect(() => applyCommand(state, {
      type: "DeadlineElapsed",
      commandId: "stale-timer",
      deadlineId: "deadline-stale",
      now: state.turn!.deadline,
    })).toThrowError("STALE_DEADLINE");
    expect(state.turn).toMatchObject({ playerId: "alice", deadlineId: "deadline-turn-1" });
    expect(state.commandResults).not.toHaveProperty("stale-timer");
  });
});
