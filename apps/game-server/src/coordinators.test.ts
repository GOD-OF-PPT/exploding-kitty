import { describe, expect, it } from "vitest";
import { MatchCoordinator } from "./match/matchCoordinator.js";
import { RoomCoordinator } from "./room/roomCoordinator.js";
import { MemoryGameStore } from "./persistence/memoryStore.js";
import { ConnectionHub } from "./transport/connectionHub.js";
import { SessionGateway } from "./transport/sessionGateway.js";
import { PROTOCOL_VERSION } from "@exploding-kitty/protocol";

function harness(now = 1_000) {
  const store = new MemoryGameStore();
  let id = 0;
  const clock = { now: () => now };
  const ids = { next: (prefix: string) => `${prefix}-${++id}` };
  const rooms = new RoomCoordinator({ store, clock, ids });
  const matches = new MatchCoordinator({ store, clock, token: ids });
  const alice = { playerId: "alice", sessionToken: "session-alice" } as const;
  return { store, rooms, matches, alice };
}

async function startedHarness() {
  const context = harness();
  const room = await context.rooms.create(context.alice, {
    maxPlayers: 2,
    turnSeconds: 45,
    responseSeconds: 5,
    choiceSeconds: 15,
    allowBots: true,
    rulesetVersion: "original-2025@1",
  });
  await context.rooms.addBot(context.alice, room.id);
  const started = await context.rooms.start(context.alice, room.id);
  return { ...context, room, started };
}

describe("authoritative room and match flow", () => {
  it("serializes concurrent joins without losing members", async () => {
    const context = harness();
    const bob = { playerId: "bob", sessionToken: "session-bob" } as const;
    const carol = { playerId: "carol", sessionToken: "session-carol" } as const;
    const room = await context.rooms.create(context.alice, {
      maxPlayers: 3, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, rulesetVersion: "original-2025@1",
    });

    const results = await Promise.allSettled([
      context.rooms.join(bob, room.code),
      context.rooms.join(carol, room.code),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const updated = await context.store.getRoomById(room.id);
    expect(updated?.members.map((member) => member.id)).toEqual(["alice", "bob", "carol"]);
    expect(updated?.revision).toBe(3);
  });

  it("atomically creates one match when start is requested concurrently", async () => {
    const context = harness();
    const room = await context.rooms.create(context.alice, {
      maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, rulesetVersion: "original-2025@1",
    });
    await context.rooms.addBot(context.alice, room.id);

    const results = await Promise.allSettled([
      context.rooms.start(context.alice, room.id),
      context.rooms.start(context.alice, room.id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({ status: "rejected", reason: { code: "MATCH_ALREADY_STARTED" } });
    const activeRoom = await context.store.getRoomById(room.id);
    expect(activeRoom).toMatchObject({ status: "ACTIVE" });
    expect(await context.store.getMatch(activeRoom?.matchId ?? "")).not.toBeNull();
  });

  it("does not let lobby membership change after the locked start transition", async () => {
    const context = harness();
    const room = await context.rooms.create(context.alice, {
      maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, rulesetVersion: "original-2025@1",
    });
    const lobby = await context.rooms.addBot(context.alice, room.id);
    const botId = lobby.members.find((member) => member.bot)?.id ?? "";
    await context.rooms.start(context.alice, room.id);

    await expect(context.rooms.removeBot(context.alice, room.id, botId))
      .rejects.toMatchObject({ code: "MATCH_ALREADY_STARTED" });
    await expect(context.rooms.setReady(context.alice, room.id, false))
      .rejects.toMatchObject({ code: "MATCH_ALREADY_STARTED" });
    expect((await context.store.getRoomById(room.id))?.members).toHaveLength(2);
  });

  it("rolls back both the staged match and room transition when a room transaction fails", async () => {
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
    const alice = { playerId: "alice", sessionToken: "session-alice" } as const;
    const rooms = new RoomCoordinator({ store, clock: { now: () => 1_000 }, ids });
    const room = await rooms.create(alice, {
      maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, rulesetVersion: "original-2025@1",
    });
    await rooms.addBot(alice, room.id);
    store.failNextRoomTransaction = true;

    await expect(rooms.start(alice, room.id)).rejects.toThrow("simulated commit failure");

    const unchangedRoom = await store.getRoomById(room.id);
    expect(unchangedRoom).toMatchObject({ status: "LOBBY", revision: 2 });
    expect(unchangedRoom?.matchId).toBeUndefined();
    expect(await store.getMatch("match-3")).toBeNull();
  });

  it("atomically creates a two-player tutorial match and preserves its teaching seed on restart", async () => {
    const context = harness();
    const started = await context.rooms.startTutorial(context.alice);
    const room = await context.store.getRoomForPlayer(context.alice.playerId);
    const firstTypes = started.snapshot.you?.hand.map((card) => card.type) ?? [];

    expect(room).toMatchObject({ tutorial: true, status: "ACTIVE", revision: 3 });
    expect(room?.members).toHaveLength(2);
    expect(room?.members.filter((member) => member.bot)).toHaveLength(1);
    expect(await context.store.getMatch(room?.matchId ?? "")).not.toBeNull();
    expect(firstTypes).toEqual(expect.arrayContaining(["ATTACK", "FAVOR", "SKIP", "SEE_FUTURE"]));

    const firstMatch = await context.store.getMatch(room?.matchId ?? "");
    const botId = room?.members.find((member) => member.bot)?.id ?? "";
    const finished = structuredClone(firstMatch!);
    finished.state.players[botId].alive = false;
    finished.state.status = "FINISHED";
    finished.state.winnerId = context.alice.playerId;
    await context.store.transactMatch(finished.id, async (transaction) => { await transaction.saveMatch(finished); });
    await context.store.saveRoom({ ...room!, status: "FINISHED" });

    const restarted = await context.rooms.restart(context.alice, room!.id);
    expect(restarted.snapshot.matchId).not.toBe(started.snapshot.matchId);
    expect(restarted.snapshot.you?.hand.map((card) => card.type)).toEqual(firstTypes);
  });

  it("does not leave a partial tutorial room when its atomic store write fails", async () => {
    class TutorialWriteFailingStore extends MemoryGameStore {
      override async createRoomWithMatch(): Promise<void> {
        throw new Error("simulated tutorial transaction failure");
      }
    }
    const store = new TutorialWriteFailingStore();
    let id = 0;
    const ids = { next: (prefix: string) => `${prefix}-${++id}` };
    const alice = { playerId: "alice", sessionToken: "session-alice" } as const;
    const rooms = new RoomCoordinator({ store, clock: { now: () => 1_000 }, ids });

    await expect(rooms.startTutorial(alice)).rejects.toThrow("simulated tutorial transaction failure");
    expect(await store.getRoomForPlayer(alice.playerId)).toBeNull();
    expect(await store.getRoomById("room-1")).toBeNull();
    expect(await store.getMatch("match-2")).toBeNull();
  });

  it("binds the authenticated player, increments revision, and deduplicates commands", async () => {
    const { store, matches, alice, room, started } = await startedHarness();
    expect(started.revision).toBeGreaterThan(2);
    expect(started.snapshot.viewerId).toBe("alice");
    expect(started.snapshot.you?.hand).toHaveLength(8);
    expect(started.snapshot.you?.hand.every((card) => card.token && !("id" in card))).toBe(true);

    const turnId = started.snapshot.turn?.id ?? "";
    const first = await matches.execute(alice, {
      sessionId: room.id,
      commandId: "draw-once",
      expectedRevision: started.revision,
      action: { type: "Draw", turnId },
    });
    const duplicate = await matches.execute(alice, {
      sessionId: room.id,
      commandId: "draw-once",
      expectedRevision: started.revision,
      action: { type: "Draw", turnId },
    });

    expect(first).toEqual({ ok: true, commandId: "draw-once", revision: started.revision + 1 });
    expect(duplicate).toEqual(first);
    const activeRoom = await store.getRoomById(room.id);
    expect((await store.getMatch(activeRoom?.matchId ?? ""))?.revision).toBe(started.revision + 1);
  });

  it("keeps a committed match command successful when room-status synchronization fails", async () => {
    class RoomSyncFailingStore extends MemoryGameStore {
      failRoomSync = false;

      override async transactRoom<T>(
        roomId: string,
        operation: Parameters<MemoryGameStore["transactRoom"]>[1],
      ): Promise<T> {
        if (this.failRoomSync) throw new Error("simulated room sync failure");
        return super.transactRoom(roomId, operation) as Promise<T>;
      }
    }
    const store = new RoomSyncFailingStore();
    let id = 0;
    const ids = { next: (prefix: string) => `${prefix}-${++id}` };
    const alice = { playerId: "alice", sessionToken: "session-alice" } as const;
    const rooms = new RoomCoordinator({ store, clock: { now: () => 1_000 }, ids });
    const matches = new MatchCoordinator({ store, clock: { now: () => 1_000 }, token: ids });
    const room = await rooms.create(alice, {
      maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, rulesetVersion: "original-2025@1",
    });
    await rooms.addBot(alice, room.id);
    const started = await rooms.start(alice, room.id);
    store.failRoomSync = true;

    const result = await matches.execute(alice, {
      sessionId: room.id,
      commandId: "committed-despite-room-sync",
      expectedRevision: started.revision,
      action: { type: "Draw", turnId: started.snapshot.turn?.id ?? "" },
    });

    expect(result).toMatchObject({ ok: true, commandId: "committed-despite-room-sync" });
    expect((await store.getMatch(started.snapshot.matchId ?? ""))?.revision).toBe(started.revision + 1);
  });

  it("rejects another player's or expired card token without mutating the match", async () => {
    const { store, matches, alice, room, started } = await startedHarness();
    const playable = started.snapshot.you?.hand.find((card) => card.type !== "DEFUSE")!;
    const forged = await matches.execute(alice, {
      sessionId: room.id,
      commandId: "forged-token",
      expectedRevision: started.revision,
      action: {
        type: "PlayCards",
        turnId: started.snapshot.turn?.id ?? "",
        cardTokens: [`not-${playable.token}`],
      },
    });
    const duplicate = await matches.execute(alice, {
      sessionId: room.id,
      commandId: "forged-token",
      expectedRevision: started.revision,
      action: {
        type: "PlayCards",
        turnId: started.snapshot.turn?.id ?? "",
        cardTokens: [playable.token],
      },
    });

    expect(forged).toMatchObject({ ok: false, revision: started.revision, problem: { code: "CARD_NOT_OWNED" } });
    expect(duplicate).toMatchObject({ ok: false, revision: started.revision, problem: { code: "COMMAND_ID_REUSED", retryable: false } });
    const activeRoom = await store.getRoomById(room.id);
    expect((await store.getMatch(activeRoom?.matchId ?? ""))?.revision).toBe(started.revision);
  });

  it("returns only viewer-private cards and a full current snapshot on resume", async () => {
    const { matches, alice, room, started } = await startedHarness();
    const resumed = await matches.resume(alice, room.id);
    expect(resumed).toEqual(started);
    expect(resumed.snapshot.you?.hand.every((card) => Boolean(card.token))).toBe(true);
    expect(JSON.stringify(resumed.snapshot)).not.toContain('"id":"DEFUSE-');
    expect(resumed.snapshot.players?.find((player) => player.bot)?.handCount).toBe(8);
  });

  it("allows only the host to start and rejects stale expected revisions", async () => {
    const { rooms, matches, alice, room, started } = await startedHarness();
    await expect(rooms.start({ playerId: "mallory", sessionToken: "x" }, room.id))
      .rejects.toMatchObject({ code: "NOT_ROOM_HOST" });
    const result = await matches.execute(alice, {
      sessionId: room.id,
      commandId: "stale",
      expectedRevision: 0,
      action: { type: "Draw", turnId: started.snapshot.turn?.id ?? "" },
    });
    expect(result).toMatchObject({ ok: false, revision: started.revision, problem: { code: "REVISION_CONFLICT", retryable: true } });
  });

  it("records member restart votes without letting a member start the next match", async () => {
    const context = harness();
    const bob = { playerId: "bob", sessionToken: "session-bob" } as const;
    const room = await context.rooms.create(context.alice, {
      maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: false, rulesetVersion: "original-2025@1",
    });
    await context.rooms.join(bob, room.code);
    await context.rooms.setReady(bob, room.id, true);
    await context.rooms.start(context.alice, room.id);
    const activeRoom = await context.store.getRoomById(room.id);
    const match = await context.store.getMatch(activeRoom?.matchId ?? "");
    const finished = structuredClone(match!);
    finished.state.players.bob.alive = false;
    finished.state.status = "FINISHED";
    finished.state.winnerId = "alice";
    await context.store.transactMatch(finished.id, async (transaction) => { await transaction.saveMatch(finished); });
    await context.store.saveRoom({ ...activeRoom!, status: "FINISHED" });
    const voted = await context.rooms.voteRestart(bob, room.id);
    expect(voted.snapshot.restartVotes).toEqual(["bob"]);
    expect((await context.store.getRoomById(room.id))?.matchId).toBe(activeRoom?.matchId);
  });
});

describe("session gateway reliability", () => {
  it("keeps a player connected until their final socket is removed", () => {
    const hub = new ConnectionHub();
    const first = hub.add({ playerId: "alice", sessionId: "bootstrap_alice", send: () => undefined });
    const second = hub.add({ playerId: "alice", sessionId: "room-1", send: () => undefined });

    first();
    expect(hub.hasConnections("alice")).toBe(true);
    second();
    expect(hub.hasConnections("alice")).toBe(false);
  });

  it("delivers HOME to the leaving actor and keeps revisions monotonic across rooms", async () => {
    const { store, rooms, matches, alice } = harness();
    const hub = new ConnectionHub();
    const gateway = new SessionGateway({ store, rooms, matches, hub });
    const sessionId = "wx-alice";
    const snapshots: Array<{ revision: number; phase?: string }> = [];
    hub.add({ playerId: alice.playerId, sessionId, send: (message) => {
      if (message.type === "snapshot") snapshots.push({ revision: message.revision, phase: message.snapshot.phase });
    } });
    const initial = await gateway.resume(alice, sessionId);
    const settings = { maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, rulesetVersion: "original-2025@1" } as const;
    const create = await gateway.command(alice, { type: "command", protocolVersion: PROTOCOL_VERSION, sessionId, commandId: "create-1", expectedRevision: initial.revision, action: { type: "CreateRoom", settings } });
    expect(create.ok).toBe(true);
    const leave = await gateway.command(alice, { type: "command", protocolVersion: PROTOCOL_VERSION, sessionId, commandId: "leave-1", expectedRevision: create.ok ? create.revision : -1, action: { type: "LeaveRoom" } });
    expect(leave.ok).toBe(true);
    expect(snapshots.at(-1)?.phase).toBe("HOME");
    const createAgain = await gateway.command(alice, { type: "command", protocolVersion: PROTOCOL_VERSION, sessionId, commandId: "create-2", expectedRevision: leave.ok ? leave.revision : -1, action: { type: "CreateRoom", settings } });
    expect(createAgain.ok).toBe(true);
    expect(createAgain.ok && leave.ok && createAgain.revision).toBeGreaterThan(leave.ok ? leave.revision : -1);
  });

  it("deduplicates room commands and rejects command ids reused with another payload", async () => {
    const { store, rooms, matches, alice } = harness();
    const gateway = new SessionGateway({ store, rooms, matches, hub: new ConnectionHub() });
    const sessionId = "wx-alice";
    const initial = await gateway.resume(alice, sessionId);
    const settings = { maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, rulesetVersion: "original-2025@1" } as const;
    const envelope = { type: "command", protocolVersion: PROTOCOL_VERSION, sessionId, commandId: "create-idempotent", expectedRevision: initial.revision, action: { type: "CreateRoom", settings } } as const;
    const first = await gateway.command(alice, envelope);
    const duplicate = await gateway.command(alice, envelope);
    expect(duplicate).toEqual(first);
    const reused = await gateway.command(alice, { ...envelope, action: { type: "CreateRoom", settings: { ...settings, maxPlayers: 3 } } });
    expect(reused).toMatchObject({ ok: false, problem: { code: "COMMAND_ID_REUSED", retryable: false } });
  });

  it("recovers a committed match command before checking a stale logical revision", async () => {
    const { store, rooms, matches, alice, room, started } = await startedHarness();
    const gateway = new SessionGateway({ store, rooms, matches, hub: new ConnectionHub() });
    const turnId = started.snapshot.turn?.id ?? "";
    const action = { type: "Draw" as const, turnId };
    await gateway.resume(alice, room.id);

    const committed = await matches.execute(alice, {
      sessionId: room.id,
      commandId: "committed-before-session-receipt",
      expectedRevision: started.revision,
      action,
    });
    expect(committed.ok).toBe(true);

    const recovered = await gateway.command(alice, {
      type: "command",
      protocolVersion: PROTOCOL_VERSION,
      sessionId: room.id,
      commandId: "committed-before-session-receipt",
      expectedRevision: started.revision,
      action,
    });
    expect(recovered).toMatchObject({ ok: true, commandId: "committed-before-session-receipt" });
    const activeRoom = await store.getRoomById(room.id);
    expect((await store.getMatch(activeRoom?.matchId ?? ""))?.revision).toBe(committed.revision);

    const genuinelyNew = await gateway.command(alice, {
      type: "command",
      protocolVersion: PROTOCOL_VERSION,
      sessionId: room.id,
      commandId: "new-stale-command",
      expectedRevision: started.revision,
      action,
    });
    expect(genuinelyNew).toMatchObject({ ok: false, problem: { code: "REVISION_CONFLICT", retryable: true } });
  });

  it("maps private prompts to wire actions and includes real public results", async () => {
    const { store, rooms, matches, alice, room, started } = await startedHarness();
    expect(started.snapshot.turn?.number).toBe(1);
    const activeRoom = await store.getRoomById(room.id);
    const match = await store.getMatch(activeRoom?.matchId ?? "");
    expect(match).not.toBeNull();
    const peekCard = match!.state.players.alice.hand.find((card) => card.type === "SEE_FUTURE");
    if (peekCard) {
      const token = match!.tokens.find((item) => item.cardId === peekCard.id && item.ownerId === "alice")?.token ?? "";
      const played = await matches.execute(alice, {
        sessionId: room.id, commandId: "peek-play", expectedRevision: started.revision,
        action: { type: "PlayCards", turnId: started.snapshot.turn?.id ?? "", cardTokens: [token] },
      });
      expect(played.ok).toBe(true);
      const response = await matches.resume(alice, room.id);
      expect(response.snapshot.pending).toMatchObject({ kind: "RESPONSE", viewerPassed: false, canPass: true });
    }
    expect(started.snapshot.events?.some((event) => event.type === "MATCH_STARTED")).toBe(true);
  });
});
