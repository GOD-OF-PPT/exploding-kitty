import {
  legalActions,
  projectView,
  type Card,
  type GameState,
  type PendingView,
} from "@exploding-kitty/game-core";
import { ServiceError } from "../errors.js";
import type {
  CardTokenRecord,
  MatchRecord,
  MatchSnapshot,
  RoomRecord,
} from "../model.js";
import type { IdGenerator } from "../runtime.js";

export function reconcileCardTokens(
  previous: readonly CardTokenRecord[],
  state: GameState,
  generator: IdGenerator,
): readonly CardTokenRecord[] {
  const prior = new Map(previous.map((entry) => [entry.cardId, entry]));
  const next: CardTokenRecord[] = [];
  for (const player of Object.values(state.players)) {
    for (const card of player.hand) {
      const existing = prior.get(card.id);
      next.push(existing?.ownerId === player.id
        ? existing
        : { token: generator.next("card"), cardId: card.id, ownerId: player.id });
    }
  }
  return next;
}

export function resolveOwnedToken(
  tokens: readonly CardTokenRecord[],
  ownerId: string,
  token: string,
): string {
  const record = tokens.find((entry) => entry.ownerId === ownerId && entry.token === token);
  if (!record) throw new ServiceError("CARD_NOT_OWNED", "Card token is invalid or no longer owned");
  return record.cardId;
}

function member(room: RoomRecord, playerId: string) {
  return room.members.find((entry) => entry.id === playerId);
}

function pendingSnapshot(pending: PendingView | null, deckSize: number, state: GameState) {
  if (!pending) return null;
  const deadlineAt = pending.deadline;
  if (pending.kind === "RESPONSE") {
    const committed = state.pending?.kind === "RESPONSE" && state.pending.windowId === pending.windowId
      ? state.pending.action
      : null;
    return {
      id: pending.windowId,
      kind: "RESPONSE" as const,
      deadlineAt,
      windowId: pending.windowId,
      actorId: pending.actorId,
      cardTypes: pending.cardTypes,
      ...(committed?.targetId ? { targetId: committed.targetId } : {}),
      ...(committed?.declaredCardType ? { declaredCardType: committed.declaredCardType } : {}),
      nopeCount: pending.nopeCount,
      viewerPassed: pending.viewerPassed,
      canPass: pending.canPass,
    };
  }
  if (pending.kind === "FAVOR_CHOICE") return {
    id: pending.promptId,
    kind: "GIVE_CARD" as const,
    deadlineAt,
    promptId: pending.promptId,
    requesterId: pending.requesterId,
    playerId: pending.targetId,
  };
  if (pending.kind === "PRIVATE_PEEK") return {
    id: pending.promptId,
    kind: "PRIVATE_PEEK" as const,
    deadlineAt,
    promptId: pending.promptId,
    playerId: pending.playerId,
    cards: pending.cards.map((card) => ({ type: card.type })),
  };
  if (pending.kind === "EXPLOSION") return {
    id: pending.promptId,
    kind: "EXPLOSION" as const,
    deadlineAt,
    promptId: pending.promptId,
    playerId: pending.playerId,
  };
  if (pending.kind === "DEFUSE_INSERTION") return {
    id: pending.promptId ?? pending.deadlineId,
    kind: "DEFUSE_INSERTION" as const,
    deadlineAt,
    promptId: pending.promptId,
    playerId: pending.playerId,
    deckSize,
  };
  return {
    id: pending.deadlineId,
    kind: "WAITING_PRIVATE_CHOICE" as const,
    deadlineAt,
    playerId: pending.playerId,
    ...(pending.requesterId ? { requesterId: pending.requesterId } : {}),
  };
}

function isTransferParticipant(event: GameState["events"][number], viewerId: string): boolean {
  return event.fromId === viewerId || event.toId === viewerId;
}

const PRIVATE_TRANSFER_EVENT_TYPES = new Set(["CARD_STOLEN", "CARD_GIVEN"]);
const PUBLIC_COMMITTED_CARD_EVENTS = new Set(["CARDS_COMMITTED", "ACTION_CANCELLED", "ACTION_RESOLVED"]);

function publicCommittedCardTypes(state: GameState, event: GameState["events"][number]): readonly Card["type"][] {
  if (!PUBLIC_COMMITTED_CARD_EVENTS.has(event.type) || !Array.isArray(event.cardIds)) return [];
  const discard = new Map(state.discard.map((card) => [card.id, card.type]));
  return event.cardIds
    .map((cardId) => typeof cardId === "string" ? discard.get(cardId) : undefined)
    .filter((cardType): cardType is Card["type"] => Boolean(cardType));
}

function publicEvents(state: GameState, viewerId: string) {
  const publicTypes = new Set([
    "MATCH_STARTED", "TURN_STARTED", "CARDS_COMMITTED", "NOPE_PLAYED", "RESPONSE_PASSED",
    "ACTION_CANCELLED", "ACTION_RESOLVED", "CARD_STOLEN", "CARD_GIVEN", "COMBO_MISSED",
    "CARD_DRAWN", "DECK_SHUFFLED", "EXPLODING_KITTEN_REVEALED", "DEFUSE_CONSUMED", "PLAYER_ELIMINATED", "GAME_FINISHED",
  ]);
  return state.events.filter((event) => publicTypes.has(event.type)).map((event) => {
    const isPrivateTransfer = PRIVATE_TRANSFER_EVENT_TYPES.has(event.type);
    const maySeeCardType = !isPrivateTransfer || isTransferParticipant(event, viewerId);
    const maySeeTransferParticipants = isPrivateTransfer && isTransferParticipant(event, viewerId);
    const committedCardTypes = publicCommittedCardTypes(state, event);
    return {
      sequence: event.sequence,
      type: event.type,
      ...(typeof event.actorId === "string" ? { actorId: event.actorId } : typeof event.playerId === "string" ? { actorId: event.playerId } : maySeeTransferParticipants && typeof event.fromId === "string" ? { actorId: event.fromId } : {}),
      ...(committedCardTypes.length === 1 ? { cardType: committedCardTypes[0] } : event.type !== "CARD_DRAWN" && maySeeCardType && typeof event.cardType === "string" ? { cardType: event.cardType as Card["type"] } : {}),
      ...(committedCardTypes.length ? { cardTypes: committedCardTypes } : {}),
      ...(Array.isArray(event.cardIds) ? { count: event.cardIds.length } : {}),
      ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
      ...(typeof event.targetId === "string" ? { targetId: event.targetId } : {}),
      ...(maySeeTransferParticipants && typeof event.fromId === "string" ? { fromId: event.fromId } : {}),
      ...(maySeeTransferParticipants && typeof event.toId === "string" ? { toId: event.toId } : {}),
      ...(typeof event.declaredCardType === "string" ? { declaredCardType: event.declaredCardType as Card["type"] } : {}),
      ...(typeof event.mode === "string" ? { mode: event.mode } : {}),
      ...(typeof event.winnerId === "string" ? { winnerId: event.winnerId } : {}),
    };
  });
}

function rankings(state: GameState) {
  if (state.status !== "FINISHED" || !state.winnerId) return undefined;
  const eliminations = state.events.filter((event) => event.type === "PLAYER_ELIMINATED");
  const rankByPlayer = new Map<string, { rank: number; reason?: string }>();
  for (const [index, event] of eliminations.entries()) {
    if (typeof event.playerId !== "string") continue;
    rankByPlayer.set(event.playerId, {
      rank: state.order.length - index,
      ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
    });
  }
  return state.order.map((playerId) => playerId === state.winnerId
    ? { playerId, rank: 1 }
    : { playerId, ...(rankByPlayer.get(playerId) ?? { rank: state.order.length, reason: "ELIMINATED" }) });
}

function tokenForCard(tokens: readonly CardTokenRecord[], ownerId: string, card: Card): string {
  const token = tokens.find((entry) => entry.ownerId === ownerId && entry.cardId === card.id)?.token;
  if (!token) throw new ServiceError("TOKEN_INDEX_CORRUPT");
  return token;
}

export function projectMatch(
  match: MatchRecord,
  room: RoomRecord,
  viewerId: string,
  now: number,
): MatchSnapshot {
  const view = projectView(match.state, viewerId);
  const viewerTokens = match.tokens.filter((entry) => entry.ownerId === viewerId);
  const tokenByCard = new Map(viewerTokens.map((entry) => [entry.cardId, entry.token]));
  return {
    phase: view.status === "FINISHED" ? "FINISHED" : "MATCH",
    viewerId,
    serverTime: now,
    room: {
      id: room.id,
      code: room.code,
      ownerId: room.ownerId,
      tutorial: room.tutorial === true,
      maxPlayers: room.settings.maxPlayers,
      allowBots: room.settings.allowBots,
      turnSeconds: room.settings.turnSeconds,
      rulesetVersion: room.settings.rulesetVersion,
    },
    matchId: match.id,
    status: view.status,
    winnerId: view.winnerId,
    you: {
      id: viewerId,
      alive: view.you.alive,
      hand: view.you.hand.map((card) => ({ token: tokenForCard(match.tokens, viewerId, card), type: card.type })),
    },
    players: view.players.map((player) => {
      const profile = member(room, player.id);
      return {
        id: player.id,
        name: profile?.name ?? player.id,
        avatar: profile?.avatar,
        handCount: player.handCount,
        alive: player.alive,
        ready: profile?.ready ?? true,
        bot: profile?.bot ?? false,
        connected: profile?.connected ?? false,
      };
    }),
    restartVotes: room.restartVotes ?? [],
    deckCount: view.deckCount,
    discard: view.discard.map((card) => ({ type: card.type })),
    turn: view.turn ? {
      id: view.turn.id,
      playerId: view.turn.playerId,
      number: Math.max(1, (view as typeof view & { turnNumber?: number }).turnNumber ?? 1),
      remaining: view.turn.remaining,
      direction: "CLOCKWISE",
      deadlineAt: view.turn.deadline,
      deadlineId: view.turn.deadlineId,
    } : null,
    pending: pendingSnapshot(view.pending, view.deckCount, match.state),
    privatePeek: view.privatePeek.map((card) => ({ type: card.type })),
    legalActions: legalActions(match.state, viewerId).map((action) => ({
      type: action.type === "Choose"
        ? view.pending?.kind === "FAVOR_CHOICE" ? "ChooseCard"
          : view.pending?.kind === "PRIVATE_PEEK" ? "AcknowledgePeek"
            : view.pending?.kind === "DEFUSE_INSERTION" ? "InsertKitten" : "Choose"
        : action.type,
      turnId: action.turnId,
      windowId: action.windowId,
      promptId: action.promptId,
      cardTokens: action.cardIds?.map((cardId) => tokenByCard.get(cardId)).filter((token): token is string => Boolean(token)),
    })),
    events: publicEvents(match.state, viewerId),
    rankings: rankings(match.state),
  };
}

export function projectLobby(room: RoomRecord, viewerId: string, now: number): MatchSnapshot {
  return {
    phase: "LOBBY",
    viewerId,
    serverTime: now,
    room: {
      id: room.id,
      code: room.code,
      ownerId: room.ownerId,
      tutorial: room.tutorial === true,
      maxPlayers: room.settings.maxPlayers,
      allowBots: room.settings.allowBots,
      turnSeconds: room.settings.turnSeconds,
      rulesetVersion: room.settings.rulesetVersion,
    },
    players: room.members.map((entry) => ({
      id: entry.id,
      name: entry.name,
      avatar: entry.avatar,
      handCount: 0,
      alive: true,
      ready: entry.ready,
      bot: entry.bot,
      connected: entry.connected,
    })),
  };
}

export function currentDeadline(state: GameState) {
  const source = state.pending ?? state.turn;
  if (!source) return null;
  return {
    matchId: state.matchId,
    deadlineId: source.deadlineId,
    deadlineAt: source.deadline,
  };
}
