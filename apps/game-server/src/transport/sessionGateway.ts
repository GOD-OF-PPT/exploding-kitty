import {
  PROTOCOL_VERSION,
  type ClientAction,
  type ClientCommandEnvelope,
  type CommandAckEnvelope,
  type MatchSnapshotEnvelope,
} from "@exploding-kitty/protocol";
import { ServiceError, toProblem } from "../errors.js";
import type { MatchAction } from "../match/actions.js";
import type { MatchCoordinator } from "../match/matchCoordinator.js";
import type { AuthContext, MatchSnapshot, RoomRecord, RoomSnapshot } from "../model.js";
import type { RoomCoordinator } from "../room/roomCoordinator.js";
import type { GameStore } from "../persistence/store.js";
import type { ConnectionHub } from "./connectionHub.js";

type Dependencies = Readonly<{
  rooms: RoomCoordinator;
  matches: MatchCoordinator;
  store: GameStore;
  hub: ConnectionHub;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

const MATCH_TYPES = new Set<MatchAction["type"]>([
  "Draw", "PlayCards", "PlayNope", "PassResponse", "ChooseCard",
  "AcknowledgePeek", "UseDefuse", "InsertKitten", "Concede",
]);

export class SessionGateway {
  constructor(readonly dependencies: Dependencies) {}

  async resume(auth: AuthContext, sessionId: string): Promise<MatchSnapshotEnvelope<MatchSnapshot>> {
    const resumed = sessionId.startsWith("bootstrap_") || sessionId.startsWith("wx-")
      ? await this.dependencies.rooms.resume(auth)
      : await this.#resumeKnownSession(auth, sessionId);
    return this.#snapshotEnvelope(sessionId, await this.#monotonic(auth.playerId, resumed));
  }

  async command(auth: AuthContext, envelope: ClientCommandEnvelope): Promise<CommandAckEnvelope> {
    let actionFingerprint: string | undefined;
    try {
      const action = envelope.action;
      actionFingerprint = canonical(action);
      if (action.type === "Login") throw new ServiceError("LOGIN_OVER_HTTP_ONLY");
      if (action.type === "UpdateSettings") throw new ServiceError("CLIENT_SETTING_NOT_SERVER_COMMAND");
      if (MATCH_TYPES.has(action.type as MatchAction["type"])) {
        const duplicate = await this.dependencies.store.findCommandReceipt(auth.playerId, envelope.commandId);
        if (duplicate) {
          if (duplicate.fingerprint !== actionFingerprint) throw new ServiceError("COMMAND_ID_REUSED", "Command id was already used for a different action");
          if (duplicate.snapshot) this.dependencies.hub.sendSnapshot(auth.playerId, duplicate.receipt.revision, duplicate.snapshot);
          return duplicate.receipt.ok
            ? { type: "command.ack", protocolVersion: PROTOCOL_VERSION, sessionId: envelope.sessionId, commandId: envelope.commandId, ok: true, revision: duplicate.receipt.revision }
            : { type: "command.ack", protocolVersion: PROTOCOL_VERSION, sessionId: envelope.sessionId, commandId: envelope.commandId, ok: false, problem: duplicate.receipt.problem };
        }
        const room = await this.#roomForPlayerOrSession(auth, envelope.sessionId);
        if (!room) throw new ServiceError("SESSION_NOT_FOUND");
        const current = await this.dependencies.matches.resume(auth, room.id);
        const observed = await this.#monotonic(auth.playerId, current);
        // MatchCoordinator checks its durable, match-local receipt before it
        // checks the physical match revision. Always enter that transaction so
        // a retry can recover after the match commit succeeded but the session
        // receipt write did not. A genuinely new command with a stale logical
        // revision receives the normal REVISION_CONFLICT from that transaction.
        const expectedMatchRevision = envelope.expectedRevision === observed.revision
          ? current.revision
          : -1;
        const receipt = await this.dependencies.matches.execute(auth, {
          sessionId: room.id,
          commandId: envelope.commandId,
          expectedRevision: expectedMatchRevision,
          action: action as MatchAction,
        });
        const snapshot = receipt.ok ? await this.#projectForActor(auth, room.id) : null;
        const publicReceipt = receipt.ok && snapshot ? { ...receipt, revision: snapshot.revision } : receipt;
        const ack = receipt.ok
          ? { type: "command.ack" as const, protocolVersion: PROTOCOL_VERSION, sessionId: envelope.sessionId,
              commandId: envelope.commandId, ok: true as const, revision: snapshot?.revision ?? receipt.revision }
          : { type: "command.ack" as const, protocolVersion: PROTOCOL_VERSION, sessionId: envelope.sessionId,
              commandId: envelope.commandId, ok: false as const, problem: receipt.problem };
        await this.dependencies.store.saveCommandReceipt({ actorId: auth.playerId, commandId: envelope.commandId,
          fingerprint: actionFingerprint, receipt: publicReceipt, ...(snapshot ? { snapshot: snapshot.snapshot } : {}), createdAt: Date.now() });
        if (snapshot) this.dependencies.hub.sendSnapshot(auth.playerId, snapshot.revision, snapshot.snapshot);
        if (receipt.ok) void this.broadcast(room.id).catch(() => undefined);
        return ack;
      }

      const duplicate = await this.dependencies.store.findCommandReceipt(auth.playerId, envelope.commandId);
      if (duplicate) {
        if (duplicate.fingerprint !== actionFingerprint) throw new ServiceError("COMMAND_ID_REUSED", "Command id was already used for a different action");
        if (duplicate.snapshot) this.dependencies.hub.sendSnapshot(auth.playerId, duplicate.receipt.revision, duplicate.snapshot);
        return duplicate.receipt.ok
          ? { type: "command.ack", protocolVersion: PROTOCOL_VERSION, sessionId: envelope.sessionId, commandId: envelope.commandId, ok: true, revision: duplicate.receipt.revision }
          : { type: "command.ack", protocolVersion: PROTOCOL_VERSION, sessionId: envelope.sessionId, commandId: envelope.commandId, ok: false, problem: duplicate.receipt.problem };
      }
      const observed = await this.#monotonic(auth.playerId, await this.dependencies.rooms.resume(auth));
      if (envelope.expectedRevision !== observed.revision) {
        throw new ServiceError("REVISION_CONFLICT", "Client snapshot is stale; resume before retrying", true);
      }
      const roomBefore = await this.#roomForPlayerOrSession(auth, envelope.sessionId);
      const roomSnapshot = await this.#monotonic(auth.playerId, await this.#roomAction(auth, envelope.sessionId, action));
      const receipt = { ok: true as const, commandId: envelope.commandId, revision: roomSnapshot.revision };
      await this.dependencies.store.saveCommandReceipt({ actorId: auth.playerId, commandId: envelope.commandId,
        fingerprint: actionFingerprint, receipt, snapshot: roomSnapshot.snapshot, createdAt: Date.now() });
      this.dependencies.hub.sendSnapshot(auth.playerId, roomSnapshot.revision, roomSnapshot.snapshot);
      void this.broadcast(roomSnapshot.snapshot.room?.id ?? roomBefore?.id ?? envelope.sessionId).catch(() => undefined);
      return { type: "command.ack", protocolVersion: PROTOCOL_VERSION, sessionId: envelope.sessionId,
        commandId: envelope.commandId, ok: true, revision: roomSnapshot.revision };
    } catch (error) {
      const problem = toProblem(error);
      if (actionFingerprint && problem.code !== "COMMAND_ID_REUSED") {
        const revision = await this.dependencies.store.getPlayerRevision(auth.playerId).catch(() => 0);
        await this.dependencies.store.saveCommandReceipt({ actorId: auth.playerId, commandId: envelope.commandId,
          fingerprint: actionFingerprint, receipt: { ok: false, commandId: envelope.commandId, revision, problem }, createdAt: Date.now() })
          .catch(() => undefined);
      }
      return { type: "command.ack", protocolVersion: PROTOCOL_VERSION, sessionId: envelope.sessionId,
        commandId: envelope.commandId, ok: false, problem };
    }
  }

  async broadcast(sessionId: string): Promise<void> {
    const room = await this.#roomForSession(sessionId);
    if (!room) return;
    for (const member of room.members.filter((entry) => !entry.bot)) {
      const auth = { playerId: member.id, sessionToken: "internal" };
      const snapshot = room.matchId
        ? await this.dependencies.matches.resume(auth, room.id)
        : await this.dependencies.rooms.resume(auth);
      const monotonic = await this.#monotonic(member.id, snapshot);
      this.dependencies.hub.sendSnapshot(member.id, monotonic.revision, monotonic.snapshot);
    }
  }

  async #roomAction(auth: AuthContext, sessionId: string, action: ClientAction): Promise<RoomSnapshot> {
    switch (action.type) {
      case "CreateRoom": {
        const room = await this.dependencies.rooms.create(auth, action.settings);
        return this.dependencies.rooms.resume(auth);
      }
      case "JoinRoom": {
        await this.dependencies.rooms.join(auth, action.code);
        return this.dependencies.rooms.resume(auth);
      }
      case "SetReady":
        await this.dependencies.rooms.setReady(auth, await this.#currentRoomId(auth, sessionId), action.ready);
        return this.dependencies.rooms.resume(auth);
      case "AddBot":
        await this.dependencies.rooms.addBot(auth, await this.#currentRoomId(auth, sessionId));
        return this.dependencies.rooms.resume(auth);
      case "RemoveBot":
        await this.dependencies.rooms.removeBot(auth, await this.#currentRoomId(auth, sessionId), action.playerId);
        return this.dependencies.rooms.resume(auth);
      case "StartMatch": return this.dependencies.rooms.start(auth, await this.#currentRoomId(auth, sessionId));
      case "StartTutorial": return this.dependencies.rooms.startTutorial(auth);
      case "LeaveRoom":
        return this.dependencies.rooms.leave(auth);
      case "RestartMatch": return this.dependencies.rooms.restart(auth, await this.#currentRoomId(auth, sessionId));
      case "VoteRestart": return this.dependencies.rooms.voteRestart(auth, await this.#currentRoomId(auth, sessionId));
      default: throw new ServiceError("UNSUPPORTED_ACTION");
    }
  }

  async #resumeKnownSession(auth: AuthContext, sessionId: string): Promise<RoomSnapshot> {
    const room = await this.#roomForPlayerOrSession(auth, sessionId);
    if (room?.matchId) return this.dependencies.matches.resume(auth, room.id);
    return this.dependencies.rooms.resume(auth);
  }

  async #roomForSession(sessionId: string): Promise<RoomRecord | null> {
    const room = await this.dependencies.store.getRoomById(sessionId);
    if (room) return room;
    const match = await this.dependencies.store.getMatch(sessionId);
    return match ? this.dependencies.store.getRoomById(match.roomId) : null;
  }

  async #roomForPlayerOrSession(auth: AuthContext, sessionId: string): Promise<RoomRecord | null> {
    return await this.#roomForSession(sessionId) ?? this.dependencies.store.getRoomForPlayer(auth.playerId);
  }

  async #currentRoomId(auth: AuthContext, sessionId: string): Promise<string> {
    const room = await this.#roomForPlayerOrSession(auth, sessionId);
    if (!room) throw new ServiceError("ROOM_NOT_FOUND");
    return room.id;
  }

  async #projectForActor(auth: AuthContext, roomId: string): Promise<RoomSnapshot> {
    return this.#monotonic(auth.playerId, await this.dependencies.matches.resume(auth, roomId));
  }

  async #monotonic(playerId: string, value: RoomSnapshot): Promise<RoomSnapshot> {
    const { serverTime: _serverTime, ...stableSnapshot } = value.snapshot;
    const cursor = canonical(stableSnapshot);
    const revision = await this.dependencies.store.observePlayerSnapshot(playerId, cursor, value.revision);
    return { revision, snapshot: value.snapshot };
  }

  #snapshotEnvelope(sessionId: string, value: RoomSnapshot): MatchSnapshotEnvelope<MatchSnapshot> {
    return { type: "snapshot", protocolVersion: PROTOCOL_VERSION, sessionId, revision: value.revision, snapshot: value.snapshot };
  }
}
