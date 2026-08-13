import type { Pool, PoolClient, QueryResultRow } from "pg";
import { ServiceError } from "../errors.js";
import type { AuditEvent, DeadlineRecord, MatchRecord, MatchSnapshot, RoomMember, RoomRecord, StoredReceipt, StoredSessionCommandReceipt } from "../model.js";
import type { GameStore, MatchTransaction, RoomTransaction } from "./store.js";

type RoomRow = QueryResultRow & {
  id: string; code: string; owner_id: string; status: RoomRecord["status"];
  tutorial: boolean; settings: RoomRecord["settings"]; revision: string; restart_votes: string[]; match_id: string | null; created_at: Date;
};
type MemberRow = QueryResultRow & {
  player_id: string; name: string; avatar: string | null; is_bot: boolean;
  ready: boolean; connected: boolean; seat: number;
};
type MatchRow = QueryResultRow & {
  id: string; room_id: string; revision: string; state: MatchRecord["state"];
  card_tokens: MatchRecord["tokens"]; deadline_id: string | null; deadline_at: Date | null;
  created_at: Date; updated_at: Date;
};

function mapRoomWriteError(error: unknown): unknown {
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code !== "23505") return error;
  if (pgError.constraint === "room_members_real_player_unique_idx") {
    return new ServiceError("ALREADY_IN_ROOM");
  }
  if (pgError.constraint === "rooms_code_key" || pgError.constraint === "rooms_pkey") {
    return new ServiceError("ROOM_ALREADY_EXISTS");
  }
  return error;
}

function toRoom(row: RoomRow, members: readonly MemberRow[]): RoomRecord {
  return {
    id: row.id, code: row.code, ownerId: row.owner_id, status: row.status,
    tutorial: row.tutorial,
    settings: row.settings, revision: Number(row.revision), restartVotes: row.restart_votes,
    matchId: row.match_id ?? undefined,
    createdAt: row.created_at.getTime(),
    members: [...members].sort((a, b) => a.seat - b.seat).map((member): RoomMember => ({
      id: member.player_id, name: member.name, avatar: member.avatar ?? undefined,
      bot: member.is_bot, ready: member.ready, connected: member.connected,
    })),
  };
}

function toMatch(row: MatchRow): MatchRecord {
  return {
    id: row.id, roomId: row.room_id, revision: Number(row.revision), state: row.state,
    tokens: row.card_tokens,
    deadline: row.deadline_id && row.deadline_at
      ? { matchId: row.id, deadlineId: row.deadline_id, deadlineAt: row.deadline_at.getTime() }
      : null,
    createdAt: row.created_at.getTime(), updatedAt: row.updated_at.getTime(),
  };
}

export class PgGameStore implements GameStore {
  constructor(readonly pool: Pool) {}

  async createRoom(room: RoomRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.#insertRoom(client, room);
      await this.#replaceMembers(client, room);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapRoomWriteError(error);
    } finally { client.release(); }
  }

  async createRoomWithMatch(room: RoomRecord, match: MatchRecord): Promise<void> {
    if (room.status !== "ACTIVE" || room.matchId !== match.id || match.roomId !== room.id) {
      throw new ServiceError("ROOM_TRANSACTION_MISMATCH");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.#insertRoom(client, room);
      await this.#replaceMembers(client, room);
      await this.#insertMatch(client, match);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapRoomWriteError(error);
    } finally { client.release(); }
  }

  async getRoomById(roomId: string): Promise<RoomRecord | null> {
    const rows = await this.pool.query<RoomRow>("SELECT * FROM rooms WHERE id=$1", [roomId]);
    return rows.rows[0] ? this.#loadRoom(rows.rows[0]) : null;
  }

  async getRoomByCode(code: string): Promise<RoomRecord | null> {
    const rows = await this.pool.query<RoomRow>("SELECT * FROM rooms WHERE code=$1", [code]);
    return rows.rows[0] ? this.#loadRoom(rows.rows[0]) : null;
  }

  async getRoomForPlayer(playerId: string): Promise<RoomRecord | null> {
    const rows = await this.pool.query<RoomRow>(
      `SELECT r.* FROM rooms r JOIN room_members rm ON rm.room_id=r.id
       WHERE rm.player_id=$1 AND NOT rm.is_bot ORDER BY r.created_at DESC LIMIT 1`, [playerId],
    );
    return rows.rows[0] ? this.#loadRoom(rows.rows[0]) : null;
  }

  async getPlayerRevision(playerId: string): Promise<number> {
    const result = await this.pool.query<QueryResultRow & { revision: string }>(
      "SELECT revision FROM player_session_revisions WHERE player_id=$1",
      [playerId],
    );
    return result.rows[0] ? Number(result.rows[0].revision) : 0;
  }

  async observePlayerSnapshot(playerId: string, cursor: string, initialRevision = 0): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<QueryResultRow & { revision: string; snapshot_cursor: string }>(
        "SELECT revision,snapshot_cursor FROM player_session_revisions WHERE player_id=$1 FOR UPDATE",
        [playerId],
      );
      if (!current.rows[0]) {
        await client.query(
          "INSERT INTO player_session_revisions(player_id,revision,snapshot_cursor) VALUES ($1,$2,$3)",
          [playerId, initialRevision, cursor],
        );
        await client.query("COMMIT");
        return initialRevision;
      }
      const revision = Number(current.rows[0].revision) + (current.rows[0].snapshot_cursor === cursor ? 0 : 1);
      await client.query(
        "UPDATE player_session_revisions SET revision=$2,snapshot_cursor=$3 WHERE player_id=$1",
        [playerId, revision, cursor],
      );
      await client.query("COMMIT");
      return revision;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async findCommandReceipt(actorId: string, commandId: string): Promise<StoredSessionCommandReceipt | null> {
    const result = await this.pool.query<QueryResultRow & {
      fingerprint: string; receipt: StoredSessionCommandReceipt["receipt"]; snapshot: MatchSnapshot | null; created_at: Date;
    }>(
      "SELECT fingerprint,receipt,snapshot,created_at FROM session_command_receipts WHERE actor_id=$1 AND command_id=$2",
      [actorId, commandId],
    );
    const row = result.rows[0];
    return row ? { actorId, commandId, fingerprint: row.fingerprint, receipt: row.receipt, ...(row.snapshot ? { snapshot: row.snapshot } : {}), createdAt: row.created_at.getTime() } : null;
  }

  async saveCommandReceipt(receipt: StoredSessionCommandReceipt): Promise<void> {
    await this.pool.query(
      `INSERT INTO session_command_receipts(actor_id,command_id,fingerprint,receipt,snapshot,created_at)
       VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0)) ON CONFLICT DO NOTHING`,
      [receipt.actorId, receipt.commandId, receipt.fingerprint, receipt.receipt, receipt.snapshot ?? null, receipt.createdAt],
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const roomResult = await client.query<RoomRow>("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [roomId]);
      const roomRow = roomResult.rows[0];
      if (!roomRow) throw new ServiceError("ROOM_NOT_FOUND");
      const memberResult = await client.query<MemberRow>("SELECT * FROM room_members WHERE room_id=$1 ORDER BY seat", [roomId]);
      let stagedRoom = toRoom(roomRow, memberResult.rows);
      let deleteRoom = false;
      const stagedMatches = new Map<string, MatchRecord>();
      const transaction: RoomTransaction = {
        get room() { return structuredClone(stagedRoom); },
        getMatch: async (matchId) => {
          const staged = stagedMatches.get(matchId);
          if (staged) return structuredClone(staged);
          const result = await client.query<MatchRow>("SELECT * FROM matches WHERE id=$1 FOR UPDATE", [matchId]);
          return result.rows[0] ? toMatch(result.rows[0]) : null;
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
      };
      const output = await operation(transaction);
      if (deleteRoom) {
        await client.query("DELETE FROM rooms WHERE id=$1", [roomId]);
      } else {
        for (const match of stagedMatches.values()) await this.#insertMatch(client, match);
        await client.query(
          `UPDATE rooms SET code=$2,owner_id=$3,status=$4,tutorial=$5,settings=$6,revision=$7,restart_votes=$8,match_id=$9
           WHERE id=$1`,
          [stagedRoom.id, stagedRoom.code, stagedRoom.ownerId, stagedRoom.status, stagedRoom.tutorial === true, stagedRoom.settings,
            stagedRoom.revision, stagedRoom.restartVotes ?? [], stagedRoom.matchId ?? null],
        );
        await this.#replaceMembers(client, stagedRoom);
      }
      await client.query("COMMIT");
      return output;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapRoomWriteError(error);
    } finally { client.release(); }
  }

  async createMatch(match: MatchRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.#insertMatch(client, match);
    } finally { client.release(); }
  }

  async #insertRoom(client: PoolClient, room: RoomRecord): Promise<void> {
    await client.query(
      `INSERT INTO rooms(id, code, owner_id, status, tutorial, settings, revision, restart_votes, match_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10 / 1000.0))`,
      [room.id, room.code, room.ownerId, room.status, room.tutorial === true, room.settings, room.revision,
        room.restartVotes ?? [], room.matchId ?? null, room.createdAt],
    );
  }

  async #insertMatch(client: PoolClient, match: MatchRecord): Promise<void> {
    await client.query(
      `INSERT INTO matches(id,room_id,revision,state,card_tokens,deadline_id,deadline_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7::bigint IS NULL THEN NULL ELSE to_timestamp($7 / 1000.0) END,to_timestamp($8 / 1000.0),to_timestamp($9 / 1000.0))`,
      [match.id, match.roomId, match.revision, match.state, match.tokens, match.deadline?.deadlineId ?? null,
        match.deadline?.deadlineAt ?? null, match.createdAt, match.updatedAt],
    );
  }

  async getMatch(matchId: string): Promise<MatchRecord | null> {
    const result = await this.pool.query<MatchRow>("SELECT * FROM matches WHERE id=$1", [matchId]);
    return result.rows[0] ? toMatch(result.rows[0]) : null;
  }

  async transactMatch<T>(matchId: string, operation: (transaction: MatchTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<MatchRow>("SELECT * FROM matches WHERE id=$1 FOR UPDATE", [matchId]);
      const row = result.rows[0];
      if (!row) throw new ServiceError("MATCH_NOT_FOUND");
      let stagedMatch = toMatch(row);
      const transaction: MatchTransaction = {
        get match() { return stagedMatch; },
        findReceipt: async (actorId, commandId) => {
          const receipt = await client.query<QueryResultRow & { fingerprint: string | null; receipt: StoredReceipt["receipt"]; created_at: Date }>(
            "SELECT fingerprint,receipt,created_at FROM command_receipts WHERE match_id=$1 AND actor_id=$2 AND command_id=$3",
            [matchId, actorId, commandId],
          );
          return receipt.rows[0] ? { matchId, actorId, commandId, fingerprint: receipt.rows[0].fingerprint ?? "", receipt: receipt.rows[0].receipt, createdAt: receipt.rows[0].created_at.getTime() } : null;
        },
        saveReceipt: async (receipt) => {
          await client.query(
            `INSERT INTO command_receipts(match_id,actor_id,command_id,fingerprint,receipt,created_at)
             VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0)) ON CONFLICT DO NOTHING`,
            [receipt.matchId, receipt.actorId, receipt.commandId, receipt.fingerprint, receipt.receipt, receipt.createdAt],
          );
        },
        saveMatch: async (match) => {
          stagedMatch = match;
          await client.query(
            `UPDATE matches SET revision=$2,state=$3,card_tokens=$4,deadline_id=$5,
             deadline_at=CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6 / 1000.0) END,
             deadline_lease_until=NULL,updated_at=to_timestamp($7 / 1000.0) WHERE id=$1`,
            [match.id, match.revision, match.state, match.tokens, match.deadline?.deadlineId ?? null,
              match.deadline?.deadlineAt ?? null, match.updatedAt],
          );
        },
        appendAudit: async (events) => {
          for (const event of events) {
            await client.query(
              `INSERT INTO match_events(match_id,sequence,revision,type,actor_id,created_at)
               VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0)) ON CONFLICT DO NOTHING`,
              [event.matchId, event.sequence, event.revision, event.type, event.actorId ?? null, event.createdAt],
            );
          }
        },
      };
      const output = await operation(transaction);
      await client.query("COMMIT");
      return output;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  async claimDueDeadlines(now: number, limit: number): Promise<readonly DeadlineRecord[]> {
    const result = await this.pool.query<QueryResultRow & { id: string; deadline_id: string; deadline_at: Date }>(
      `WITH due AS (
         SELECT id FROM matches WHERE deadline_at <= to_timestamp($1 / 1000.0)
           AND (deadline_lease_until IS NULL OR deadline_lease_until < now())
         ORDER BY deadline_at FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE matches m SET deadline_lease_until=now() + interval '30 seconds'
       FROM due WHERE m.id=due.id RETURNING m.id,m.deadline_id,m.deadline_at`,
      [now, limit],
    );
    return result.rows.map((row) => ({ matchId: row.id, deadlineId: row.deadline_id, deadlineAt: row.deadline_at.getTime() }));
  }

  async releaseDeadline(deadline: DeadlineRecord): Promise<void> {
    await this.pool.query(
      "UPDATE matches SET deadline_lease_until=NULL WHERE id=$1 AND deadline_id=$2",
      [deadline.matchId, deadline.deadlineId],
    );
  }

  async healthCheck(): Promise<void> { await this.pool.query("SELECT 1"); }
  async close(): Promise<void> { await this.pool.end(); }

  async #loadRoom(row: RoomRow): Promise<RoomRecord> {
    const members = await this.pool.query<MemberRow>("SELECT * FROM room_members WHERE room_id=$1 ORDER BY seat", [row.id]);
    return toRoom(row, members.rows);
  }

  async #replaceMembers(client: PoolClient, room: RoomRecord): Promise<void> {
    await client.query("DELETE FROM room_members WHERE room_id=$1", [room.id]);
    for (const [seat, member] of room.members.entries()) {
      await client.query(
        `INSERT INTO room_members(room_id,player_id,name,avatar,is_bot,ready,connected,seat)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [room.id, member.id, member.name, member.avatar ?? null, member.bot, member.ready, member.connected, seat],
      );
    }
  }
}
