import {
  applyCommand,
  createBotCommand,
  type GameCommand,
  type GameState,
} from "@exploding-kitty/game-core";
import { ServiceError, toProblem } from "../errors.js";
import { canonicalFingerprint } from "../fingerprint.js";
import type {
  AuditEvent,
  AuthContext,
  CommandReceipt,
  MatchRecord,
  MatchSnapshot,
  RoomRecord,
  RoomSnapshot,
} from "../model.js";
import type { Clock, IdGenerator } from "../runtime.js";
import type { GameStore, MatchTransaction } from "../persistence/store.js";
import type { MatchAction, MatchCommandEnvelope } from "./actions.js";
import {
  currentDeadline,
  projectMatch,
  reconcileCardTokens,
  resolveOwnedToken,
} from "./projection.js";

type Dependencies = Readonly<{
  store: GameStore;
  clock: Clock;
  token: IdGenerator;
}>;

function commandFromAction(
  action: MatchAction,
  commandId: string,
  actorId: string,
  match: MatchRecord,
): Exclude<GameCommand, { type: "DeadlineElapsed" }> {
  const base = { commandId, actorId };
  switch (action.type) {
    case "Draw":
      return { ...base, type: "Draw", turnId: action.turnId };
    case "PlayCards":
      return {
        ...base,
        type: "PlayCards",
        turnId: action.turnId,
        cardIds: action.cardTokens.map((token) => resolveOwnedToken(match.tokens, actorId, token)),
        targetId: action.targetId,
        declaredCardType: action.declaredCardType,
      };
    case "PlayNope":
      return {
        ...base,
        type: "PlayNope",
        windowId: action.windowId,
        cardId: resolveOwnedToken(match.tokens, actorId, action.cardToken),
      };
    case "PassResponse":
      return { ...base, type: "PassResponse", windowId: action.windowId };
    case "ChooseCard":
      return {
        ...base,
        type: "Choose",
        promptId: action.promptId,
        value: { cardId: resolveOwnedToken(match.tokens, actorId, action.cardToken) },
      };
    case "AcknowledgePeek":
      return { ...base, type: "Choose", promptId: action.promptId, value: { acknowledged: true } };
    case "UseDefuse":
      return {
        ...base,
        type: "UseDefuse",
        promptId: action.promptId,
        cardId: resolveOwnedToken(match.tokens, actorId, action.cardToken),
      };
    case "InsertKitten":
      return { ...base, type: "Choose", promptId: action.promptId, value: { position: action.position } };
    case "Concede":
      return { ...base, type: "Concede" };
  }
}

function sanitizeAudit(previous: GameState, next: GameState, revision: number, now: number): readonly AuditEvent[] {
  return next.events
    .filter((event) => event.sequence > previous.sequence)
    .map((event) => ({
      matchId: next.matchId,
      revision,
      sequence: event.sequence,
      type: event.type,
      actorId: typeof event.actorId === "string"
        ? event.actorId
        : typeof event.playerId === "string" ? event.playerId : undefined,
      createdAt: now,
    }));
}

function runBots(state: GameState, room: RoomRecord): GameState {
  let next = state;
  let guard = 0;
  while (next.status === "ACTIVE" && guard++ < 200) {
    let actorId: string | undefined;
    if (next.pending?.kind === "RESPONSE") {
      const response = next.pending;
      actorId = next.order.find((id) => {
        const profile = room.members.find((entry) => entry.id === id);
        return profile?.bot && !response.passedPlayerIds.includes(id);
      });
    } else if (next.pending?.kind === "FAVOR_CHOICE") {
      actorId = next.pending.targetId;
    } else if (next.pending && "playerId" in next.pending) {
      actorId = next.pending.playerId;
    } else {
      actorId = next.turn?.playerId;
    }
    if (!actorId || !room.members.find((entry) => entry.id === actorId)?.bot) break;
    const command = createBotCommand(next, actorId);
    if (!command) break;
    next = applyCommand(next, command);
  }
  if (guard >= 200) throw new ServiceError("BOT_LOOP_GUARD", "Bot execution did not reach a player decision", true);
  return next;
}

export class MatchCoordinator {
  readonly #store: GameStore;
  readonly #clock: Clock;
  readonly #token: IdGenerator;

  constructor(dependencies: Dependencies) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#token = dependencies.token;
  }

  async execute(auth: AuthContext, envelope: MatchCommandEnvelope): Promise<CommandReceipt> {
    const room = await this.#roomForSession(envelope.sessionId);
    if (!room.matchId) throw new ServiceError("MATCH_NOT_STARTED");
    if (!room.members.some((entry) => entry.id === auth.playerId && !entry.bot)) {
      throw new ServiceError("NOT_ROOM_MEMBER");
    }
    const now = this.#clock.now();
    const actionFingerprint = canonicalFingerprint(envelope.action);
    const receipt = await this.#store.transactMatch(room.matchId, async (transaction) => {
      const duplicate = await transaction.findReceipt(auth.playerId, envelope.commandId);
      if (duplicate) {
        // Rows written before migration 002 have no fingerprint. They remain
        // safely deduplicated; every newly written receipt enforces payload identity.
        if (duplicate.fingerprint && duplicate.fingerprint !== actionFingerprint) {
          return {
            ok: false as const,
            commandId: envelope.commandId,
            revision: transaction.match.revision,
            problem: { code: "COMMAND_ID_REUSED", message: "Command id was already used for a different action", retryable: false },
          };
        }
        return duplicate.receipt;
      }

      if (envelope.expectedRevision !== transaction.match.revision) {
        return this.#recordFailure(transaction, auth.playerId, envelope.commandId, actionFingerprint, {
          code: "REVISION_CONFLICT",
          message: "Client snapshot is stale; resume before retrying",
          retryable: true,
        }, now);
      }

      try {
        const current = transaction.match;
        const clockedState = structuredClone(current.state);
        clockedState.clock = Math.max(clockedState.clock, now);
        const command = commandFromAction(envelope.action, envelope.commandId, auth.playerId, current);
        const playerState = applyCommand(clockedState, command);
        const fullNextState = runBots(playerState, room);
        const revision = current.revision + 1;
        const nextMatch: MatchRecord = {
          ...current,
          revision,
          state: fullNextState,
          tokens: reconcileCardTokens(current.tokens, fullNextState, this.#token),
          deadline: currentDeadline(fullNextState),
          updatedAt: now,
        };
        const receipt: CommandReceipt = { ok: true, commandId: envelope.commandId, revision };
        await transaction.saveMatch(nextMatch);
        await transaction.saveReceipt({
          matchId: current.id,
          actorId: auth.playerId,
          commandId: envelope.commandId,
          fingerprint: actionFingerprint,
          receipt,
          createdAt: now,
        });
        await transaction.appendAudit(sanitizeAudit(current.state, fullNextState, revision, now));
        return receipt;
      } catch (error) {
        return this.#recordFailure(transaction, auth.playerId, envelope.commandId, actionFingerprint, toProblem(error), now);
      }
    });
    if (receipt.ok) await this.#trySyncRoomStatus(room.id, room.matchId);
    return receipt;
  }

  async resume(auth: AuthContext, sessionId: string): Promise<RoomSnapshot> {
    const room = await this.#roomForSession(sessionId);
    if (!room.members.some((entry) => entry.id === auth.playerId)) throw new ServiceError("NOT_ROOM_MEMBER");
    if (!room.matchId) throw new ServiceError("MATCH_NOT_STARTED");
    const match = await this.#store.getMatch(room.matchId);
    if (!match) throw new ServiceError("MATCH_NOT_FOUND");
    return { revision: match.revision, snapshot: projectMatch(match, room, auth.playerId, this.#clock.now()) };
  }

  async snapshots(sessionId: string): Promise<ReadonlyMap<string, MatchSnapshot>> {
    const room = await this.#roomForSession(sessionId);
    if (!room.matchId) throw new ServiceError("MATCH_NOT_STARTED");
    const match = await this.#store.getMatch(room.matchId);
    if (!match) throw new ServiceError("MATCH_NOT_FOUND");
    const now = this.#clock.now();
    return new Map(room.members
      .filter((entry) => !entry.bot)
      .map((entry) => [entry.id, projectMatch(match, room, entry.id, now)]));
  }

  async executeDeadline(matchId: string, deadlineId: string, deadlineAt: number): Promise<number> {
    const now = this.#clock.now();
    const revision = await this.#store.transactMatch(matchId, async (transaction) => {
      const current = transaction.match;
      if (current.deadline?.deadlineId !== deadlineId || current.deadline.deadlineAt !== deadlineAt) {
        return current.revision;
      }
      if (deadlineAt > now) return current.revision;
      const systemActor = "__system__";
      const commandId = `timer:${matchId}:${deadlineId}`;
      const duplicate = await transaction.findReceipt(systemActor, commandId);
      if (duplicate) return duplicate.receipt.revision;
      const room = await this.#store.getRoomById(current.roomId);
      if (!room) throw new ServiceError("ROOM_NOT_FOUND");
      const fullNextState = runBots(applyCommand(current.state, {
        type: "DeadlineElapsed",
        commandId,
        deadlineId,
        now,
      }), room);
      const revision = current.revision + 1;
      const nextMatch: MatchRecord = {
        ...current,
        revision,
        state: fullNextState,
        tokens: reconcileCardTokens(current.tokens, fullNextState, this.#token),
        deadline: currentDeadline(fullNextState),
        updatedAt: now,
      };
      const receipt: CommandReceipt = { ok: true, commandId, revision };
      await transaction.saveMatch(nextMatch);
      await transaction.saveReceipt({ matchId, actorId: systemActor, commandId, fingerprint: canonicalFingerprint({ type: "DeadlineElapsed", deadlineId, deadlineAt }), receipt, createdAt: now });
      await transaction.appendAudit(sanitizeAudit(current.state, fullNextState, revision, now));
      return revision;
    });
    const match = await this.#store.getMatch(matchId);
    if (match) await this.#trySyncRoomStatus(match.roomId, matchId);
    return revision;
  }

  async #recordFailure(
    transaction: MatchTransaction,
    actorId: string,
    commandId: string,
    actionFingerprint: string,
    problem: { code: string; message: string; retryable: boolean },
    now: number,
  ): Promise<CommandReceipt> {
    const receipt: CommandReceipt = {
      ok: false,
      commandId,
      revision: transaction.match.revision,
      problem,
    };
    await transaction.saveReceipt({
      matchId: transaction.match.id,
      actorId,
      commandId,
      fingerprint: actionFingerprint,
      receipt,
      createdAt: now,
    });
    return receipt;
  }

  async #roomForSession(sessionId: string): Promise<RoomRecord> {
    const direct = await this.#store.getRoomById(sessionId);
    if (direct) return direct;
    const match = await this.#store.getMatch(sessionId);
    if (!match) throw new ServiceError("SESSION_NOT_FOUND");
    const room = await this.#store.getRoomById(match.roomId);
    if (!room) throw new ServiceError("ROOM_NOT_FOUND");
    return room;
  }

  async #syncRoomStatus(roomId: string, matchId: string): Promise<void> {
    const match = await this.#store.getMatch(matchId);
    if (match?.state.status !== "FINISHED") return;
    try {
      await this.#store.transactRoom(roomId, async (transaction) => {
        const room = transaction.room;
        if (room.matchId !== matchId || room.status === "FINISHED") return;
        await transaction.saveRoom({ ...room, status: "FINISHED", revision: Math.max(room.revision, match.revision) });
      });
    } catch (error) {
      if (!(error instanceof ServiceError && error.code === "ROOM_NOT_FOUND")) throw error;
    }
  }

  async #trySyncRoomStatus(roomId: string, matchId: string): Promise<void> {
    try {
      await this.#syncRoomStatus(roomId, matchId);
    } catch {
      // Match state and its durable receipt have already committed. Room status
      // is a derived convenience field, so a follow-up write failure must not
      // turn the authoritative command into a failure or poison its retry result.
    }
  }
}
