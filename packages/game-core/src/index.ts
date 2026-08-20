import { createFullDeck } from "./deck.js";
import { nextRandom, seedFrom, shuffle } from "./random.js";
import {
  RULESET_VERSION,
  KERNEL_VERSION,
  CARD_CATALOG_VERSION,
  PRNG_VERSION,
  EVENT_SCHEMA_VERSION,
  type Card,
  type CardType,
  type Command,
  type CommittedAction,
  type CreateMatchOptions,
  type DomainEvent,
  type GameState,
  type LegalAction,
  type PendingView,
  type PlayerView,
  type ResponseWindow,
  type TurnBatch,
} from "./types.js";

export * from "./types.js";
export { CARD_COUNTS } from "./deck.js";

const SINGLE_ACTIONS = new Set<CardType>(["ATTACK", "FAVOR", "SHUFFLE", "SKIP", "SEE_FUTURE"]);
// Must retain every event from the largest server-side bot batch so incremental audit projection
// can still read all events whose sequence is newer than the transaction's previous state.
const EVENT_HISTORY_LIMIT = 2_048;
/**
 * Bound on the in-kernel `commandResults` deduplication cache. The cache is a
 * bounded, non-authoritative defense-in-depth layer: it is trimmed to this
 * many entries, so old command IDs can be evicted. The authoritative
 * idempotency guarantee is the server-side receipt tables
 * (`command_receipts` / `room_command_receipts`) checked by
 * `MatchCoordinator`/`RoomCoordinator` before the kernel is ever called.
 * New callers must not rely on this cache alone for correctness.
 */
const COMMAND_RESULT_LIMIT = 256;

export class GameRuleError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "GameRuleError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new GameRuleError(code);
}

function assertSetupOptions(options: CreateMatchOptions): void {
  if (options.playerIds.length < 2 || options.playerIds.length > 5) fail("PLAYER_COUNT_OUT_OF_RANGE");
  if (new Set(options.playerIds).size !== options.playerIds.length) fail("DUPLICATE_PLAYER_ID");
  if (options.firstPlayerId && !options.playerIds.includes(options.firstPlayerId)) fail("INVALID_FIRST_PLAYER");
}

function randomIndex(state: GameState, length: number): number {
  if (length < 1) fail("NO_LEGAL_RANDOM_CHOICE");
  let value: number;
  [value, state.rngState] = nextRandom(state.rngState);
  return Math.floor(value * length);
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    turnNumber: Number.isSafeInteger(state.turnNumber) && state.turnNumber > 0 ? state.turnNumber : 1,
    order: [...state.order],
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, player]) => [id, { ...player, hand: [...player.hand] }]),
    ),
    deck: [...state.deck],
    discard: [...state.discard],
    removed: [...state.removed],
    eliminatedZone: state.eliminatedZone.map((entry) => ({ ...entry })),
    turn: state.turn ? { ...state.turn } : null,
    pending: state.pending
      ? {
          ...state.pending,
          ...(state.pending.kind === "RESPONSE"
            ? {
                action: { ...state.pending.action, cardIds: [...state.pending.action.cardIds] },
                passedPlayerIds: [...state.pending.passedPlayerIds],
              }
            : {}),
        }
      : null,
    privatePeeks: Object.fromEntries(Object.entries(state.privatePeeks).map(([id, cards]) => [id, [...cards]])),
    events: [...state.events],
    commandResults: { ...state.commandResults },
    config: { ...state.config },
  } as GameState;
}

function event(state: GameState, type: string, details: Record<string, unknown> = {}): void {
  state.sequence += 1;
  state.events.push({ sequence: state.sequence, type, ...details });
  if (state.events.length > EVENT_HISTORY_LIMIT) state.events.splice(0, state.events.length - EVENT_HISTORY_LIMIT);
}

function validateCardConservation(state: GameState): void {
  const cards = [
    ...state.deck,
    ...state.discard,
    ...state.removed,
    ...state.eliminatedZone.map((entry) => entry.card),
    ...Object.values(state.players).flatMap((player) => player.hand),
    ...((state.pending?.kind === "EXPLOSION" || state.pending?.kind === "DEFUSE_INSERTION")
      ? [state.pending.explodingCard]
      : []),
  ];
  if (cards.length !== 56 || new Set(cards.map((card) => card.id)).size !== cards.length) {
    fail("CARD_CONSERVATION_VIOLATION");
  }
}

function issueId(state: GameState, prefix: string): string {
  return `${prefix}-${state.nextId++}`;
}

function aliveIds(state: GameState): string[] {
  return state.order.filter((id) => state.players[id]!.alive);
}

function nextAlivePlayer(state: GameState, playerId: string): string {
  const start = state.order.indexOf(playerId);
  for (let offset = 1; offset <= state.order.length; offset += 1) {
    const candidate = state.order[(start + offset) % state.order.length]!;
    if (state.players[candidate]!.alive) return candidate;
  }
  fail("NO_LIVING_PLAYER");
}

function setTurn(state: GameState, playerId: string, remaining = 1, source: TurnBatch["source"] = "NORMAL"): void {
  const id = issueId(state, "turn");
  state.turn = {
    id,
    playerId,
    remaining,
    source,
    deadlineId: `deadline-${id}`,
    deadline: state.clock + state.config.turnDurationMs,
  };
  state.pending = null;
  state.turnNumber = (Number.isSafeInteger(state.turnNumber) && state.turnNumber > 0 ? state.turnNumber : 1) + 1;
  state.privatePeeks[playerId] = [];
  event(state, "TURN_STARTED", { playerId, turnId: id, remaining, source });
}

function finishIfWon(state: GameState): boolean {
  const living = aliveIds(state);
  if (living.length !== 1) return false;
  state.status = "FINISHED";
  state.winnerId = living[0];
  state.turn = null;
  state.pending = null;
  event(state, "GAME_FINISHED", { winnerId: living[0] });
  return true;
}

function completeOneTurn(state: GameState): void {
  const turn = state.turn;
  if (!turn) fail("NO_ACTIVE_TURN");
  if (!state.players[turn.playerId]!.alive) {
    setTurn(state, nextAlivePlayer(state, turn.playerId));
    return;
  }
  if (turn.remaining > 1) setTurn(state, turn.playerId, turn.remaining - 1, turn.source);
  else setTurn(state, nextAlivePlayer(state, turn.playerId));
}

function removeOwnedCard(player: { hand: Card[] }, cardId: string, expectedType?: CardType): Card {
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) fail("CARD_NOT_OWNED");
  const card = player.hand[index]!;
  if (expectedType && card.type !== expectedType) fail("WRONG_CARD_TYPE");
  player.hand.splice(index, 1);
  return card;
}

function transferCard(state: GameState, fromId: string, toId: string, card: Card, type: string): void {
  if (!state.players[fromId]?.alive || !state.players[toId]?.alive) fail("PLAYER_NOT_ACTIVE");
  removeOwnedCard(state.players[fromId], card.id);
  state.players[toId].hand.push(card);
  event(state, type, { fromId, toId, cardId: card.id, cardType: card.type });
}

function eliminateForExplosion(state: GameState, playerId: string, explodingCard: Card): void {
  const player = state.players[playerId]!;
  state.eliminatedZone.push({ ownerId: playerId, card: explodingCard, faceUp: true });
  for (const card of player.hand) state.eliminatedZone.push({ ownerId: playerId, card, faceUp: false });
  player.hand = [];
  player.alive = false;
  state.pending = null;
  event(state, "PLAYER_ELIMINATED", { playerId, reason: "EXPLOSION", explodingCardId: explodingCard.id });
  if (!finishIfWon(state)) setTurn(state, nextAlivePlayer(state, playerId));
}

function insertExploding(state: GameState, playerId: string, explodingCard: Card, position: number): void {
  if (!Number.isInteger(position) || position < 0 || position > state.deck.length) fail("INVALID_DECK_POSITION");
  state.deck.splice(position, 0, explodingCard);
  state.pending = null;
  event(state, "KITTEN_REINSERTED", { playerId, position });
  completeOneTurn(state);
}

function drawForCurrentTurn(state: GameState, actorId: string): void {
  if (!state.turn || state.turn.playerId !== actorId) fail("NOT_YOUR_TURN");
  if (state.deck.length === 0) fail("DECK_EMPTY");
  const card = state.deck.shift()!;
  event(state, "CARD_DRAWN", { playerId: actorId, cardId: card.id, cardType: card.type });
  if (card.type !== "EXPLODING_KITTEN") {
    state.players[actorId]!.hand.push(card);
    completeOneTurn(state);
    return;
  }
  event(state, "EXPLODING_KITTEN_REVEALED", { playerId: actorId, cardId: card.id });
  const defuse = state.players[actorId]!.hand.find((held) => held.type === "DEFUSE");
  if (!defuse) {
    eliminateForExplosion(state, actorId, card);
    return;
  }
  const promptId = issueId(state, "explosion");
  state.pending = {
    kind: "EXPLOSION",
    promptId,
    playerId: actorId,
    explodingCard: card,
    deadlineId: `deadline-${promptId}`,
    deadline: state.clock + state.config.choiceDurationMs,
  };
}

function openResponse(state: GameState, action: CommittedAction, nopeCount = 0): void {
  const windowId = issueId(state, "window");
  state.pending = {
    kind: "RESPONSE",
    windowId,
    deadlineId: `deadline-${windowId}`,
    deadline: state.clock + state.config.responseWindowMs,
    action,
    nopeCount,
    passedPlayerIds: [],
  };
  event(state, "RESPONSE_WINDOW_OPENED", { windowId, actorId: action.actorId, cardIds: action.cardIds, nopeCount });
}

function resolveAction(state: GameState, action: CommittedAction): void {
  state.pending = null;
  const actor = state.players[action.actorId];
  if (!actor?.alive) {
    event(state, "ACTION_CANCELLED", { actorId: action.actorId, cardIds: action.cardIds, reason: "ACTOR_ELIMINATED" });
    return;
  }
  event(state, "ACTION_RESOLVED", { actorId: action.actorId, cardIds: action.cardIds, mode: action.mode });
  if (action.mode === "PAIR") {
    const target = state.players[action.targetId!];
    if (target?.alive && target.hand.length > 0) {
      const card = target.hand[randomIndex(state, target.hand.length)]!;
      transferCard(state, target.id, action.actorId, card, "CARD_STOLEN");
    }
    return;
  }
  if (action.mode === "TRIPLE") {
    const target = state.players[action.targetId!];
    const card = target?.alive ? target.hand.find((held) => held.type === action.declaredCardType) : undefined;
    if (target?.alive && card) transferCard(state, target.id, action.actorId, card, "CARD_GIVEN");
    else event(state, "COMBO_MISSED", { actorId: action.actorId, targetId: action.targetId, declaredCardType: action.declaredCardType });
    return;
  }
  switch (action.cardType) {
    case "ATTACK": {
      const turn = state.turn!;
      const owed = (turn.source === "ATTACK" ? turn.remaining : 0) + 2;
      setTurn(state, nextAlivePlayer(state, action.actorId), owed, "ATTACK");
      break;
    }
    case "SKIP":
      completeOneTurn(state);
      break;
    case "SHUFFLE": {
      [state.deck, state.rngState] = shuffle(state.deck, state.rngState);
      event(state, "DECK_SHUFFLED", { actorId: action.actorId, cardIds: state.deck.map((card) => card.id) });
      break;
    }
    case "SEE_FUTURE":
      state.privatePeeks[action.actorId] = state.deck.slice(0, 3);
      {
        const promptId = issueId(state, "peek");
        state.pending = {
          kind: "PRIVATE_PEEK",
          promptId,
          playerId: action.actorId,
          cards: [...(state.privatePeeks[action.actorId] ?? [])],
          deadlineId: `deadline-${promptId}`,
          deadline: state.clock + state.config.choiceDurationMs,
        };
      }
      event(state, "PRIVATE_PEEK_GRANTED", { playerId: action.actorId, cardIds: (state.privatePeeks[action.actorId] ?? []).map((card) => card.id) });
      break;
    case "FAVOR": {
      const target = state.players[action.targetId!];
      if (!target?.alive || target.hand.length === 0) {
        event(state, "ACTION_CANCELLED", { actorId: action.actorId, cardIds: action.cardIds, reason: "TARGET_UNAVAILABLE" });
        break;
      }
      const promptId = issueId(state, "favor");
      state.pending = {
        kind: "FAVOR_CHOICE",
        promptId,
        requesterId: action.actorId,
        targetId: action.targetId!,
        deadlineId: `deadline-${promptId}`,
        deadline: state.clock + state.config.choiceDurationMs,
      };
      event(state, "CHOICE_REQUESTED", { promptId, playerId: action.targetId, choice: "FAVOR_CARD" });
      break;
    }
    default:
      fail("UNSUPPORTED_ACTION");
  }
}

function closeResponse(state: GameState, window: ResponseWindow): void {
  state.pending = null;
  if (window.nopeCount % 2 === 1) {
    event(state, "ACTION_CANCELLED", { actorId: window.action.actorId, cardIds: window.action.cardIds });
    return;
  }
  resolveAction(state, window.action);
}

function eliminateConcedingPlayer(state: GameState, playerId: string): void {
  const player = state.players[playerId]!;
  const pending = state.pending;

  if ((pending?.kind === "EXPLOSION" || pending?.kind === "DEFUSE_INSERTION") && pending.playerId === playerId) {
    state.eliminatedZone.push({ ownerId: playerId, card: pending.explodingCard, faceUp: true });
  }
  for (const card of player.hand) state.eliminatedZone.push({ ownerId: playerId, card, faceUp: true });
  player.hand = [];
  player.alive = false;
  player.conceded = true;
  state.privatePeeks[playerId] = [];
  event(state, "PLAYER_ELIMINATED", { playerId, reason: "CONCEDE" });

  if (finishIfWon(state)) return;

  if (pending?.kind === "RESPONSE") {
    if (pending.action.actorId === playerId) {
      state.pending = null;
      event(state, "ACTION_CANCELLED", { actorId: playerId, cardIds: pending.action.cardIds, reason: "ACTOR_ELIMINATED" });
    } else if (pending.action.targetId === playerId) {
      state.pending = null;
      event(state, "ACTION_CANCELLED", {
        actorId: pending.action.actorId,
        cardIds: pending.action.cardIds,
        reason: "TARGET_ELIMINATED",
      });
    } else {
      pending.passedPlayerIds = [...new Set([...pending.passedPlayerIds, playerId])];
      if (aliveIds(state).every((id) => pending.passedPlayerIds.includes(id))) closeResponse(state, pending);
    }
  } else if (pending?.kind === "FAVOR_CHOICE" && (pending.targetId === playerId || pending.requesterId === playerId)) {
    state.pending = null;
    event(state, "ACTION_CANCELLED", { actorId: pending.requesterId, reason: "PLAYER_ELIMINATED" });
  } else if (
    pending && "playerId" in pending && pending.playerId === playerId
  ) {
    state.pending = null;
  }

  if (state.turn?.playerId === playerId && state.pending?.kind !== "RESPONSE") {
    setTurn(state, nextAlivePlayer(state, playerId));
  }
}

function validateAction(state: GameState, command: Extract<Command, { type: "PlayCards" }>): CommittedAction {
  if (!state.turn || state.turn.id !== command.turnId) fail("STALE_TURN");
  if (state.turn.playerId !== command.actorId) fail("NOT_YOUR_TURN");
  if (command.cardIds.length < 1 || command.cardIds.length > 3 || new Set(command.cardIds).size !== command.cardIds.length) fail("INVALID_CARD_SET");
  const player = state.players[command.actorId]!;
  const cards = command.cardIds.map((id) => player.hand.find((card) => card.id === id) ?? fail("CARD_NOT_OWNED"));
  if (!cards.every((card) => card.type === cards[0]!.type)) fail("COMBO_REQUIRES_SAME_TYPE");
  const mode = cards.length === 1 ? "SINGLE" : cards.length === 2 ? "PAIR" : "TRIPLE";
  if (mode === "SINGLE" && !SINGLE_ACTIONS.has(cards[0]!.type)) fail("CARD_NOT_PLAYABLE_SINGLY");
  if (mode !== "SINGLE" && cards[0]!.type === "EXPLODING_KITTEN") fail("EXPLODING_KITTEN_NOT_PLAYABLE");
  const isSingleFavor = mode === "SINGLE" && cards[0]!.type === "FAVOR";
  if ((isSingleFavor || mode === "PAIR") && !command.targetId) fail("TARGET_REQUIRED");
  if (mode === "TRIPLE" && (!command.targetId || !command.declaredCardType)) fail("TARGET_AND_DECLARATION_REQUIRED");
  if (mode !== "TRIPLE" && command.declaredCardType) fail("DECLARATION_NOT_ALLOWED");
  if (mode === "SINGLE" && !isSingleFavor && command.targetId) fail("TARGET_NOT_ALLOWED");
  if (command.targetId) {
    const target = state.players[command.targetId];
    if (!target || !target.alive || target.id === command.actorId) fail("INVALID_TARGET");
    if ((isSingleFavor || mode === "PAIR") && target.hand.length === 0) fail("TARGET_HAS_NO_CARDS");
  }
  return {
    actorId: command.actorId,
    turnId: command.turnId,
    cardIds: [...command.cardIds],
    cardType: cards[0]!.type,
    mode,
    targetId: command.targetId,
    declaredCardType: command.declaredCardType,
  };
}

export function createMatch(options: CreateMatchOptions): GameState {
  assertSetupOptions(options);
  let rngState = seedFrom(options.seed);
  const fullDeck = createFullDeck();
  const exploding = fullDeck.filter((card) => card.type === "EXPLODING_KITTEN");
  const defuses = fullDeck.filter((card) => card.type === "DEFUSE");
  let ordinary = fullDeck.filter((card) => card.type !== "EXPLODING_KITTEN" && card.type !== "DEFUSE");
  [ordinary, rngState] = shuffle(ordinary, rngState);
  const players = Object.fromEntries(options.playerIds.map((id, index) => [id, {
    id,
    alive: true,
    conceded: false,
    hand: [defuses[index]!, ...ordinary.slice(index * 7, index * 7 + 7)],
  }]));
  const dealt = options.playerIds.length * 7;
  const extraDefuseCount = options.playerIds.length === 5 ? 1 : 2;
  let deck = [
    ...ordinary.slice(dealt),
    ...defuses.slice(options.playerIds.length, options.playerIds.length + extraDefuseCount),
    ...exploding.slice(0, options.playerIds.length - 1),
  ];
  [deck, rngState] = shuffle(deck, rngState);
  const removed = [
    ...defuses.slice(options.playerIds.length + extraDefuseCount),
    ...exploding.slice(options.playerIds.length - 1),
  ];
  if (!options.firstPlayerId) {
    let pick: number;
    [pick, rngState] = nextRandom(rngState);
    options = { ...options, firstPlayerId: options.playerIds[Math.floor(pick * options.playerIds.length)] };
  }
  const now = options.now ?? 0;
  const config = {
    turnDurationMs: options.turnDurationMs ?? 45_000,
    responseWindowMs: options.responseWindowMs ?? 5_000,
    choiceDurationMs: options.choiceDurationMs ?? 15_000,
  };
  const firstTurn: TurnBatch = {
    id: "turn-1",
    playerId: options.firstPlayerId!,
    remaining: 1,
    source: "NORMAL",
    deadlineId: "deadline-turn-1",
    deadline: now + config.turnDurationMs,
  };
  const events: DomainEvent[] = [
    { sequence: 1, type: "MATCH_STARTED", playerIds: [...options.playerIds], rulesetVersion: RULESET_VERSION },
    { sequence: 2, type: "TURN_STARTED", playerId: firstTurn.playerId, turnId: firstTurn.id, remaining: 1, source: "NORMAL" },
  ];
  return {
    rulesetVersion: RULESET_VERSION,
    kernelVersion: KERNEL_VERSION,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    prngVersion: PRNG_VERSION,
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    matchId: options.matchId ?? "match-1",
    status: "ACTIVE",
    order: [...options.playerIds],
    players,
    deck,
    discard: [],
    removed,
    eliminatedZone: [],
    turn: firstTurn,
    pending: null,
    privatePeeks: {},
    rngState,
    turnNumber: 1,
    sequence: 2,
    events,
    commandResults: {},
    nextId: 2,
    clock: now,
    config,
  };
}

function applyPlayerCommand(state: GameState, command: Exclude<Command, { type: "DeadlineElapsed" }>): void {
  const player = state.players[command.actorId];
  if (!player || !player.alive) fail("PLAYER_NOT_ACTIVE");
  if (command.type === "Concede") {
    eliminateConcedingPlayer(state, player.id);
    return;
  }
  if (command.type === "Draw") {
    if (state.pending) fail("INTERACTION_PENDING");
    if (!state.turn || state.turn.id !== command.turnId) fail("STALE_TURN");
    drawForCurrentTurn(state, command.actorId);
    return;
  }
  if (command.type === "PlayCards") {
    if (state.pending) fail("INTERACTION_PENDING");
    const action = validateAction(state, command);
    for (const cardId of action.cardIds) state.discard.push(removeOwnedCard(player, cardId));
    event(state, "CARDS_COMMITTED", { actorId: player.id, cardIds: action.cardIds, mode: action.mode, targetId: action.targetId, declaredCardType: action.declaredCardType });
    openResponse(state, action);
    return;
  }
  if (command.type === "PlayNope") {
    const window = state.pending;
    if (!window || window.kind !== "RESPONSE" || window.windowId !== command.windowId) fail("STALE_WINDOW");
    if (window.passedPlayerIds.includes(player.id)) fail("ALREADY_PASSED");
    const nope = removeOwnedCard(player, command.cardId, "NOPE");
    state.discard.push(nope);
    event(state, "NOPE_PLAYED", { playerId: player.id, cardId: nope.id, windowId: window.windowId });
    openResponse(state, window.action, window.nopeCount + 1);
    return;
  }
  if (command.type === "PassResponse") {
    const window = state.pending;
    if (!window || window.kind !== "RESPONSE" || window.windowId !== command.windowId) fail("STALE_WINDOW");
    if (window.passedPlayerIds.includes(player.id)) fail("ALREADY_PASSED");
    window.passedPlayerIds.push(player.id);
    event(state, "RESPONSE_PASSED", { playerId: player.id, windowId: window.windowId });
    if (aliveIds(state).every((id) => window.passedPlayerIds.includes(id))) closeResponse(state, window);
    return;
  }
  if (command.type === "UseDefuse") {
    const prompt = state.pending;
    if (!prompt || prompt.kind !== "EXPLOSION" || prompt.promptId !== command.promptId) fail("STALE_PROMPT");
    if (prompt.playerId !== player.id) fail("NOT_YOUR_PROMPT");
    const defuse = removeOwnedCard(player, command.cardId, "DEFUSE");
    state.discard.push(defuse);
    event(state, "DEFUSE_CONSUMED", { playerId: player.id, cardId: defuse.id });
    const promptId = issueId(state, "insert");
    state.pending = {
      kind: "DEFUSE_INSERTION",
      promptId,
      playerId: player.id,
      explodingCard: prompt.explodingCard,
      deadlineId: `deadline-${promptId}`,
      deadline: state.clock + state.config.choiceDurationMs,
    };
    return;
  }
  if (command.type === "Choose") {
    const prompt = state.pending;
    if (!prompt || !("promptId" in prompt) || prompt.promptId !== command.promptId) fail("STALE_PROMPT");
    if (prompt.kind === "FAVOR_CHOICE") {
      if (prompt.targetId !== player.id) fail("NOT_YOUR_PROMPT");
      const value = typeof command.value === "object" ? command.value.cardId : command.value;
      if (typeof value !== "string") fail("CARD_CHOICE_REQUIRED");
      const card = player.hand.find((held) => held.id === value) ?? fail("CARD_NOT_OWNED");
      transferCard(state, player.id, prompt.requesterId, card, "CARD_GIVEN");
      state.pending = null;
      return;
    }
    if (prompt.kind === "PRIVATE_PEEK") {
      if (prompt.playerId !== player.id) fail("NOT_YOUR_PROMPT");
      const acknowledged = typeof command.value === "object" && "acknowledged" in command.value
        ? Boolean(command.value.acknowledged)
        : false;
      if (!acknowledged) fail("ACKNOWLEDGEMENT_REQUIRED");
      state.privatePeeks[player.id] = [];
      state.pending = null;
      return;
    }
    if (prompt.kind === "DEFUSE_INSERTION") {
      if (prompt.playerId !== player.id) fail("NOT_YOUR_PROMPT");
      const value = typeof command.value === "object" ? command.value.position : command.value;
      if (typeof value !== "number") fail("POSITION_REQUIRED");
      insertExploding(state, player.id, prompt.explodingCard, value);
      return;
    }
    fail("PROMPT_REQUIRES_DIFFERENT_COMMAND");
  }
}

function applyDeadline(state: GameState, command: Extract<Command, { type: "DeadlineElapsed" }>): void {
  const now = command.now ?? state.clock;
  const pending = state.pending;
  if (pending && pending.deadlineId === command.deadlineId) {
    if (now < pending.deadline) fail("DEADLINE_NOT_ELAPSED");
    state.clock = Math.max(state.clock, now);
    if (pending.kind === "RESPONSE") closeResponse(state, pending);
    else if (pending.kind === "FAVOR_CHOICE") {
      const target = state.players[pending.targetId];
      const requester = state.players[pending.requesterId];
      if (target?.alive && requester?.alive && target.hand.length) {
        const card = target.hand[randomIndex(state, target.hand.length)]!;
        transferCard(state, target.id, pending.requesterId, card, "CARD_GIVEN");
      }
      state.pending = null;
    } else if (pending.kind === "EXPLOSION") {
      const player = state.players[pending.playerId];
      if (!player?.alive) {
        state.eliminatedZone.push({ ownerId: pending.playerId, card: pending.explodingCard, faceUp: true });
        state.pending = null;
        return;
      }
      const defuse = player.hand.find((card) => card.type === "DEFUSE");
      if (!defuse) eliminateForExplosion(state, player.id, pending.explodingCard);
      else {
        state.discard.push(removeOwnedCard(player, defuse.id));
        event(state, "DEFUSE_CONSUMED", { playerId: player.id, cardId: defuse.id, automatic: true });
        const position = randomIndex(state, state.deck.length + 1);
        insertExploding(state, player.id, pending.explodingCard, position);
      }
    } else if (pending.kind === "PRIVATE_PEEK") {
      state.privatePeeks[pending.playerId] = [];
      state.pending = null;
    } else {
      const position = randomIndex(state, state.deck.length + 1);
      insertExploding(state, pending.playerId, pending.explodingCard, position);
    }
    return;
  }
  if (state.turn?.deadlineId === command.deadlineId && !state.pending) {
    if (now < state.turn.deadline) fail("DEADLINE_NOT_ELAPSED");
    state.clock = Math.max(state.clock, now);
    drawForCurrentTurn(state, state.turn.playerId);
    return;
  }
  fail("STALE_DEADLINE");
}

export function applyCommand(state: GameState, command: Command): GameState {
  const commandKey = command.type === "DeadlineElapsed"
    ? `deadline:${command.commandId}`
    : `player:${command.actorId}:${command.commandId}`;
  if (Object.prototype.hasOwnProperty.call(state.commandResults, commandKey)) return state;
  if (state.status !== "ACTIVE") fail("MATCH_FINISHED");
  const next = cloneState(state);
  if (command.type === "DeadlineElapsed") applyDeadline(next, command);
  else applyPlayerCommand(next, command);
  validateCardConservation(next);
  next.commandResults[commandKey] = { sequence: next.sequence };
  const resultKeys = Object.keys(next.commandResults);
  if (resultKeys.length > COMMAND_RESULT_LIMIT) {
    for (const key of resultKeys.slice(0, resultKeys.length - COMMAND_RESULT_LIMIT)) delete next.commandResults[key];
  }
  return next;
}

function projectPending(state: GameState, viewerId: string): PendingView | null {
  const pending = state.pending;
  if (!pending) return null;
  if (pending.kind === "RESPONSE") return {
    kind: "RESPONSE",
    windowId: pending.windowId,
    actorId: pending.action.actorId,
    cardTypes: pending.action.cardIds.map((id) => state.discard.find((card) => card.id === id)?.type ?? pending.action.cardType),
    nopeCount: pending.nopeCount,
    deadlineId: pending.deadlineId,
    deadline: pending.deadline,
    viewerPassed: pending.passedPlayerIds.includes(viewerId),
    canPass: !pending.passedPlayerIds.includes(viewerId),
  };
  if (pending.kind === "FAVOR_CHOICE") {
    if (pending.targetId === viewerId) return { kind: "FAVOR_CHOICE", promptId: pending.promptId, requesterId: pending.requesterId, targetId: pending.targetId, deadlineId: pending.deadlineId, deadline: pending.deadline };
    return { kind: "WAITING_PRIVATE_CHOICE", playerId: pending.targetId, requesterId: pending.requesterId, deadlineId: pending.deadlineId, deadline: pending.deadline };
  }
  if (pending.kind === "PRIVATE_PEEK") {
    if (pending.playerId === viewerId) return { kind: "PRIVATE_PEEK", promptId: pending.promptId, playerId: pending.playerId, cards: [...pending.cards], deadlineId: pending.deadlineId, deadline: pending.deadline };
    return { kind: "WAITING_PRIVATE_CHOICE", playerId: pending.playerId, deadlineId: pending.deadlineId, deadline: pending.deadline };
  }
  if (pending.kind === "EXPLOSION") {
    if (pending.playerId === viewerId) return { kind: "EXPLOSION", promptId: pending.promptId, playerId: pending.playerId, deadlineId: pending.deadlineId, deadline: pending.deadline };
    return { kind: "WAITING_PRIVATE_CHOICE", playerId: pending.playerId, deadlineId: pending.deadlineId, deadline: pending.deadline };
  }
  if (pending.playerId === viewerId) return { kind: "DEFUSE_INSERTION", promptId: pending.promptId, playerId: pending.playerId, deadlineId: pending.deadlineId, deadline: pending.deadline };
  return { kind: "WAITING_PRIVATE_CHOICE", playerId: pending.playerId, deadlineId: pending.deadlineId, deadline: pending.deadline };
}

export function projectView(state: GameState, viewerId: string): PlayerView {
  const viewer = state.players[viewerId];
  if (!viewer) fail("UNKNOWN_VIEWER");
  return {
    rulesetVersion: state.rulesetVersion,
    matchId: state.matchId,
    sequence: state.sequence,
    turnNumber: Number.isSafeInteger(state.turnNumber) && state.turnNumber > 0 ? state.turnNumber : 1,
    status: state.status,
    winnerId: state.winnerId,
    you: { id: viewer.id, alive: viewer.alive, hand: [...viewer.hand] },
    players: state.order.map((id) => ({ id, alive: state.players[id]!.alive, handCount: state.players[id]!.hand.length })),
    deckCount: state.deck.length,
    discard: [...state.discard],
    eliminatedZone: state.eliminatedZone.map((entry) => ({
      ownerId: entry.ownerId,
      faceUp: entry.faceUp,
      ...(entry.faceUp || entry.ownerId === viewerId ? { card: entry.card } : {}),
    })),
    turn: state.turn ? { ...state.turn } : null,
    pending: projectPending(state, viewerId),
    privatePeek: [...(state.privatePeeks[viewerId] ?? [])],
  };
}

export function legalActions(state: GameState, actorId: string): LegalAction[] {
  const player = state.players[actorId];
  if (!player?.alive || state.status !== "ACTIVE") return [];
  const actions: LegalAction[] = [{ type: "Concede" }];
  const pending = state.pending;
  if (pending?.kind === "RESPONSE") {
    if (pending.passedPlayerIds.includes(actorId)) return actions;
    actions.push({ type: "PassResponse", windowId: pending.windowId });
    for (const card of player.hand.filter((held) => held.type === "NOPE")) actions.push({ type: "PlayNope", windowId: pending.windowId, cardIds: [card.id] });
    return actions;
  }
  if (pending?.kind === "EXPLOSION" && pending.playerId === actorId) {
    for (const card of player.hand.filter((held) => held.type === "DEFUSE")) actions.push({ type: "UseDefuse", promptId: pending.promptId, cardIds: [card.id] });
    return actions;
  }
  if (pending?.kind === "FAVOR_CHOICE" && pending.targetId === actorId) return [
    { type: "Concede" },
    ...player.hand.map((card) => ({ type: "Choose" as const, promptId: pending.promptId, cardIds: [card.id] })),
  ];
  if (pending?.kind === "PRIVATE_PEEK" && pending.playerId === actorId) return [{ type: "Concede" }, { type: "Choose", promptId: pending.promptId }];
  if (pending?.kind === "DEFUSE_INSERTION" && pending.playerId === actorId) return [{ type: "Concede" }, { type: "Choose", promptId: pending.promptId }];
  if (pending || state.turn?.playerId !== actorId) return actions;
  actions.push({ type: "Draw", turnId: state.turn.id });
  const hasTargetWithCards = state.order.some((id) => id !== actorId && state.players[id]!.alive && state.players[id]!.hand.length > 0);
  for (const card of player.hand.filter((held) => SINGLE_ACTIONS.has(held.type))) {
    if (card.type !== "FAVOR" || hasTargetWithCards) {
      actions.push({ type: "PlayCards", turnId: state.turn.id, cardIds: [card.id] });
    }
  }
  const grouped = new Map<CardType, Card[]>();
  for (const card of player.hand.filter((held) => held.type !== "EXPLODING_KITTEN")) grouped.set(card.type, [...(grouped.get(card.type) ?? []), card]);
  for (const cards of grouped.values()) {
    if (hasTargetWithCards) {
      for (let left = 0; left < cards.length; left += 1) {
        for (let right = left + 1; right < cards.length; right += 1) {
          actions.push({ type: "PlayCards", turnId: state.turn.id, cardIds: [cards[left]!.id, cards[right]!.id] });
        }
      }
    }
    for (let first = 0; first < cards.length; first += 1) {
      for (let second = first + 1; second < cards.length; second += 1) {
        for (let third = second + 1; third < cards.length; third += 1) {
          actions.push({ type: "PlayCards", turnId: state.turn.id, cardIds: [cards[first]!.id, cards[second]!.id, cards[third]!.id] });
        }
      }
    }
  }
  return actions;
}

export function createBotCommand(state: GameState, botId: string): Command | null {
  const player = state.players[botId];
  if (!player?.alive || state.status !== "ACTIVE") return null;
  const commandId = `bot-${botId}-${state.sequence + 1}`;
  const pending = state.pending;
  if (pending?.kind === "RESPONSE") return { type: "PassResponse", commandId, actorId: botId, windowId: pending.windowId };
  if (pending?.kind === "EXPLOSION" && pending.playerId === botId) {
    const defuse = player.hand.find((card) => card.type === "DEFUSE");
    return defuse ? { type: "UseDefuse", commandId, actorId: botId, promptId: pending.promptId, cardId: defuse.id } : null;
  }
  if (pending?.kind === "DEFUSE_INSERTION" && pending.playerId === botId) return {
    type: "Choose",
    commandId,
    actorId: botId,
    promptId: pending.promptId,
    value: Math.floor(state.deck.length / 2),
  };
  if (pending?.kind === "FAVOR_CHOICE" && pending.targetId === botId && player.hand[0]) return {
    type: "Choose",
    commandId,
    actorId: botId,
    promptId: pending.promptId,
    value: player.hand[0].id,
  };
  if (pending?.kind === "PRIVATE_PEEK" && pending.playerId === botId) return {
    type: "Choose",
    commandId,
    actorId: botId,
    promptId: pending.promptId,
    value: { acknowledged: true },
  };
  if (!pending && state.turn?.playerId === botId) return { type: "Draw", commandId, actorId: botId, turnId: state.turn.id };
  return null;
}
