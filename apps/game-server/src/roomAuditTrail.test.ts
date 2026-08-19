import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MatchCoordinator } from "./match/matchCoordinator.js";
import { RoomCoordinator } from "./room/roomCoordinator.js";
import { MemoryGameStore } from "./persistence/memoryStore.js";
import type { RoomAuditEvent } from "./model.js";

const settings = {
  maxPlayers: 2 as const,
  turnSeconds: 45 as const,
  responseSeconds: 5 as const,
  choiceSeconds: 15 as const,
  allowBots: true,
  rulesetVersion: "original-2025@1" as const,
};

function harness(now = 1_000) {
  const store = new MemoryGameStore();
  let id = 0;
  const clock = { now: () => now };
  const ids = { next: (prefix: string) => `${prefix}-${++id}` };
  const rooms = new RoomCoordinator({ store, clock, ids });
  const matches = new MatchCoordinator({ store, clock, token: ids });
  const alice = { playerId: "alice", sessionToken: "session-alice" } as const;
  return { store, rooms, matches, alice, clock, ids };
}

function eventsOfType(events: readonly RoomAuditEvent[], type: string): RoomAuditEvent[] {
  return events.filter((event) => event.type === type);
}

async function finishMatch(store: MemoryGameStore, matchId: string, winnerId: string, roomId: string) {
  const match = await store.getMatch(matchId);
  if (!match) throw new Error("match not found");
  const finished = structuredClone(match);
  const opponentId = Object.keys(finished.state.players).find((id) => id !== winnerId)!;
  finished.state.players[opponentId].alive = false;
  finished.state.status = "FINISHED";
  finished.state.winnerId = winnerId;
  await store.transactMatch(finished.id, async (transaction) => { await transaction.saveMatch(finished); });
  const room = await store.getRoomById(roomId);
  if (room) await store.saveRoom({ ...room, status: "FINISHED" });
}

describe("room audit trail — migration (VAL-M1-018)", () => {
  it("room_events migration file exists and is idempotent", async () => {
    const migrationPath = fileURLToPath(new URL("../migrations/003_room_events.sql", import.meta.url));
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS room_events");
    expect(sql).toMatch(/room_id\s+VARCHAR/);
    expect(sql).toMatch(/revision\s+BIGINT/);
    expect(sql).toMatch(/type\s+VARCHAR/);
    expect(sql).toMatch(/actor_id\s+VARCHAR/);
    expect(sql).toMatch(/created_at\s+DATETIME/);
    expect(sql).toContain("FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE");
  });
});

describe("room audit trail — audit event writes", () => {
  it("CreateRoom writes ROOM_CREATED audit event (VAL-M1-019)", async () => {
    const { store, rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    const events = store.roomAuditEvents();
    const created = eventsOfType(events, "ROOM_CREATED");
    expect(created).toHaveLength(1);
    expect(created[0]!.roomId).toBe(room.id);
    expect(created[0]!.revision).toBe(room.revision);
    expect(created[0]!.actorId).toBe(alice.playerId);
  });

  it("AddBot writes BOT_ADDED audit event (VAL-M1-020)", async () => {
    const { store, rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    const updated = await rooms.addBot(alice, room.id);
    const events = store.roomAuditEvents();
    const added = eventsOfType(events, "BOT_ADDED");
    expect(added).toHaveLength(1);
    expect(added[0]!.roomId).toBe(room.id);
    expect(added[0]!.revision).toBe(updated.revision);
    expect(added[0]!.actorId).toBe(alice.playerId);
  });

  it("RemoveBot writes BOT_REMOVED audit event (VAL-M1-021)", async () => {
    const { store, rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    const withBot = await rooms.addBot(alice, room.id);
    const botId = withBot.members.find((m) => m.bot)!.id;
    const updated = await rooms.removeBot(alice, room.id, botId);
    const events = store.roomAuditEvents();
    const removed = eventsOfType(events, "BOT_REMOVED");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.roomId).toBe(room.id);
    expect(removed[0]!.revision).toBe(updated.revision);
    expect(removed[0]!.actorId).toBe(alice.playerId);
  });

  it("JoinRoom writes MEMBER_JOINED audit event (VAL-M1-022)", async () => {
    const { store, rooms, alice } = harness();
    const bob = { playerId: "bob", sessionToken: "session-bob" } as const;
    const room = await rooms.create(alice, { ...settings, maxPlayers: 3 });
    const updated = await rooms.join(bob, room.code);
    const events = store.roomAuditEvents();
    const joined = eventsOfType(events, "MEMBER_JOINED");
    expect(joined).toHaveLength(1);
    expect(joined[0]!.roomId).toBe(room.id);
    expect(joined[0]!.revision).toBe(updated.revision);
    expect(joined[0]!.actorId).toBe(bob.playerId);
  });

  it("LeaveRoom writes MEMBER_LEFT audit event (VAL-M1-023)", async () => {
    const { store, rooms, alice } = harness();
    const bob = { playerId: "bob", sessionToken: "session-bob" } as const;
    const room = await rooms.create(alice, { ...settings, maxPlayers: 3 });
    await rooms.join(bob, room.code);
    const beforeCount = store.roomAuditEvents().length;
    await rooms.leave(bob);
    const events = store.roomAuditEvents();
    // The new event should be the last one
    const leftEvents = eventsOfType(events, "MEMBER_LEFT");
    expect(leftEvents).toHaveLength(1);
    expect(leftEvents[0]!.roomId).toBe(room.id);
    expect(leftEvents[0]!.actorId).toBe(bob.playerId);
    expect(events.length).toBe(beforeCount + 1);
  });

  it("StartMatch writes MATCH_STARTED audit event (VAL-M1-024)", async () => {
    const { store, rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    await rooms.addBot(alice, room.id);
    const started = await rooms.start(alice, room.id);
    const events = store.roomAuditEvents();
    const startedEvents = eventsOfType(events, "MATCH_STARTED");
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0]!.roomId).toBe(room.id);
    expect(startedEvents[0]!.revision).toBe(started.revision);
    expect(startedEvents[0]!.actorId).toBe(alice.playerId);
  });

  it("StartTutorial writes ROOM_CREATED + MATCH_STARTED audit events (VAL-M1-025)", async () => {
    const { store, rooms, alice } = harness();
    const started = await rooms.startTutorial(alice);
    const events = store.roomAuditEvents();
    const created = eventsOfType(events, "ROOM_CREATED");
    const matchStarted = eventsOfType(events, "MATCH_STARTED");
    expect(created).toHaveLength(1);
    expect(matchStarted).toHaveLength(1);
    expect(created[0]!.actorId).toBe(alice.playerId);
    expect(matchStarted[0]!.actorId).toBe(alice.playerId);
    expect(created[0]!.revision).toBeLessThanOrEqual(matchStarted[0]!.revision);
    expect(started.snapshot.matchId).toBeTruthy();
  });

  it("RestartMatch writes MATCH_RESTARTED audit event (VAL-M1-026)", async () => {
    const { store, rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    await rooms.addBot(alice, room.id);
    const started = await rooms.start(alice, room.id);
    await finishMatch(store, started.snapshot.matchId!, "alice", room.id);
    const restarted = await rooms.restart(alice, room.id);
    const events = store.roomAuditEvents();
    const restartedEvents = eventsOfType(events, "MATCH_RESTARTED");
    expect(restartedEvents).toHaveLength(1);
    expect(restartedEvents[0]!.roomId).toBe(room.id);
    expect(restartedEvents[0]!.revision).toBe(restarted.revision);
    expect(restartedEvents[0]!.actorId).toBe(alice.playerId);
  });
});

describe("room audit trail — atomicity (VAL-M1-027)", () => {
  it("audit events are not persisted when transactRoom rolls back", async () => {
    class CommitFailingStore extends MemoryGameStore {
      failNextRoomTransaction = false;

      override async transactRoom<T>(
        roomId: string,
        operation: Parameters<MemoryGameStore["transactRoom"]>[1],
      ): Promise<T> {
        return super.transactRoom(roomId, async (transaction) => {
          const result = await operation(transaction) as T;
          if (this.failNextRoomTransaction) {
            this.failNextRoomTransaction = false;
            throw new Error("simulated commit failure");
          }
          return result;
        });
      }
    }

    const store = new CommitFailingStore();
    let id = 0;
    const ids = { next: (prefix: string) => `${prefix}-${++id}` };
    const rooms = new RoomCoordinator({ store, clock: { now: () => 1_000 }, ids });
    const alice = { playerId: "alice", sessionToken: "session-alice" } as const;

    // Create a room first (succeeds)
    const room = await rooms.create(alice, settings);
    const eventsAfterCreate = store.roomAuditEvents().length;
    expect(eventsAfterCreate).toBe(1);

    // Set up the next room transaction to fail
    store.failNextRoomTransaction = true;

    // addBot should fail due to simulated commit failure
    await expect(rooms.addBot(alice, room.id)).rejects.toThrow("simulated commit failure");

    // No new audit events should have been persisted
    expect(store.roomAuditEvents().length).toBe(eventsAfterCreate);

    // Verify the room state was not mutated
    const unchangedRoom = await store.getRoomById(room.id);
    expect(unchangedRoom?.members.filter((m) => m.bot)).toHaveLength(0);
  });
});

describe("room audit trail — non-duplication on replay (VAL-M1-028)", () => {
  it("idempotent replay of addBot does not duplicate audit events", async () => {
    const { store, rooms, alice } = harness();
    const room = await rooms.create(alice, settings);

    // First addBot with command context
    await rooms.addBot(alice, room.id, { commandId: "cmd-audit-1", fingerprint: "fp" });
    const eventsAfterFirst = store.roomAuditEvents();
    const addedAfterFirst = eventsOfType(eventsAfterFirst, "BOT_ADDED");
    expect(addedAfterFirst).toHaveLength(1);

    // Replay same commandId — domain-level idempotency returns early, no new audit
    await rooms.addBot(alice, room.id, { commandId: "cmd-audit-1", fingerprint: "fp" });
    const eventsAfterReplay = store.roomAuditEvents();
    const addedAfterReplay = eventsOfType(eventsAfterReplay, "BOT_ADDED");
    expect(addedAfterReplay).toHaveLength(1);
    expect(eventsAfterReplay.length).toBe(eventsAfterFirst.length);
  });

  it("idempotent replay of start does not duplicate audit events", async () => {
    const { store, rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    await rooms.addBot(alice, room.id);

    // First start with command context
    await rooms.start(alice, room.id, { commandId: "cmd-audit-start", fingerprint: "fp" });
    const eventsAfterFirst = store.roomAuditEvents();
    const startedAfterFirst = eventsOfType(eventsAfterFirst, "MATCH_STARTED");
    expect(startedAfterFirst).toHaveLength(1);

    // Replay same commandId — receipt-layer idempotency returns early, no new audit
    await rooms.start(alice, room.id, { commandId: "cmd-audit-start", fingerprint: "fp" });
    const eventsAfterReplay = store.roomAuditEvents();
    const startedAfterReplay = eventsOfType(eventsAfterReplay, "MATCH_STARTED");
    expect(startedAfterReplay).toHaveLength(1);
    expect(eventsAfterReplay.length).toBe(eventsAfterFirst.length);
  });

  it("domain-level idempotent create does not duplicate ROOM_CREATED", async () => {
    const { store, rooms, alice } = harness();
    await rooms.create(alice, settings);
    const eventsAfterFirst = store.roomAuditEvents();
    expect(eventsOfType(eventsAfterFirst, "ROOM_CREATED")).toHaveLength(1);

    // Second create returns existing room — no new audit
    await rooms.create(alice, settings);
    const eventsAfterSecond = store.roomAuditEvents();
    expect(eventsOfType(eventsAfterSecond, "ROOM_CREATED")).toHaveLength(1);
    expect(eventsAfterSecond.length).toBe(eventsAfterFirst.length);
  });

  it("domain-level idempotent join does not duplicate MEMBER_JOINED", async () => {
    const { store, rooms, alice } = harness();
    const bob = { playerId: "bob", sessionToken: "session-bob" } as const;
    const room = await rooms.create(alice, { ...settings, maxPlayers: 3 });
    await rooms.join(bob, room.code);
    const eventsAfterFirst = store.roomAuditEvents();
    expect(eventsOfType(eventsAfterFirst, "MEMBER_JOINED")).toHaveLength(1);

    // Second join returns existing membership — no new audit
    await rooms.join(bob, room.code);
    const eventsAfterSecond = store.roomAuditEvents();
    expect(eventsOfType(eventsAfterSecond, "MEMBER_JOINED")).toHaveLength(1);
    expect(eventsAfterSecond.length).toBe(eventsAfterFirst.length);
  });
});
