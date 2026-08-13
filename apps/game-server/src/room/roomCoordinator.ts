import { createMatch } from "@exploding-kitty/game-core";
import { ServiceError } from "../errors.js";
import { currentDeadline, projectLobby, projectMatch, reconcileCardTokens } from "../match/projection.js";
import type { AuthContext, MatchRecord, RoomRecord, RoomSettings, RoomSnapshot } from "../model.js";
import type { Clock, IdGenerator, RoomCodeGenerator } from "../runtime.js";
import { secureRoomCodes, secureSeed } from "../runtime.js";
import type { GameStore, RoomTransaction } from "../persistence/store.js";

type Dependencies = Readonly<{
  store: GameStore;
  clock: Clock;
  ids: IdGenerator;
  codes?: RoomCodeGenerator;
  seed?: () => Uint8Array;
}>;

function assertMember(room: RoomRecord, playerId: string) {
  const value = room.members.find((entry) => entry.id === playerId);
  if (!value) throw new ServiceError("NOT_ROOM_MEMBER");
  return value;
}

function assertHost(room: RoomRecord, playerId: string): void {
  if (room.ownerId !== playerId) throw new ServiceError("NOT_ROOM_HOST");
}

export class RoomCoordinator {
  readonly #store: GameStore;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #codes: RoomCodeGenerator;
  readonly #seed: () => Uint8Array;

  constructor(dependencies: Dependencies) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#codes = dependencies.codes ?? secureRoomCodes;
    this.#seed = dependencies.seed ?? secureSeed;
  }

  async create(auth: AuthContext, settings: RoomSettings, tutorial = false): Promise<RoomRecord> {
    const existing = await this.#store.getRoomForPlayer(auth.playerId);
    if (existing) throw new ServiceError("ALREADY_IN_ROOM");
    const room: RoomRecord = {
      id: this.#ids.next("room"),
      code: await this.#uniqueCode(),
      ownerId: auth.playerId,
      tutorial,
      settings,
      members: [{
        id: auth.playerId,
        name: auth.displayName || `Player ${auth.playerId.slice(0, 6)}`,
        avatar: auth.avatarUrl,
        bot: false,
        ready: true,
        connected: true,
      }],
      status: "LOBBY",
      revision: 1,
      createdAt: this.#clock.now(),
    };
    await this.#store.createRoom(room);
    return room;
  }

  async join(auth: AuthContext, code: string): Promise<RoomRecord> {
    const current = await this.#store.getRoomForPlayer(auth.playerId);
    if (current) return current;
    const room = await this.#store.getRoomByCode(code.trim().toUpperCase());
    if (!room) throw new ServiceError("ROOM_NOT_FOUND");
    return this.#store.transactRoom(room.id, async (transaction) => {
      const locked = transaction.room;
      const existingMember = locked.members.find((entry) => entry.id === auth.playerId);
      if (existingMember) return locked;
      if (locked.status !== "LOBBY") throw new ServiceError("ROOM_NOT_FOUND");
      if (locked.members.length >= locked.settings.maxPlayers) throw new ServiceError("ROOM_FULL");
      const updated: RoomRecord = {
        ...locked,
        revision: locked.revision + 1,
        members: [...locked.members, {
          id: auth.playerId,
          name: auth.displayName || `Player ${auth.playerId.slice(0, 6)}`,
          avatar: auth.avatarUrl,
          bot: false,
          ready: false,
          connected: true,
        }],
      };
      await transaction.saveRoom(updated);
      return updated;
    });
  }

  async setReady(auth: AuthContext, roomId: string, ready: boolean): Promise<RoomRecord> {
    return this.#update(roomId, (room) => {
      assertMember(room, auth.playerId);
      if (room.status !== "LOBBY") throw new ServiceError("MATCH_ALREADY_STARTED");
      return {
        ...room,
        revision: room.revision + 1,
        members: room.members.map((entry) => entry.id === auth.playerId ? { ...entry, ready } : entry),
      };
    });
  }

  async setConnected(auth: AuthContext, connected: boolean): Promise<RoomRecord | null> {
    const room = await this.#store.getRoomForPlayer(auth.playerId);
    if (!room) return null;
    return this.#update(room.id, (current) => {
      const member = assertMember(current, auth.playerId);
      if (member.connected === connected) return current;
      return {
        ...current,
        revision: current.matchId ? current.revision : current.revision + 1,
        members: current.members.map((entry) => entry.id === auth.playerId ? { ...entry, connected } : entry),
      };
    });
  }

  async addBot(auth: AuthContext, roomId: string): Promise<RoomRecord> {
    return this.#update(roomId, (room) => {
      assertHost(room, auth.playerId);
      if (!room.settings.allowBots) throw new ServiceError("BOTS_DISABLED");
      if (room.status !== "LOBBY") throw new ServiceError("MATCH_ALREADY_STARTED");
      if (room.members.length >= room.settings.maxPlayers) throw new ServiceError("ROOM_FULL");
      const botIndex = room.members.filter((entry) => entry.bot).length + 1;
      return {
        ...room,
        revision: room.revision + 1,
        members: [...room.members, {
          id: this.#ids.next("bot"),
          name: `Bot ${botIndex}`,
          bot: true,
          ready: true,
          connected: true,
        }],
      };
    });
  }

  async removeBot(auth: AuthContext, roomId: string, playerId: string): Promise<RoomRecord> {
    return this.#update(roomId, (room) => {
      assertHost(room, auth.playerId);
      if (room.status !== "LOBBY") throw new ServiceError("MATCH_ALREADY_STARTED");
      const target = room.members.find((entry) => entry.id === playerId);
      if (!target?.bot) throw new ServiceError("BOT_NOT_FOUND");
      return { ...room, revision: room.revision + 1, members: room.members.filter((entry) => entry.id !== playerId) };
    });
  }

  async leave(auth: AuthContext): Promise<RoomSnapshot> {
    const room = await this.#store.getRoomForPlayer(auth.playerId);
    if (!room) return { revision: 0, snapshot: { phase: "HOME", viewerId: auth.playerId, serverTime: this.#clock.now() } };
    return this.#store.transactRoom(room.id, async (transaction) => {
      const locked = transaction.room;
      assertMember(locked, auth.playerId);
      if (locked.status === "ACTIVE") {
        if (!locked.matchId) throw new ServiceError("MATCH_ALREADY_STARTED");
        const match = await transaction.getMatch(locked.matchId);
        if (match?.state.status !== "FINISHED") throw new ServiceError("MATCH_ALREADY_STARTED");
      }
      const members = locked.members.filter((entry) => entry.id !== auth.playerId);
      const nextHumanOwner = members.find((entry) => !entry.bot);
      const revision = locked.revision + 1;
      if (!locked.matchId && !nextHumanOwner) {
        await transaction.deleteRoom();
      } else if (members.length === 0) {
        if (locked.matchId) await transaction.saveRoom({ ...locked, members: [], revision });
        else await transaction.deleteRoom();
      } else {
        const nextOwner = nextHumanOwner ?? members[0]!;
        await transaction.saveRoom({
          ...locked,
          ownerId: locked.ownerId === auth.playerId ? nextOwner.id : locked.ownerId,
          revision,
          members,
        });
      }
      return { revision, snapshot: { phase: "HOME", viewerId: auth.playerId, serverTime: this.#clock.now() } };
    });
  }

  async start(auth: AuthContext, roomId: string): Promise<RoomSnapshot> {
    return this.#startRoom(roomId, auth.playerId, false);
  }

  async startTutorial(auth: AuthContext): Promise<RoomSnapshot> {
    const existing = await this.#store.getRoomForPlayer(auth.playerId);
    if (existing) throw new ServiceError("ALREADY_IN_ROOM");
    const settings: RoomSettings = {
      maxPlayers: 2,
      turnSeconds: 45,
      responseSeconds: 5,
      choiceSeconds: 15,
      allowBots: true,
      rulesetVersion: "original-2025@1",
    };
    const now = this.#clock.now();
    const roomId = this.#ids.next("room");
    const matchId = this.#ids.next("match");
    const members = [{
      id: auth.playerId,
      name: auth.displayName || `Player ${auth.playerId.slice(0, 6)}`,
      avatar: auth.avatarUrl,
      bot: false,
      ready: true,
      connected: true,
    }, {
      id: this.#ids.next("bot"),
      name: "Bot 1",
      bot: true,
      ready: true,
      connected: true,
    }];
    // A fixed tutorial seed guarantees a useful opening hand (Attack, Favor,
    // Skip and See the Future) while the normal rules engine remains authoritative.
    const state = createMatch({
      matchId,
      playerIds: members.map((member) => member.id),
      firstPlayerId: auth.playerId,
      seed: "tutorial-55",
      now,
      turnDurationMs: settings.turnSeconds * 1_000,
      responseWindowMs: settings.responseSeconds * 1_000,
      choiceDurationMs: settings.choiceSeconds * 1_000,
    });
    const revision = 3;
    const match: MatchRecord = {
      id: matchId,
      roomId,
      revision,
      state,
      tokens: reconcileCardTokens([], state, this.#ids),
      deadline: currentDeadline(state),
      createdAt: now,
      updatedAt: now,
    };
    const room: RoomRecord = {
      id: roomId,
      code: await this.#uniqueCode(),
      ownerId: auth.playerId,
      tutorial: true,
      settings,
      members,
      status: "ACTIVE",
      matchId,
      restartVotes: [],
      revision,
      createdAt: now,
    };
    await this.#store.createRoomWithMatch(room, match);
    return { revision, snapshot: projectMatch(match, room, auth.playerId, now) };
  }

  async restart(auth: AuthContext, roomId: string): Promise<RoomSnapshot> {
    return this.#startRoom(roomId, auth.playerId, true);
  }

  async voteRestart(auth: AuthContext, roomId: string): Promise<RoomSnapshot> {
    return this.#store.transactRoom(roomId, async (transaction) => {
      const room = transaction.room;
      assertMember(room, auth.playerId);
      const previous = await this.#finishedMatch(transaction, room);
      const votes = [...new Set([...(room.restartVotes ?? []), auth.playerId])];
      const revision = Math.max(room.revision, previous.revision) + 1;
      const votedRoom = { ...room, restartVotes: votes, revision };
      await transaction.saveRoom(votedRoom);
      return { revision, snapshot: projectMatch({ ...previous, revision }, votedRoom, auth.playerId, this.#clock.now()) };
    });
  }

  async #startRoom(
    roomId: string,
    viewerId: string,
    restarting: boolean,
    seedOverride?: number | string | Uint8Array,
  ): Promise<RoomSnapshot> {
    return this.#store.transactRoom(roomId, async (transaction) => {
      const room = transaction.room;
      assertHost(room, viewerId);
      let previous: MatchRecord | null = null;
      if (restarting) {
        previous = await this.#finishedMatch(transaction, room);
      } else {
        if (room.status !== "LOBBY" || room.matchId) throw new ServiceError("MATCH_ALREADY_STARTED");
        if (room.members.length < 2) throw new ServiceError("NOT_ENOUGH_PLAYERS");
        if (!room.members.every((entry) => entry.ready)) throw new ServiceError("PLAYERS_NOT_READY");
      }
      const now = this.#clock.now();
      const revision = Math.max(room.revision, previous?.revision ?? 0) + 1;
      const matchId = this.#ids.next("match");
      const state = createMatch({
        matchId,
        playerIds: room.members.map((entry) => entry.id),
        firstPlayerId: room.ownerId,
        seed: seedOverride ?? (room.tutorial ? "tutorial-55" : this.#seed()),
        now,
        turnDurationMs: room.settings.turnSeconds * 1_000,
        responseWindowMs: room.settings.responseSeconds * 1_000,
        choiceDurationMs: room.settings.choiceSeconds * 1_000,
      });
      const match: MatchRecord = {
        id: matchId,
        roomId: room.id,
        revision,
        state,
        tokens: reconcileCardTokens([], state, this.#ids),
        deadline: currentDeadline(state),
        createdAt: now,
        updatedAt: now,
      };
      const activeRoom: RoomRecord = {
        ...room,
        status: "ACTIVE",
        matchId,
        restartVotes: [],
        revision,
      };
      await transaction.createMatch(match);
      await transaction.saveRoom(activeRoom);
      return { revision: match.revision, snapshot: projectMatch(match, activeRoom, viewerId, now) };
    });
  }

  async resume(auth: AuthContext): Promise<RoomSnapshot> {
    const room = await this.#store.getRoomForPlayer(auth.playerId);
    if (!room) return {
      revision: 0,
      snapshot: { phase: "HOME", viewerId: auth.playerId, serverTime: this.#clock.now() },
    };
    if (!room.matchId) return {
      revision: room.revision,
      snapshot: projectLobby(room, auth.playerId, this.#clock.now()),
    };
    const match = await this.#store.getMatch(room.matchId);
    if (!match) throw new ServiceError("MATCH_NOT_FOUND");
    return { revision: match.revision, snapshot: projectMatch(match, room, auth.playerId, this.#clock.now()) };
  }

  async #update(roomId: string, update: (room: RoomRecord) => RoomRecord): Promise<RoomRecord> {
    return this.#store.transactRoom(roomId, async (transaction) => {
      const next = update(transaction.room);
      await transaction.saveRoom(next);
      return next;
    });
  }

  async #finishedMatch(
    transaction: RoomTransaction,
    room: RoomRecord,
  ): Promise<MatchRecord> {
    if (!room.matchId) throw new ServiceError("MATCH_NOT_STARTED");
    const match = await transaction.getMatch(room.matchId);
    if (!match || match.state.status !== "FINISHED") throw new ServiceError("MATCH_NOT_FINISHED");
    return match;
  }

  async #uniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = this.#codes.next().trim().toUpperCase();
      if (!(await this.#store.getRoomByCode(code))) return code;
    }
    throw new ServiceError("ROOM_CODE_EXHAUSTED", "Unable to allocate room code", true);
  }
}
