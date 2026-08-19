import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { ServiceError } from "../errors.js";
import type {
  AuditEvent,
  DeadlineRecord,
  MatchRecord,
  MatchSnapshot,
  RoomAuditEvent,
  RoomMember,
  RoomRecord,
  StoredReceipt,
  StoredRoomReceipt,
  StoredSessionCommandReceipt,
} from "../model.js";
import type { GameStore, MatchTransaction, RoomTransaction } from "./store.js";

type JsonValue = string | object;

type RoomRow = RowDataPacket & {
  id: string;
  code: string;
  owner_id: string;
  status: RoomRecord["status"];
  tutorial: number | boolean;
  settings: JsonValue;
  revision: string | number;
  restart_votes: JsonValue;
  match_id: string | null;
  created_at: Date | string;
};

type MemberRow = RowDataPacket & {
  player_id: string;
  name: string;
  avatar: string | null;
  is_bot: number | boolean;
  ready: number | boolean;
  connected: number | boolean;
  seat: number;
};

type MatchRow = RowDataPacket & {
  id: string;
  room_id: string;
  revision: string | number;
  state: JsonValue;
  card_tokens: JsonValue;
  deadline_id: string | null;
  deadline_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function parseJson<T>(value: JsonValue): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function toDateMilliseconds(value: Date | string): number {
  const text = typeof value === "string" ? value.replace(" ", "T") : "";
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const timestamp = value instanceof Date ? value.getTime() : new Date(hasTimeZone ? text : `${text}Z`).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Invalid MySQL datetime");
  return timestamp;
}

function toMysqlDate(milliseconds: number): Date {
  if (!Number.isSafeInteger(milliseconds)) throw new Error("Invalid timestamp");
  const value = new Date(milliseconds);
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid timestamp");
  return value;
}

function toSafeInteger(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} exceeds JavaScript's safe integer range`);
  return parsed;
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function mapWriteError(error: unknown): unknown {
  const mysqlError = error as { code?: string; errno?: number; message?: string; sql?: string };
  if (mysqlError.code !== "ER_DUP_ENTRY" && mysqlError.errno !== 1062) return error;
  const message = mysqlError.message ?? "";
  if (message.includes("room_members_real_player_unique_idx")) return new ServiceError("ALREADY_IN_ROOM");
  if (message.includes("rooms_code") || mysqlError.sql?.includes("INSERT INTO rooms")) {
    return new ServiceError("ROOM_ALREADY_EXISTS");
  }
  if (mysqlError.sql?.includes("INSERT INTO matches")) return new ServiceError("MATCH_ALREADY_EXISTS");
  return error;
}

function toRoom(row: RoomRow, members: readonly MemberRow[]): RoomRecord {
  return {
    id: row.id,
    code: row.code,
    ownerId: row.owner_id,
    status: row.status,
    tutorial: Boolean(row.tutorial),
    settings: parseJson<RoomRecord["settings"]>(row.settings),
    revision: toSafeInteger(row.revision, "rooms.revision"),
    restartVotes: parseJson<string[]>(row.restart_votes),
    matchId: row.match_id ?? undefined,
    createdAt: toDateMilliseconds(row.created_at),
    members: [...members].sort((left, right) => left.seat - right.seat).map((member): RoomMember => ({
      id: member.player_id,
      name: member.name,
      avatar: member.avatar ?? undefined,
      bot: Boolean(member.is_bot),
      ready: Boolean(member.ready),
      connected: Boolean(member.connected),
    })),
  };
}

function toMatch(row: MatchRow): MatchRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    revision: toSafeInteger(row.revision, "matches.revision"),
    state: parseJson<MatchRecord["state"]>(row.state),
    tokens: parseJson<MatchRecord["tokens"]>(row.card_tokens),
    deadline: row.deadline_id && row.deadline_at
      ? { matchId: row.id, deadlineId: row.deadline_id, deadlineAt: toDateMilliseconds(row.deadline_at) }
      : null,
    createdAt: toDateMilliseconds(row.created_at),
    updatedAt: toDateMilliseconds(row.updated_at),
  };
}

export class MysqlGameStore implements GameStore {
  constructor(readonly pool: Pool) {}

  async createRoom(room: RoomRecord, audit?: readonly RoomAuditEvent[]): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.#insertRoom(connection, room);
      await this.#replaceMembers(connection, room);
      if (audit) await this.#insertRoomEvents(connection, audit);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw mapWriteError(error);
    } finally {
      connection.release();
    }
  }

  async createRoomWithMatch(room: RoomRecord, match: MatchRecord, audit?: readonly RoomAuditEvent[]): Promise<void> {
    if (room.status !== "ACTIVE" || room.matchId !== match.id || match.roomId !== room.id) {
      throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.#insertRoom(connection, room);
      await this.#replaceMembers(connection, room);
      await this.#insertMatch(connection, match);
      if (audit) await this.#insertRoomEvents(connection, audit);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw mapWriteError(error);
    } finally {
      connection.release();
    }
  }

  async getRoomById(roomId: string): Promise<RoomRecord | null> {
    const [rows] = await this.pool.execute<RoomRow[]>("SELECT * FROM rooms WHERE id=?", [roomId]);
    return rows[0] ? this.#loadRoom(rows[0]) : null;
  }

  async getRoomByCode(code: string): Promise<RoomRecord | null> {
    const [rows] = await this.pool.execute<RoomRow[]>("SELECT * FROM rooms WHERE code=?", [code]);
    return rows[0] ? this.#loadRoom(rows[0]) : null;
  }

  async getRoomForPlayer(playerId: string): Promise<RoomRecord | null> {
    const [rows] = await this.pool.execute<RoomRow[]>(
      `SELECT r.* FROM rooms r JOIN room_members rm ON rm.room_id=r.id
       WHERE rm.player_id=? AND rm.is_bot=0 ORDER BY r.created_at DESC LIMIT 1`,
      [playerId],
    );
    return rows[0] ? this.#loadRoom(rows[0]) : null;
  }

  async getPlayerRevision(playerId: string): Promise<number> {
    const [rows] = await this.pool.execute<(RowDataPacket & { revision: string | number })[]>(
      "SELECT revision FROM player_session_revisions WHERE player_id=?",
      [playerId],
    );
    return rows[0] ? toSafeInteger(rows[0].revision, "player_session_revisions.revision") : 0;
  }

  async observePlayerSnapshot(playerId: string, cursor: string, initialRevision = 0): Promise<number> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO player_session_revisions(player_id,revision,snapshot_cursor) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE
           revision=revision+IF(snapshot_cursor=VALUES(snapshot_cursor),0,1),
           snapshot_cursor=VALUES(snapshot_cursor)`,
        [playerId, initialRevision, cursor],
      );
      const [rows] = await connection.execute<(RowDataPacket & { revision: string | number; snapshot_cursor: string })[]>(
        "SELECT revision,snapshot_cursor FROM player_session_revisions WHERE player_id=?",
        [playerId],
      );
      const current = rows[0];
      if (!current) throw new Error("Player revision upsert did not return a row");
      const revision = toSafeInteger(current.revision, "player_session_revisions.revision");
      await connection.commit();
      return revision;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findCommandReceipt(actorId: string, commandId: string): Promise<StoredSessionCommandReceipt | null> {
    const [rows] = await this.pool.execute<(RowDataPacket & {
      fingerprint: string;
      receipt: JsonValue;
      snapshot: JsonValue | null;
      created_at: Date | string;
    })[]>(
      "SELECT fingerprint,receipt,snapshot,created_at FROM session_command_receipts WHERE actor_id=? AND command_id=?",
      [actorId, commandId],
    );
    const row = rows[0];
    const snapshot = row?.snapshot === null || row === undefined
      ? undefined
      : parseJson<MatchSnapshot | null>(row.snapshot) ?? undefined;
    return row ? {
      actorId,
      commandId,
      fingerprint: row.fingerprint,
      receipt: parseJson<StoredSessionCommandReceipt["receipt"]>(row.receipt),
      ...(snapshot ? { snapshot } : {}),
      createdAt: toDateMilliseconds(row.created_at),
    } : null;
  }

  async saveCommandReceipt(receipt: StoredSessionCommandReceipt): Promise<void> {
    await this.pool.execute(
      `INSERT INTO session_command_receipts(actor_id,command_id,fingerprint,receipt,snapshot,created_at)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE actor_id=VALUES(actor_id)`,
      [receipt.actorId, receipt.commandId, receipt.fingerprint, serializeJson(receipt.receipt),
        receipt.snapshot ? serializeJson(receipt.snapshot) : null, toMysqlDate(receipt.createdAt)],
    );
  }

  async saveRoom(room: RoomRecord): Promise<void> {
    await this.transactRoom(room.id, async (transaction) => { await transaction.saveRoom(room); });
  }

  async deleteRoom(roomId: string): Promise<void> {
    const room = await this.getRoomById(roomId);
    if (!room) return;
    try {
      await this.transactRoom(roomId, async (transaction) => {
        if (transaction.room.status === "LOBBY" && !transaction.room.matchId) await transaction.deleteRoom();
      });
    } catch (error) {
      if (!(error instanceof ServiceError && error.code === "ROOM_NOT_FOUND")) throw error;
    }
  }

  async transactRoom<T>(roomId: string, operation: (transaction: RoomTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [roomRows] = await connection.execute<RoomRow[]>("SELECT * FROM rooms WHERE id=? FOR UPDATE", [roomId]);
      const roomRow = roomRows[0];
      if (!roomRow) throw new ServiceError("ROOM_NOT_FOUND");
      const [memberRows] = await connection.execute<MemberRow[]>(
        "SELECT * FROM room_members WHERE room_id=? ORDER BY seat",
        [roomId],
      );
      let stagedRoom = toRoom(roomRow, memberRows);
      let deleteRoom = false;
      const stagedMatches = new Map<string, MatchRecord>();
      const transaction: RoomTransaction = {
        get room() { return structuredClone(stagedRoom); },
        getMatch: async (matchId) => {
          const staged = stagedMatches.get(matchId);
          if (staged) return structuredClone(staged);
          const [rows] = await connection.execute<MatchRow[]>("SELECT * FROM matches WHERE id=? FOR UPDATE", [matchId]);
          return rows[0] ? toMatch(rows[0]) : null;
        },
        saveRoom: async (room) => {
          if (room.id !== roomId) throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
          stagedRoom = structuredClone(room);
          deleteRoom = false;
        },
        deleteRoom: async () => {
          if (stagedRoom.status !== "LOBBY" || stagedRoom.matchId) throw new ServiceError("ROOM_DELETE_CONFLICT");
          deleteRoom = true;
        },
        createMatch: async (match) => {
          if (match.roomId !== roomId) throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
          if (stagedMatches.has(match.id)) throw new ServiceError("MATCH_ALREADY_EXISTS");
          stagedMatches.set(match.id, structuredClone(match));
        },
        findReceipt: async (actorId, commandId) => {
          const [receiptRows] = await connection.execute<(RowDataPacket & {
            fingerprint: string | null;
            receipt: JsonValue;
            created_at: Date | string;
          })[]>(
            "SELECT fingerprint,receipt,created_at FROM room_command_receipts WHERE room_id=? AND actor_id=? AND command_id=?",
            [roomId, actorId, commandId],
          );
          const receiptRow = receiptRows[0];
          return receiptRow ? {
            roomId,
            actorId,
            commandId,
            fingerprint: receiptRow.fingerprint ?? "",
            receipt: parseJson<StoredRoomReceipt["receipt"]>(receiptRow.receipt),
            createdAt: toDateMilliseconds(receiptRow.created_at),
          } : null;
        },
        saveReceipt: async (receipt) => {
          if (receipt.roomId !== roomId) throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
          await connection.execute(
            `INSERT INTO room_command_receipts(room_id,actor_id,command_id,fingerprint,receipt,created_at)
             VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE command_id=VALUES(command_id)`,
            [receipt.roomId, receipt.actorId, receipt.commandId, receipt.fingerprint,
              serializeJson(receipt.receipt), toMysqlDate(receipt.createdAt)],
          );
        },
        appendAudit: async (events) => {
          await this.#insertRoomEvents(connection, events);
        },
      };
      const output = await operation(transaction);
      if (deleteRoom) {
        await connection.execute("DELETE FROM rooms WHERE id=?", [roomId]);
      } else {
        for (const match of stagedMatches.values()) await this.#insertMatch(connection, match);
        await connection.execute(
          `UPDATE rooms SET code=?,owner_id=?,status=?,tutorial=?,settings=?,revision=?,restart_votes=?,match_id=?
           WHERE id=?`,
          [stagedRoom.code, stagedRoom.ownerId, stagedRoom.status, stagedRoom.tutorial, serializeJson(stagedRoom.settings),
            stagedRoom.revision, serializeJson(stagedRoom.restartVotes ?? []), stagedRoom.matchId ?? null, stagedRoom.id],
        );
        await this.#replaceMembers(connection, stagedRoom);
      }
      await connection.commit();
      return output;
    } catch (error) {
      await connection.rollback();
      throw mapWriteError(error);
    } finally {
      connection.release();
    }
  }

  async createMatch(match: MatchRecord): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await this.#insertMatch(connection, match);
    } catch (error) {
      throw mapWriteError(error);
    } finally {
      connection.release();
    }
  }

  async getMatch(matchId: string): Promise<MatchRecord | null> {
    const [rows] = await this.pool.execute<MatchRow[]>("SELECT * FROM matches WHERE id=?", [matchId]);
    return rows[0] ? toMatch(rows[0]) : null;
  }

  async transactMatch<T>(matchId: string, operation: (transaction: MatchTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<MatchRow[]>("SELECT * FROM matches WHERE id=? FOR UPDATE", [matchId]);
      const row = rows[0];
      if (!row) throw new ServiceError("MATCH_NOT_FOUND");
      let stagedMatch = toMatch(row);
      const transaction: MatchTransaction = {
        get match() { return structuredClone(stagedMatch); },
        findReceipt: async (actorId, commandId) => {
          const [receiptRows] = await connection.execute<(RowDataPacket & {
            fingerprint: string | null;
            receipt: JsonValue;
            created_at: Date | string;
          })[]>(
            "SELECT fingerprint,receipt,created_at FROM command_receipts WHERE match_id=? AND actor_id=? AND command_id=?",
            [matchId, actorId, commandId],
          );
          const receiptRow = receiptRows[0];
          return receiptRow ? {
            matchId,
            actorId,
            commandId,
            fingerprint: receiptRow.fingerprint ?? "",
            receipt: parseJson<StoredReceipt["receipt"]>(receiptRow.receipt),
            createdAt: toDateMilliseconds(receiptRow.created_at),
          } : null;
        },
        saveReceipt: async (receipt) => {
          await connection.execute(
            `INSERT INTO command_receipts(match_id,actor_id,command_id,fingerprint,receipt,created_at)
             VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE command_id=VALUES(command_id)`,
            [receipt.matchId, receipt.actorId, receipt.commandId, receipt.fingerprint,
              serializeJson(receipt.receipt), toMysqlDate(receipt.createdAt)],
          );
        },
        saveMatch: async (match) => {
          if (match.id !== matchId) throw new ServiceError("MATCH_TRANSACTION_MISMATCH");
          stagedMatch = structuredClone(match);
          await connection.execute(
            `UPDATE matches SET revision=?,state=?,card_tokens=?,deadline_id=?,deadline_at=?,
             deadline_lease_until=NULL,updated_at=? WHERE id=?`,
            [match.revision, serializeJson(match.state), serializeJson(match.tokens), match.deadline?.deadlineId ?? null,
              match.deadline ? toMysqlDate(match.deadline.deadlineAt) : null, toMysqlDate(match.updatedAt), match.id],
          );
        },
        appendAudit: async (events) => {
          for (const event of events) {
            await connection.execute(
              `INSERT INTO match_events(match_id,sequence,revision,type,actor_id,created_at)
               VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE sequence=VALUES(sequence)`,
              [event.matchId, event.sequence, event.revision, event.type, event.actorId ?? null, toMysqlDate(event.createdAt)],
            );
          }
        },
      };
      const output = await operation(transaction);
      await connection.commit();
      return output;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimDueDeadlines(now: number, limit: number): Promise<readonly DeadlineRecord[]> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<(RowDataPacket & {
        id: string;
        deadline_id: string;
        deadline_at: Date | string;
      })[]>(
        `SELECT id,deadline_id,deadline_at FROM matches
         WHERE deadline_at <= ? AND (deadline_lease_until IS NULL OR deadline_lease_until < UTC_TIMESTAMP(3))
         ORDER BY deadline_at LIMIT ? FOR UPDATE SKIP LOCKED`,
        [toMysqlDate(now), limit],
      );
      if (rows.length > 0) {
        for (const row of rows) {
          await connection.execute(
            `UPDATE matches SET deadline_lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 SECOND)
             WHERE id=? AND deadline_id=?`,
            [row.id, row.deadline_id],
          );
        }
      }
      await connection.commit();
      return rows.map((row) => ({
        matchId: row.id,
        deadlineId: row.deadline_id,
        deadlineAt: toDateMilliseconds(row.deadline_at),
      }));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async releaseDeadline(deadline: DeadlineRecord): Promise<void> {
    await this.pool.execute(
      "UPDATE matches SET deadline_lease_until=NULL WHERE id=? AND deadline_id=?",
      [deadline.matchId, deadline.deadlineId],
    );
  }

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async #insertRoom(connection: PoolConnection, room: RoomRecord): Promise<void> {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO rooms(id,code,owner_id,status,tutorial,settings,revision,restart_votes,match_id,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [room.id, room.code, room.ownerId, room.status, room.tutorial, serializeJson(room.settings), room.revision,
        serializeJson(room.restartVotes ?? []), room.matchId ?? null, toMysqlDate(room.createdAt)],
    );
  }

  async #insertMatch(connection: PoolConnection, match: MatchRecord): Promise<void> {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO matches(id,room_id,revision,state,card_tokens,deadline_id,deadline_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [match.id, match.roomId, match.revision, serializeJson(match.state), serializeJson(match.tokens),
        match.deadline?.deadlineId ?? null, match.deadline ? toMysqlDate(match.deadline.deadlineAt) : null,
        toMysqlDate(match.createdAt), toMysqlDate(match.updatedAt)],
    );
  }

  async #insertRoomEvents(connection: PoolConnection, events: readonly RoomAuditEvent[]): Promise<void> {
    for (const event of events) {
      await connection.execute(
        `INSERT INTO room_events(room_id,revision,type,actor_id,created_at)
         VALUES (?,?,?,?,?)`,
        [event.roomId, event.revision, event.type, event.actorId ?? null, toMysqlDate(event.createdAt)],
      );
    }
  }

  async #loadRoom(row: RoomRow): Promise<RoomRecord> {
    const [members] = await this.pool.execute<MemberRow[]>(
      "SELECT * FROM room_members WHERE room_id=? ORDER BY seat",
      [row.id],
    );
    return toRoom(row, members);
  }

  async #replaceMembers(connection: PoolConnection, room: RoomRecord): Promise<void> {
    await connection.execute("DELETE FROM room_members WHERE room_id=?", [room.id]);
    for (const [seat, member] of room.members.entries()) {
      await connection.execute(
        `INSERT INTO room_members(room_id,player_id,name,avatar,is_bot,ready,connected,seat)
         VALUES (?,?,?,?,?,?,?,?)`,
        [room.id, member.id, member.name, member.avatar ?? null, member.bot, member.ready, member.connected, seat],
      );
    }
  }
}
