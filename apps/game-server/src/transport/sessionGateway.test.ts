import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchCoordinator } from "../match/matchCoordinator.js";
import { RoomCoordinator } from "../room/roomCoordinator.js";
import { MemoryGameStore } from "../persistence/memoryStore.js";
import { ConnectionHub } from "./connectionHub.js";
import { SessionGateway } from "./sessionGateway.js";
import type { AuthContext } from "../model.js";

const SETTINGS = {
  maxPlayers: 2,
  turnSeconds: 45,
  responseSeconds: 5,
  choiceSeconds: 15,
  allowBots: true,
  rulesetVersion: "original-2025@1",
} as const;

function gatewayHarness(options?: { broadcastDebounceMs?: number }) {
  const store = new MemoryGameStore();
  let id = 0;
  const clock = { now: () => 1_000 };
  const ids = { next: (prefix: string) => `${prefix}-${++id}` };
  const rooms = new RoomCoordinator({ store, clock, ids });
  const matches = new MatchCoordinator({ store, clock, token: ids });
  const hub = new ConnectionHub();
  const gateway = new SessionGateway({
    store,
    rooms,
    matches,
    hub,
    ...(options?.broadcastDebounceMs !== undefined ? { broadcastDebounceMs: options.broadcastDebounceMs } : {}),
  });
  const alice: AuthContext = { playerId: "alice", sessionToken: "session-alice" };
  const bob: AuthContext = { playerId: "bob", sessionToken: "session-bob" };
  return { store, rooms, matches, hub, gateway, alice, bob };
}

async function setupRoomWithMembers(
  rooms: RoomCoordinator,
  alice: AuthContext,
  bob: AuthContext,
) {
  const room = await rooms.create(alice, SETTINGS);
  await rooms.join(bob, room.code);
  return room;
}

describe("SessionGateway presence broadcast debounce (VAL-M2-004)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("two rapid broadcastPresence calls within the window produce one actual broadcast execution", async () => {
    const { gateway, rooms, alice, bob } = gatewayHarness({ broadcastDebounceMs: 500 });
    await setupRoomWithMembers(rooms, alice, bob);
    const broadcastSpy = vi.spyOn(gateway, "broadcast").mockResolvedValue(undefined);

    gateway.broadcastPresence("room-1");
    gateway.broadcastPresence("room-1");

    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    // Advancing past the debounce window does not fire an additional broadcast
    vi.advanceTimersByTime(600);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    gateway.disposeBroadcastDebounce();
  });

  it("single broadcastPresence call executes immediately without delay", async () => {
    const { gateway, rooms, alice, bob } = gatewayHarness({ broadcastDebounceMs: 500 });
    await setupRoomWithMembers(rooms, alice, bob);
    const broadcastSpy = vi.spyOn(gateway, "broadcast").mockResolvedValue(undefined);

    // The first call fires the broadcast synchronously (leading edge)
    gateway.broadcastPresence("room-1");

    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    gateway.disposeBroadcastDebounce();
  });

  it("per-room isolation: rapid toggles on room A and B each produce one broadcast", async () => {
    const { gateway, rooms, alice, bob } = gatewayHarness({ broadcastDebounceMs: 500 });
    await setupRoomWithMembers(rooms, alice, bob);
    const broadcastSpy = vi.spyOn(gateway, "broadcast").mockResolvedValue(undefined);

    gateway.broadcastPresence("room-A");
    gateway.broadcastPresence("room-A");
    gateway.broadcastPresence("room-B");
    gateway.broadcastPresence("room-B");

    expect(broadcastSpy).toHaveBeenCalledTimes(2);
    expect(broadcastSpy).toHaveBeenCalledWith("room-A");
    expect(broadcastSpy).toHaveBeenCalledWith("room-B");

    gateway.disposeBroadcastDebounce();
  });

  it("after the debounce window expires, the next broadcastPresence executes immediately", async () => {
    const { gateway, rooms, alice, bob } = gatewayHarness({ broadcastDebounceMs: 500 });
    await setupRoomWithMembers(rooms, alice, bob);
    const broadcastSpy = vi.spyOn(gateway, "broadcast").mockResolvedValue(undefined);

    gateway.broadcastPresence("room-1");
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    // Second call within the window is suppressed
    gateway.broadcastPresence("room-1");
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    // After the window closes, the next call fires immediately
    vi.advanceTimersByTime(600);
    gateway.broadcastPresence("room-1");
    expect(broadcastSpy).toHaveBeenCalledTimes(2);

    gateway.disposeBroadcastDebounce();
  });

  it("match command broadcast() is NOT debounced — executes even during an active presence debounce window", async () => {
    const { gateway, rooms, alice, bob } = gatewayHarness({ broadcastDebounceMs: 500 });
    await setupRoomWithMembers(rooms, alice, bob);
    const broadcastSpy = vi.spyOn(gateway, "broadcast").mockResolvedValue(undefined);

    // Open a presence debounce window
    gateway.broadcastPresence("room-1");
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    // Direct broadcast() calls (match commands, deadline worker) bypass the debounce
    await gateway.broadcast("room-1");
    await gateway.broadcast("room-1");
    expect(broadcastSpy).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(600);
    gateway.disposeBroadcastDebounce();
  });
});

describe("SessionGateway reconnect broadcast does not block (VAL-M2-005)", () => {
  it("broadcastPresence returns void — does not await or block on the broadcast", async () => {
    const { gateway } = gatewayHarness({ broadcastDebounceMs: 500 });
    let resolveBroadcast: () => void = () => undefined;
    vi.spyOn(gateway, "broadcast").mockImplementation(
      () => new Promise<void>((resolve) => { resolveBroadcast = resolve; }),
    );

    // broadcastPresence is synchronous (returns void), not a Promise — it
    // fire-and-forgets the broadcast so the caller is never blocked.
    const result = gateway.broadcastPresence("room-1");
    expect(result).toBeUndefined();

    // Clean up the pending broadcast promise and debounce timer
    resolveBroadcast();
    gateway.disposeBroadcastDebounce();
  });

  it("reconnector receives resume snapshot immediately while presence broadcast is coalesced", async () => {
    vi.useFakeTimers();
    try {
      const { gateway, rooms, alice, bob } = gatewayHarness({ broadcastDebounceMs: 500 });
      const room = await setupRoomWithMembers(rooms, alice, bob);

      // Mock broadcast so the coalesced presence update does not touch the hub
      const broadcastSpy = vi.spyOn(gateway, "broadcast").mockResolvedValue(undefined);

      // The reconnector's resume response is a direct reply, not a broadcast.
      // It returns immediately with the viewer's snapshot.
      const resumed = await gateway.resume(alice, room.id);
      expect(resumed.type).toBe("snapshot");
      expect(resumed.snapshot.viewerId).toBe("alice");

      // The presence broadcast to other members is coalesced (debounced) and
      // does not block the reconnector's already-returned resume response.
      gateway.broadcastPresence(room.id);
      expect(broadcastSpy).toHaveBeenCalledTimes(1);

      // A second rapid presence toggle is coalesced — no extra broadcast
      gateway.broadcastPresence(room.id);
      expect(broadcastSpy).toHaveBeenCalledTimes(1);

      gateway.disposeBroadcastDebounce();
    } finally {
      vi.useRealTimers();
    }
  });
});
