import { ServiceError } from "../errors.js";
import type { AuditEvent, DeadlineRecord, MatchRecord, RoomAuditEvent, RoomRecord, StoredReceipt, StoredRoomReceipt, StoredSessionCommandReceipt } from "../model.js";
import type { GameStore, MatchTransaction, RoomTransaction } from "./store.js";

type Lock = { tail: Promise<void>; pending: number };

export class MemoryGameStore implements GameStore {
  readonly #rooms = new Map<string, RoomRecord>();
  readonly #roomCodes = new Map<string, string>();
  readonly #matches = new Map<string, MatchRecord>();
  readonly #receipts = new Map<string, StoredReceipt>();
  readonly #roomReceipts = new Map<string, StoredRoomReceipt>();
  readonly #commandReceipts = new Map<string, StoredSessionCommandReceipt>();
  readonly #playerRevisions = new Map<string, { revision: number; cursor: string }>();
  readonly #audit: AuditEvent[] = [];
  readonly #roomAudit: RoomAuditEvent[] = [];
  readonly #locks = new Map<string, Lock>();
  readonly #claimedDeadlines = new Set<string>();

  async createRoom(room: RoomRecord, audit?: readonly RoomAuditEvent[]): Promise<void> {
    if (this.#rooms.has(room.id) || this.#roomCodes.has(room.code)) throw new ServiceError("ROOM_ALREADY_EXISTS");
    if ([...this.#rooms.values()].some((entry) => entry.members.some((member) => !member.bot && room.members.some((candidate) => !candidate.bot && candidate.id === member.id)))) {
      throw new ServiceError("ALREADY_IN_ROOM");
    }
    this.#rooms.set(room.id, structuredClone(room));
    this.#roomCodes.set(room.code, room.id);
    if (audit) this.#roomAudit.push(...structuredClone(audit));
  }

  async createRoomWithMatch(room: RoomRecord, match: MatchRecord, audit?: readonly RoomAuditEvent[]): Promise<void> {
    if (room.status !== "ACTIVE" || room.matchId !== match.id || match.roomId !== room.id) {
      throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
    }
    if (this.#rooms.has(room.id) || this.#roomCodes.has(room.code)) throw new ServiceError("ROOM_ALREADY_EXISTS");
    if (this.#matches.has(match.id)) throw new ServiceError("MATCH_ALREADY_EXISTS");
    if ([...this.#rooms.values()].some((entry) => entry.members.some((member) => !member.bot && room.members.some((candidate) => !candidate.bot && candidate.id === member.id)))) {
      throw new ServiceError("ALREADY_IN_ROOM");
    }
    const storedRoom = structuredClone(room);
    const storedMatch = structuredClone(match);
    this.#rooms.set(room.id, storedRoom);
    this.#roomCodes.set(room.code, room.id);
    this.#matches.set(match.id, storedMatch);
    if (audit) this.#roomAudit.push(...structuredClone(audit));
  }

  async getRoomById(roomId: string): Promise<RoomRecord | null> {
    const room = this.#rooms.get(roomId);
    return room ? structuredClone(room) : null;
  }

  async getRoomByCode(code: string): Promise<RoomRecord | null> {
    const id = this.#roomCodes.get(code);
    return id ? this.getRoomById(id) : null;
  }

  async getRoomForPlayer(playerId: string): Promise<RoomRecord | null> {
    const room = [...this.#rooms.values()].find((entry) => entry.members.some((member) => member.id === playerId));
    return room ? structuredClone(room) : null;
  }

  async getPlayerRevision(playerId: string): Promise<number> {
    return this.#playerRevisions.get(playerId)?.revision ?? 0;
  }

  async observePlayerSnapshot(playerId: string, cursor: string, initialRevision = 0): Promise<number> {
    const current = this.#playerRevisions.get(playerId);
    if (!current) {
      this.#playerRevisions.set(playerId, { revision: initialRevision, cursor });
      return initialRevision;
    }
    if (current.cursor === cursor) return current.revision;
    const next = { revision: current.revision + 1, cursor };
    this.#playerRevisions.set(playerId, next);
    return next.revision;
  }

  async findCommandReceipt(actorId: string, commandId: string): Promise<StoredSessionCommandReceipt | null> {
    const value = this.#commandReceipts.get(`${actorId}:${commandId}`);
    return value ? structuredClone(value) : null;
  }

  async saveCommandReceipt(receipt: StoredSessionCommandReceipt): Promise<void> {
    const key = `${receipt.actorId}:${receipt.commandId}`;
    if (!this.#commandReceipts.has(key)) this.#commandReceipts.set(key, structuredClone(receipt));
  }

  async saveRoom(room: RoomRecord): Promise<void> {
    await this.transactRoom(room.id, async (transaction) => { await transaction.saveRoom(room); });
  }

  async deleteRoom(roomId: string): Promise<void> {
    if (!this.#rooms.has(roomId)) return;
    await this.transactRoom(roomId, async (transaction) => {
      if (transaction.room.status === "LOBBY" && !transaction.room.matchId) await transaction.deleteRoom();
    });
  }

  async transactRoom<T>(roomId: string, operation: (transaction: RoomTransaction) => Promise<T>): Promise<T> {
    return this.#withLock(`room:${roomId}`, async () => {
      const current = this.#rooms.get(roomId);
      if (!current) throw new ServiceError("ROOM_NOT_FOUND");
      let stagedRoom = structuredClone(current);
      let deleted = false;
      const stagedMatches = new Map<string, MatchRecord>();
      const stagedRoomReceipts: StoredRoomReceipt[] = [];
      const stagedRoomAudit: RoomAuditEvent[] = [];
      const transaction: RoomTransaction = {
        get room() { return structuredClone(stagedRoom); },
        getMatch: async (matchId) => {
          const match = stagedMatches.get(matchId) ?? this.#matches.get(matchId);
          return match ? structuredClone(match) : null;
        },
        saveRoom: async (room) => {
          if (room.id !== roomId) throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
          stagedRoom = structuredClone(room);
          deleted = false;
        },
        deleteRoom: async () => {
          if (stagedRoom.status !== "LOBBY" || stagedRoom.matchId) throw new ServiceError("ROOM_DELETE_CONFLICT");
          deleted = true;
        },
        createMatch: async (match) => {
          if (match.roomId !== roomId) throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
          if (stagedMatches.has(match.id) || this.#matches.has(match.id)) throw new ServiceError("MATCH_ALREADY_EXISTS");
          stagedMatches.set(match.id, structuredClone(match));
        },
        findReceipt: async (actorId, commandId) => {
          const key = `${roomId}:${actorId}:${commandId}`;
          const staged = stagedRoomReceipts.find((entry) => `${entry.roomId}:${entry.actorId}:${entry.commandId}` === key);
          if (staged) return structuredClone(staged);
          const committed = this.#roomReceipts.get(key);
          return committed ? structuredClone(committed) : null;
        },
        saveReceipt: async (receipt) => {
          if (receipt.roomId !== roomId) throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
          stagedRoomReceipts.push(structuredClone(receipt));
        },
        appendAudit: async (events) => { stagedRoomAudit.push(...structuredClone(events)); },
      };
      const result = await operation(transaction);
      if (deleted) {
        this.#rooms.delete(roomId);
        this.#roomCodes.delete(current.code);
      } else {
        const realPlayerIds = new Set(stagedRoom.members.filter((member) => !member.bot).map((member) => member.id));
        const occupied = [...this.#rooms.values()].some((room) => room.id !== roomId
          && room.members.some((member) => !member.bot && realPlayerIds.has(member.id)));
        if (occupied) throw new ServiceError("ALREADY_IN_ROOM");
        if (current.code !== stagedRoom.code) this.#roomCodes.delete(current.code);
        this.#rooms.set(roomId, structuredClone(stagedRoom));
        this.#roomCodes.set(stagedRoom.code, roomId);
      }
      for (const [matchId, match] of stagedMatches) this.#matches.set(matchId, structuredClone(match));
      for (const receipt of stagedRoomReceipts) {
        this.#roomReceipts.set(`${receipt.roomId}:${receipt.actorId}:${receipt.commandId}`, structuredClone(receipt));
      }
      this.#roomAudit.push(...stagedRoomAudit);
      return result;
    });
  }

  async createMatch(match: MatchRecord): Promise<void> {
    if (this.#matches.has(match.id)) throw new ServiceError("MATCH_ALREADY_EXISTS");
    this.#matches.set(match.id, structuredClone(match));
  }

  async getMatch(matchId: string): Promise<MatchRecord | null> {
    const match = this.#matches.get(matchId);
    return match ? structuredClone(match) : null;
  }

  async transactMatch<T>(matchId: string, operation: (transaction: MatchTransaction) => Promise<T>): Promise<T> {
    return this.#withLock(`match:${matchId}`, async () => {
      const current = this.#matches.get(matchId);
      if (!current) throw new ServiceError("MATCH_NOT_FOUND");
      let stagedMatch = structuredClone(current);
      const stagedReceipts: StoredReceipt[] = [];
      const stagedAudit: AuditEvent[] = [];
      const transaction: MatchTransaction = {
        get match() { return structuredClone(stagedMatch); },
        findReceipt: async (actorId, commandId) => {
          const key = `${matchId}:${actorId}:${commandId}`;
          const receipt = stagedReceipts.find((entry) => `${entry.matchId}:${entry.actorId}:${entry.commandId}` === key)
            ?? this.#receipts.get(key);
          return receipt ? structuredClone(receipt) : null;
        },
        saveReceipt: async (receipt) => { stagedReceipts.push(structuredClone(receipt)); },
        saveMatch: async (match) => { stagedMatch = structuredClone(match); },
        appendAudit: async (events) => { stagedAudit.push(...structuredClone(events)); },
      };
      const result = await operation(transaction);
      this.#matches.set(matchId, stagedMatch);
      for (const receipt of stagedReceipts) {
        this.#receipts.set(`${receipt.matchId}:${receipt.actorId}:${receipt.commandId}`, receipt);
      }
      this.#audit.push(...stagedAudit);
      return result;
    });
  }

  async claimDueDeadlines(now: number, limit: number): Promise<readonly DeadlineRecord[]> {
    const due = [...this.#matches.values()]
      .map((match) => match.deadline)
      .filter((deadline): deadline is DeadlineRecord => Boolean(deadline && deadline.deadlineAt <= now))
      .filter((deadline) => !this.#claimedDeadlines.has(`${deadline.matchId}:${deadline.deadlineId}`))
      .sort((left, right) => left.deadlineAt - right.deadlineAt)
      .slice(0, limit);
    for (const deadline of due) this.#claimedDeadlines.add(`${deadline.matchId}:${deadline.deadlineId}`);
    return structuredClone(due);
  }

  async releaseDeadline(deadline: DeadlineRecord): Promise<void> {
    this.#claimedDeadlines.delete(`${deadline.matchId}:${deadline.deadlineId}`);
  }

  async healthCheck(): Promise<void> {}
  async close(): Promise<void> {}

  auditEvents(): readonly AuditEvent[] {
    return structuredClone(this.#audit);
  }

  roomAuditEvents(): readonly RoomAuditEvent[] {
    return structuredClone(this.#roomAudit);
  }

  roomReceipts(): readonly StoredRoomReceipt[] {
    return structuredClone([...this.#roomReceipts.values()]);
  }

  async #withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const lock = this.#locks.get(key) ?? { tail: Promise.resolve(), pending: 0 };
    this.#locks.set(key, lock);
    lock.pending += 1;
    const previous = lock.tail;
    let unlock = (): void => undefined;
    lock.tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
      lock.pending -= 1;
      if (lock.pending === 0 && this.#locks.get(key) === lock) this.#locks.delete(key);
    }
  }
}
