import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ClientAction, type ClientCommandEnvelope } from "@exploding-kitty/protocol";
import { MatchCoordinator } from "./match/matchCoordinator.js";
import { RoomCoordinator } from "./room/roomCoordinator.js";
import { MemoryGameStore } from "./persistence/memoryStore.js";
import type { RoomTransaction } from "./persistence/store.js";
import { ConnectionHub } from "./transport/connectionHub.js";
import { SessionGateway } from "./transport/sessionGateway.js";
import type { AuthContext, RoomSettings } from "./model.js";

const settings: RoomSettings = {
  maxPlayers: 2,
  turnSeconds: 45,
  responseSeconds: 5,
  choiceSeconds: 15,
  allowBots: true,
  rulesetVersion: "original-2025@1",
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

async function startedHarness() {
  const context = harness();
  const room = await context.rooms.create(context.alice, settings);
  await context.rooms.addBot(context.alice, room.id);
  const started = await context.rooms.start(context.alice, room.id);
  return { ...context, room, started };
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

describe("room command idempotency — domain level", () => {
  it("addBot is idempotent when a bot is already present (VAL-M1-001)", async () => {
    const { rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    const first = await rooms.addBot(alice, room.id);
    const second = await rooms.addBot(alice, room.id);
    expect(second.members).toHaveLength(first.members.length);
    expect(second.revision).toBe(first.revision);
    expect(second.members.filter((m) => m.bot)).toHaveLength(1);
  });

  it("removeBot is idempotent when bot has already been removed (VAL-M1-002)", async () => {
    const { rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    const added = await rooms.addBot(alice, room.id);
    const botId = added.members.find((m) => m.bot)!.id;
    const first = await rooms.removeBot(alice, room.id, botId);
    const second = await rooms.removeBot(alice, room.id, botId);
    expect(second.members).toEqual(first.members);
    expect(second.revision).toBe(first.revision);
    expect(second.members.filter((m) => m.bot)).toHaveLength(0);
  });

  it("create is idempotent when player is already in a room (VAL-M1-003)", async () => {
    const { rooms, alice } = harness();
    const first = await rooms.create(alice, settings);
    const second = await rooms.create(alice, settings);
    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(first.revision);
  });

  it("start is idempotent when match is already active (VAL-M1-004)", async () => {
    const { rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    await rooms.addBot(alice, room.id);
    const first = await rooms.start(alice, room.id);
    const second = await rooms.start(alice, room.id);
    expect(second.snapshot.matchId).toBe(first.snapshot.matchId);
    expect(second.revision).toBe(first.revision);
  });

  it("restart is idempotent when match is already in progress (VAL-M1-005)", async () => {
    const { rooms, alice, store } = harness();
    const room = await rooms.create(alice, settings);
    await rooms.addBot(alice, room.id);
    const started = await rooms.start(alice, room.id);
    // restart while match is still ACTIVE should return current snapshot, not throw
    const restarted = await rooms.restart(alice, room.id);
    expect(restarted.snapshot.matchId).toBe(started.snapshot.matchId);
    expect(restarted.revision).toBe(started.revision);
    // verify only one match exists
    const activeRoom = await store.getRoomById(room.id);
    expect(activeRoom?.matchId).toBe(started.snapshot.matchId);
  });

  it("startTutorial is idempotent when player is already in a tutorial room (VAL-M1-006)", async () => {
    const { rooms, alice } = harness();
    const first = await rooms.startTutorial(alice);
    const second = await rooms.startTutorial(alice);
    expect(second.snapshot.matchId).toBe(first.snapshot.matchId);
    expect(second.revision).toBe(first.revision);
  });

  it("join is idempotent when player is already a member (VAL-M1-007)", async () => {
    const { rooms, alice } = harness();
    const bob = { playerId: "bob", sessionToken: "session-bob" } as const;
    const room = await rooms.create(alice, { ...settings, maxPlayers: 3 });
    const first = await rooms.join(bob, room.code);
    const second = await rooms.join(bob, room.code);
    expect(second.members).toHaveLength(first.members.length);
    expect(second.revision).toBe(first.revision);
  });

  it("leave is idempotent when player is not in any room (VAL-M1-008)", async () => {
    const { rooms, alice, clock } = harness();
    const expected = { revision: 0, snapshot: { phase: "HOME" as const, viewerId: "alice", serverTime: clock.now() } };
    const first = await rooms.leave(alice);
    expect(first).toEqual(expected);
    const second = await rooms.leave(alice);
    expect(second).toEqual(expected);
  });
});

describe("room command idempotency — transactional receipt layer", () => {
  it("room_command_receipts migration exists and is idempotent (VAL-M1-009)", async () => {
    const migrationPath = fileURLToPath(new URL("../migrations/002_room_command_receipts.sql", import.meta.url));
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS room_command_receipts");
    expect(sql).toMatch(/room_id\s+VARCHAR/);
    expect(sql).toMatch(/actor_id\s+VARCHAR/);
    expect(sql).toMatch(/command_id\s+VARCHAR/);
    expect(sql).toMatch(/fingerprint\s+TEXT/);
    expect(sql).toMatch(/receipt\s+JSON/);
    expect(sql).toMatch(/created_at\s+DATETIME/);
    expect(sql).toContain("PRIMARY KEY (room_id, actor_id, command_id)");
    expect(sql).toContain("FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE");
  });

  it("rejects different payload with same commandId as COMMAND_ID_REUSED (VAL-M1-014)", async () => {
    const { rooms, alice } = harness();
    const room = await rooms.create(alice, settings);
    const added = await rooms.addBot(alice, room.id, { commandId: "cmd-reuse", fingerprint: "fp-addbot" });
    const botId = added.members.find((m) => m.bot)!.id;
    await expect(
      rooms.removeBot(alice, room.id, botId, { commandId: "cmd-reuse", fingerprint: "fp-removebot" }),
    ).rejects.toMatchObject({ code: "COMMAND_ID_REUSED", retryable: false });
  });

  it("crash recovery: committed mutation without receipt replays correctly (VAL-M1-015)", async () => {
    const { rooms, alice, store } = harness();
    const room = await rooms.create(alice, settings);
    // Direct addBot without command context — no receipt saved
    await rooms.addBot(alice, room.id);
    const afterDirect = await store.getRoomById(room.id);
    expect(afterDirect?.members.filter((m) => m.bot)).toHaveLength(1);
    const directRevision = afterDirect!.revision;
    // Replay same commandId through coordinator with command context.
    // No room-level receipt exists (direct call didn't save one).
    // Domain-level idempotency catches it: bot already present, return current state.
    const result = await rooms.addBot(alice, room.id, { commandId: "cmd-crash", fingerprint: "fp-addbot" });
    expect(result.members.filter((m) => m.bot)).toHaveLength(1);
    expect(result.revision).toBe(directRevision);
  });

  it("findReceipt/saveReceipt happen inside transactRoom callback (VAL-M1-016)", async () => {
    const calls: string[] = [];
    class InstrumentedStore extends MemoryGameStore {
      override async transactRoom<T>(
        roomId: string,
        operation: Parameters<MemoryGameStore["transactRoom"]>[1],
      ): Promise<T> {
        return super.transactRoom(roomId, async (tx) => {
          calls.push("tx:start");
          const wrappedTx: RoomTransaction = {
            get room() { return tx.room; },
            getMatch: (matchId: string) => tx.getMatch(matchId),
            saveRoom: (room) => tx.saveRoom(room),
            deleteRoom: () => tx.deleteRoom(),
            createMatch: (match) => tx.createMatch(match),
            findReceipt: async (actorId: string, commandId: string) => {
              calls.push("findReceipt");
              return tx.findReceipt(actorId, commandId);
            },
            saveReceipt: async (receipt) => {
              calls.push("saveReceipt");
              return tx.saveReceipt(receipt);
            },
            appendAudit: (events) => tx.appendAudit(events),
          };
          const result = await operation(wrappedTx) as T;
          calls.push("tx:end");
          return result;
        });
      }
    }

    const store = new InstrumentedStore();
    let id = 0;
    const ids = { next: (prefix: string) => `${prefix}-${++id}` };
    const rooms = new RoomCoordinator({ store, clock: { now: () => 1_000 }, ids });
    const alice = { playerId: "alice", sessionToken: "session-alice" } as const;
    const room = await rooms.create(alice, settings);

    calls.length = 0;
    await rooms.addBot(alice, room.id, { commandId: "cmd-1", fingerprint: "fp-1" });

    const startIndex = calls.indexOf("tx:start");
    const findIndex = calls.indexOf("findReceipt");
    const saveIndex = calls.indexOf("saveReceipt");
    const endIndex = calls.indexOf("tx:end");

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(findIndex).toBeGreaterThan(startIndex);
    expect(findIndex).toBeLessThan(endIndex);
    expect(saveIndex).toBeGreaterThan(findIndex);
    expect(saveIndex).toBeLessThan(endIndex);
  });

  it("multiple distinct commandIds each execute independently (VAL-M1-017)", async () => {
    const { rooms, alice, store } = harness();
    const room = await rooms.create(alice, settings);

    const afterAdd = await rooms.addBot(alice, room.id, { commandId: "cmd-add", fingerprint: "fp-add" });
    expect(afterAdd.members.filter((m) => m.bot)).toHaveLength(1);

    const botId = afterAdd.members.find((m) => m.bot)!.id;
    const afterRemove = await rooms.removeBot(alice, room.id, botId, { commandId: "cmd-remove", fingerprint: "fp-remove" });
    expect(afterRemove.members.filter((m) => m.bot)).toHaveLength(0);

    const finalRoom = await store.getRoomById(room.id);
    expect(finalRoom?.members.filter((m) => m.bot)).toHaveLength(0);

    // Both receipts should exist
    const receipts = store.roomReceipts();
    expect(receipts).toHaveLength(2);
    expect(receipts.some((r) => r.commandId === "cmd-add")).toBe(true);
    expect(receipts.some((r) => r.commandId === "cmd-remove")).toBe(true);
  });

  it("same commandId replay returns original receipt without double-executing", async () => {
    const { rooms, alice, store } = harness();
    const room = await rooms.create(alice, settings);
    const first = await rooms.addBot(alice, room.id, { commandId: "cmd-replay", fingerprint: "fp" });
    expect(first.members.filter((m) => m.bot)).toHaveLength(1);
    const firstRevision = first.revision;

    // Replay with same commandId and fingerprint
    const second = await rooms.addBot(alice, room.id, { commandId: "cmd-replay", fingerprint: "fp" });
    expect(second.revision).toBe(firstRevision);
    expect(second.members.filter((m) => m.bot)).toHaveLength(1);

    // Only one receipt should exist
    const receipts = store.roomReceipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.commandId).toBe("cmd-replay");
  });
});

describe("room command idempotency — cross-room isolation", () => {
  it("same commandId in different rooms executes independently at coordinator level (VAL-M1-029)", async () => {
    const store = new MemoryGameStore();
    let id = 0;
    const ids = { next: (prefix: string) => `${prefix}-${++id}` };
    const rooms = new RoomCoordinator({ store, clock: { now: () => 1_000 }, ids });
    const alice = { playerId: "alice", sessionToken: "session-alice" } as const;
    const bob = { playerId: "bob", sessionToken: "session-bob" } as const;

    const roomA = await rooms.create(alice, settings);
    const roomB = await rooms.create(bob, settings);

    // Both use the same commandId but in different rooms
    const resultA = await rooms.addBot(alice, roomA.id, { commandId: "shared-cmd", fingerprint: "fp" });
    const resultB = await rooms.addBot(bob, roomB.id, { commandId: "shared-cmd", fingerprint: "fp" });

    expect(resultA.members.filter((m) => m.bot)).toHaveLength(1);
    expect(resultB.members.filter((m) => m.bot)).toHaveLength(1);

    // Verify receipts are stored separately (composite key includes room_id)
    const receipts = store.roomReceipts();
    expect(receipts).toHaveLength(2);
    expect(receipts.some((r) => r.roomId === roomA.id && r.commandId === "shared-cmd")).toBe(true);
    expect(receipts.some((r) => r.roomId === roomB.id && r.commandId === "shared-cmd")).toBe(true);
  });

  it("same commandId in different rooms executes independently via gateway (VAL-M1-029)", async () => {
    const { store, rooms, matches, alice } = harness();
    const hub = new ConnectionHub();
    const gateway = new SessionGateway({ store, rooms, matches, hub });

    // Create room A
    const initial = await gateway.resume(alice, "wx-alice");
    const createA = await gateway.command(alice, {
      type: "command", protocolVersion: PROTOCOL_VERSION, sessionId: "wx-alice",
      commandId: "create-a", expectedRevision: initial.revision, action: { type: "CreateRoom", settings },
    });
    expect(createA.ok).toBe(true);
    const roomA = await store.getRoomForPlayer(alice.playerId);
    expect(roomA).not.toBeNull();

    // AddBot in room A with commandId "shared-cmd"
    const addBotA = await gateway.command(alice, {
      type: "command", protocolVersion: PROTOCOL_VERSION, sessionId: "wx-alice",
      commandId: "shared-cmd", expectedRevision: createA.ok ? createA.revision : -1, action: { type: "AddBot" },
    });
    expect(addBotA.ok).toBe(true);

    // Verify room A has a bot
    const roomWithBot = await store.getRoomForPlayer(alice.playerId);
    expect(roomWithBot?.members.filter((m) => m.bot)).toHaveLength(1);

    // Leave room A
    const leaveA = await gateway.command(alice, {
      type: "command", protocolVersion: PROTOCOL_VERSION, sessionId: "wx-alice",
      commandId: "leave-a", expectedRevision: addBotA.ok ? addBotA.revision : -1, action: { type: "LeaveRoom" },
    });
    expect(leaveA.ok).toBe(true);

    // Create room B
    const createB = await gateway.command(alice, {
      type: "command", protocolVersion: PROTOCOL_VERSION, sessionId: "wx-alice",
      commandId: "create-b", expectedRevision: leaveA.ok ? leaveA.revision : -1, action: { type: "CreateRoom", settings },
    });
    expect(createB.ok).toBe(true);
    const roomB = await store.getRoomForPlayer(alice.playerId);
    expect(roomB).not.toBeNull();
    expect(roomB?.id).not.toBe(roomA?.id);

    // AddBot in room B with same commandId "shared-cmd" — should succeed (cross-room isolation)
    const addBotB = await gateway.command(alice, {
      type: "command", protocolVersion: PROTOCOL_VERSION, sessionId: "wx-alice",
      commandId: "shared-cmd", expectedRevision: createB.ok ? createB.revision : -1, action: { type: "AddBot" },
    });
    expect(addBotB.ok).toBe(true);

    // Verify room B has a bot
    const finalRoom = await store.getRoomForPlayer(alice.playerId);
    expect(finalRoom?.members.filter((m) => m.bot)).toHaveLength(1);
    expect(finalRoom?.id).toBe(roomB?.id);
  });
});

// ---------------------------------------------------------------------------
// Gateway-level replay tests: direct coordinator call then gateway.command()
// replay with the same commandId.  Validates that a mutation committed
// directly (without a session-level receipt) is not double-executed when the
// same commandId is replayed through the gateway.
// ---------------------------------------------------------------------------

function gatewayEnvelope(
  sessionId: string,
  commandId: string,
  expectedRevision: number,
  action: ClientAction,
): ClientCommandEnvelope {
  return { type: "command", protocolVersion: PROTOCOL_VERSION, sessionId, commandId, expectedRevision, action };
}

function gatewayHarness() {
  const context = harness();
  const hub = new ConnectionHub();
  const gateway = new SessionGateway({ store: context.store, rooms: context.rooms, matches: context.matches, hub });
  return { ...context, gateway, hub };
}

describe("room command idempotency — gateway replay (direct then replay)", () => {
  it("direct addBot() then gateway.command() replay returns original result (VAL-M1-010)", async () => {
    const { store, rooms, matches, alice } = harness();
    const hub = new ConnectionHub();
    const gateway = new SessionGateway({ store, rooms, matches, hub });
    const sessionId = "wx-alice";

    // Create room and add bot directly (no command context, no session receipt)
    const room = await rooms.create(alice, settings);
    const afterDirect = await rooms.addBot(alice, room.id);
    expect(afterDirect.members.filter((m) => m.bot)).toHaveLength(1);
    const directRevision = afterDirect.revision;

    // Establish gateway baseline
    const initial = await gateway.resume(alice, sessionId);

    // First gateway command — domain-level idempotency catches the duplicate
    const first = await gateway.command(alice, gatewayEnvelope(sessionId, "cmd-addbot", initial.revision, { type: "AddBot" }));
    expect(first.ok).toBe(true);

    // No second bot added
    const afterFirst = await store.getRoomById(room.id);
    expect(afterFirst?.members.filter((m) => m.bot)).toHaveLength(1);
    expect(afterFirst?.revision).toBe(directRevision);

    // Replay same commandId — session receipt catches it
    const replay = await gateway.command(alice, gatewayEnvelope(sessionId, "cmd-addbot", initial.revision, { type: "AddBot" }));
    expect(replay).toEqual(first);

    // Still no second bot
    const afterReplay = await store.getRoomById(room.id);
    expect(afterReplay?.members.filter((m) => m.bot)).toHaveLength(1);
    expect(afterReplay?.revision).toBe(directRevision);
  });

  it("direct start() then gateway.command() replay returns original result (VAL-M1-011)", async () => {
    const { store, rooms, matches, alice } = harness();
    const hub = new ConnectionHub();
    const gateway = new SessionGateway({ store, rooms, matches, hub });
    const sessionId = "wx-alice";

    // Create room, add bot, start match directly (no command context)
    const room = await rooms.create(alice, settings);
    await rooms.addBot(alice, room.id);
    const directStart = await rooms.start(alice, room.id);
    expect(directStart.snapshot.matchId).toBeTruthy();
    const directMatchId = directStart.snapshot.matchId!;

    // Establish gateway baseline
    const initial = await gateway.resume(alice, sessionId);

    // First gateway command — domain-level idempotency catches the duplicate
    const first = await gateway.command(alice, gatewayEnvelope(sessionId, "cmd-start", initial.revision, { type: "StartMatch" }));
    expect(first.ok).toBe(true);

    // No second match created
    const afterFirst = await store.getRoomById(room.id);
    expect(afterFirst?.matchId).toBe(directMatchId);

    // Replay same commandId — session receipt catches it
    const replay = await gateway.command(alice, gatewayEnvelope(sessionId, "cmd-start", initial.revision, { type: "StartMatch" }));
    expect(replay).toEqual(first);

    // Still only one match
    const afterReplay = await store.getRoomById(room.id);
    expect(afterReplay?.matchId).toBe(directMatchId);
  });

  it("direct restart() then gateway.command() replay returns original result (VAL-M1-012)", async () => {
    const { store, rooms, matches, alice } = harness();
    const hub = new ConnectionHub();
    const gateway = new SessionGateway({ store, rooms, matches, hub });
    const sessionId = "wx-alice";

    // Create room, add bot, start match, finish, then restart directly
    const room = await rooms.create(alice, settings);
    await rooms.addBot(alice, room.id);
    const started = await rooms.start(alice, room.id);
    const firstMatchId = started.snapshot.matchId!;
    await finishMatch(store, firstMatchId, "alice", room.id);

    // Restart directly (no command context, no receipt)
    const directRestart = await rooms.restart(alice, room.id);
    expect(directRestart.snapshot.matchId).toBeTruthy();
    expect(directRestart.snapshot.matchId).not.toBe(firstMatchId);
    const restartMatchId = directRestart.snapshot.matchId!;

    // Establish gateway baseline
    const initial = await gateway.resume(alice, sessionId);

    // First gateway command — domain-level idempotency catches the duplicate
    const first = await gateway.command(alice, gatewayEnvelope(sessionId, "cmd-restart", initial.revision, { type: "RestartMatch" }));
    expect(first.ok).toBe(true);

    // No additional match created
    const afterFirst = await store.getRoomById(room.id);
    expect(afterFirst?.matchId).toBe(restartMatchId);

    // Replay same commandId — session receipt catches it
    const replay = await gateway.command(alice, gatewayEnvelope(sessionId, "cmd-restart", initial.revision, { type: "RestartMatch" }));
    expect(replay).toEqual(first);

    // Still same match
    const afterReplay = await store.getRoomById(room.id);
    expect(afterReplay?.matchId).toBe(restartMatchId);
  });
});

// ---------------------------------------------------------------------------
// Concurrent same-commandId race: two simultaneous gateway.command() calls
// with the same commandId must result in exactly one mutation.
// ---------------------------------------------------------------------------

describe("room command idempotency — concurrent same-commandId race", () => {
  it("two concurrent gateway.command() with same commandId — only one executes (VAL-M1-013)", async () => {
    const { store, rooms, matches, alice } = harness();
    const hub = new ConnectionHub();
    const gateway = new SessionGateway({ store, rooms, matches, hub });
    const sessionId = "wx-alice";

    // Create room directly
    const room = await rooms.create(alice, settings);

    // Establish gateway baseline
    const initial = await gateway.resume(alice, sessionId);

    // Two concurrent gateway commands with the same commandId
    const envelope = gatewayEnvelope(sessionId, "cmd-race", initial.revision, { type: "AddBot" });
    const results = await Promise.allSettled([
      gateway.command(alice, envelope),
      gateway.command(alice, envelope),
    ]);

    // Both should fulfill with ok:true
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const [a, b] = results;
    if (a.status === "fulfilled" && b.status === "fulfilled") {
      expect(a.value.ok).toBe(true);
      expect(b.value.ok).toBe(true);
      expect(b.value).toEqual(a.value);
    }

    // Exactly one bot added (not two)
    const afterRace = await store.getRoomById(room.id);
    expect(afterRace?.members.filter((m) => m.bot)).toHaveLength(1);

    // Only one room-level receipt should exist
    const roomReceipts = store.roomReceipts();
    expect(roomReceipts).toHaveLength(1);
    expect(roomReceipts[0]!.commandId).toBe("cmd-race");
  });
});

// ---------------------------------------------------------------------------
// Parameterized gateway replay coverage for all 8 room action types.
// Each action is executed through gateway.command(), then replayed with the
// same commandId.  The replay must return the original result without
// double-executing.
// ---------------------------------------------------------------------------

type ReplayCtx = {
  gateway: SessionGateway;
  auth: AuthContext;
  sessionId: string;
  revision: number;
  store: MemoryGameStore;
  action: ClientAction;
  verify: () => Promise<void>;
};

const REPLAY_CASES: ReadonlyArray<{ name: string; setup: () => Promise<ReplayCtx> }> = [
  {
    name: "CreateRoom",
    setup: async () => {
      const { store, rooms, matches, alice } = harness();
      const hub = new ConnectionHub();
      const gateway = new SessionGateway({ store, rooms, matches, hub });
      const sessionId = "wx-alice";
      const initial = await gateway.resume(alice, sessionId);
      return {
        gateway, auth: alice, sessionId, store,
        revision: initial.revision,
        action: { type: "CreateRoom", settings },
        verify: async () => {
          const room = await store.getRoomForPlayer(alice.playerId);
          expect(room).not.toBeNull();
          expect(room?.members).toHaveLength(1);
        },
      };
    },
  },
  {
    name: "JoinRoom",
    setup: async () => {
      const { store, rooms, matches } = harness();
      const hub = new ConnectionHub();
      const gateway = new SessionGateway({ store, rooms, matches, hub });
      // Alice creates a room directly
      const alice = { playerId: "alice", sessionToken: "session-alice" } as const;
      const room = await rooms.create(alice, { ...settings, maxPlayers: 3 });
      // Bob connects through gateway
      const bob = { playerId: "bob", sessionToken: "session-bob" } as const;
      const sessionId = "wx-bob";
      const initial = await gateway.resume(bob, sessionId);
      return {
        gateway, auth: bob, sessionId, store,
        revision: initial.revision,
        action: { type: "JoinRoom", code: room.code },
        verify: async () => {
          const updated = await store.getRoomById(room.id);
          expect(updated?.members).toHaveLength(2);
          expect(updated?.members.some((m) => m.id === "bob")).toBe(true);
        },
      };
    },
  },
  {
    name: "AddBot",
    setup: async () => {
      const { store, rooms, matches, alice } = harness();
      const hub = new ConnectionHub();
      const gateway = new SessionGateway({ store, rooms, matches, hub });
      const room = await rooms.create(alice, settings);
      const sessionId = "wx-alice";
      const initial = await gateway.resume(alice, sessionId);
      return {
        gateway, auth: alice, sessionId, store,
        revision: initial.revision,
        action: { type: "AddBot" },
        verify: async () => {
          const updated = await store.getRoomById(room.id);
          expect(updated?.members.filter((m) => m.bot)).toHaveLength(1);
        },
      };
    },
  },
  {
    name: "RemoveBot",
    setup: async () => {
      const { store, rooms, matches, alice } = harness();
      const hub = new ConnectionHub();
      const gateway = new SessionGateway({ store, rooms, matches, hub });
      const room = await rooms.create(alice, settings);
      const withBot = await rooms.addBot(alice, room.id);
      const botId = withBot.members.find((m) => m.bot)!.id;
      const sessionId = "wx-alice";
      const initial = await gateway.resume(alice, sessionId);
      return {
        gateway, auth: alice, sessionId, store,
        revision: initial.revision,
        action: { type: "RemoveBot", playerId: botId },
        verify: async () => {
          const updated = await store.getRoomById(room.id);
          expect(updated?.members.filter((m) => m.bot)).toHaveLength(0);
        },
      };
    },
  },
  {
    name: "StartMatch",
    setup: async () => {
      const { store, rooms, matches, alice } = harness();
      const hub = new ConnectionHub();
      const gateway = new SessionGateway({ store, rooms, matches, hub });
      const room = await rooms.create(alice, settings);
      await rooms.addBot(alice, room.id);
      const sessionId = "wx-alice";
      const initial = await gateway.resume(alice, sessionId);
      return {
        gateway, auth: alice, sessionId, store,
        revision: initial.revision,
        action: { type: "StartMatch" },
        verify: async () => {
          const updated = await store.getRoomById(room.id);
          expect(updated?.status).toBe("ACTIVE");
          expect(updated?.matchId).toBeTruthy();
          const match = await store.getMatch(updated?.matchId ?? "");
          expect(match).not.toBeNull();
        },
      };
    },
  },
  {
    name: "StartTutorial",
    setup: async () => {
      const { store, rooms, matches, alice } = harness();
      const hub = new ConnectionHub();
      const gateway = new SessionGateway({ store, rooms, matches, hub });
      const sessionId = "wx-alice";
      const initial = await gateway.resume(alice, sessionId);
      return {
        gateway, auth: alice, sessionId, store,
        revision: initial.revision,
        action: { type: "StartTutorial" },
        verify: async () => {
          const room = await store.getRoomForPlayer(alice.playerId);
          expect(room).not.toBeNull();
          expect(room?.tutorial).toBe(true);
          expect(room?.status).toBe("ACTIVE");
          expect(room?.matchId).toBeTruthy();
        },
      };
    },
  },
  {
    name: "LeaveRoom",
    setup: async () => {
      const { store, rooms, matches, alice } = harness();
      const hub = new ConnectionHub();
      const gateway = new SessionGateway({ store, rooms, matches, hub });
      const room = await rooms.create(alice, settings);
      const sessionId = "wx-alice";
      const initial = await gateway.resume(alice, sessionId);
      return {
        gateway, auth: alice, sessionId, store,
        revision: initial.revision,
        action: { type: "LeaveRoom" },
        verify: async () => {
          const roomAfter = await store.getRoomById(room.id);
          expect(roomAfter).toBeNull();
        },
      };
    },
  },
  {
    name: "RestartMatch",
    setup: async () => {
      const { store, rooms, matches, alice } = harness();
      const hub = new ConnectionHub();
      const gateway = new SessionGateway({ store, rooms, matches, hub });
      const room = await rooms.create(alice, settings);
      await rooms.addBot(alice, room.id);
      const started = await rooms.start(alice, room.id);
      await finishMatch(store, started.snapshot.matchId!, "alice", room.id);
      const sessionId = "wx-alice";
      const initial = await gateway.resume(alice, sessionId);
      return {
        gateway, auth: alice, sessionId, store,
        revision: initial.revision,
        action: { type: "RestartMatch" },
        verify: async () => {
          const updated = await store.getRoomById(room.id);
          expect(updated?.status).toBe("ACTIVE");
          expect(updated?.matchId).toBeTruthy();
          expect(updated?.matchId).not.toBe(started.snapshot.matchId);
        },
      };
    },
  },
];

describe("room command idempotency — parameterized gateway replay coverage", () => {
  it.each(REPLAY_CASES)("replays $name through gateway without double-executing (VAL-M1-030)", async ({ setup }) => {
    const ctx = await setup();
    const envelope = gatewayEnvelope(ctx.sessionId, "cmd-replay", ctx.revision, ctx.action);

    // First execution through the gateway
    const first = await ctx.gateway.command(ctx.auth, envelope);
    expect(first.ok).toBe(true);

    // Replay the same commandId — must return the identical result
    const replay = await ctx.gateway.command(ctx.auth, envelope);
    expect(replay).toEqual(first);

    // Verify no double-execution
    await ctx.verify();
  });
});
