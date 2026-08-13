import type {
  AuditEvent,
  DeadlineRecord,
  MatchRecord,
  RoomRecord,
  StoredSessionCommandReceipt,
  StoredReceipt,
} from "../model.js";

export type MatchTransaction = {
  match: MatchRecord;
  findReceipt(actorId: string, commandId: string): Promise<StoredReceipt | null>;
  saveReceipt(receipt: StoredReceipt): Promise<void>;
  saveMatch(match: MatchRecord): Promise<void>;
  appendAudit(events: readonly AuditEvent[]): Promise<void>;
};

export type RoomTransaction = {
  readonly room: RoomRecord;
  getMatch(matchId: string): Promise<MatchRecord | null>;
  saveRoom(room: RoomRecord): Promise<void>;
  deleteRoom(): Promise<void>;
  createMatch(match: MatchRecord): Promise<void>;
};

export interface GameStore {
  createRoom(room: RoomRecord): Promise<void>;
  /** Atomically creates an active room and its first match. */
  createRoomWithMatch(room: RoomRecord, match: MatchRecord): Promise<void>;
  getRoomById(roomId: string): Promise<RoomRecord | null>;
  getRoomByCode(code: string): Promise<RoomRecord | null>;
  getRoomForPlayer(playerId: string): Promise<RoomRecord | null>;
  getPlayerRevision(playerId: string): Promise<number>;
  observePlayerSnapshot(playerId: string, cursor: string, initialRevision?: number): Promise<number>;
  findCommandReceipt(actorId: string, commandId: string): Promise<StoredSessionCommandReceipt | null>;
  saveCommandReceipt(receipt: StoredSessionCommandReceipt): Promise<void>;
  saveRoom(room: RoomRecord): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  transactRoom<T>(roomId: string, operation: (transaction: RoomTransaction) => Promise<T>): Promise<T>;
  createMatch(match: MatchRecord): Promise<void>;
  getMatch(matchId: string): Promise<MatchRecord | null>;
  transactMatch<T>(matchId: string, operation: (transaction: MatchTransaction) => Promise<T>): Promise<T>;
  claimDueDeadlines(now: number, limit: number): Promise<readonly DeadlineRecord[]>;
  releaseDeadline(deadline: DeadlineRecord): Promise<void>;
  healthCheck(): Promise<void>;
  close(): Promise<void>;
}
