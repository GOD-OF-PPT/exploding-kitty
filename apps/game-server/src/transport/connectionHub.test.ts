import { describe, expect, it, vi } from "vitest";
import { ConnectionHub, type OutboundConnection } from "./connectionHub.js";

function makeConnection(
  playerId: string,
  sessionId: string,
): { connection: OutboundConnection; close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  const send = vi.fn();
  const connection: OutboundConnection = { playerId, sessionId, send, close };
  return { connection, close, send };
}

describe("ConnectionHub connection cap (VAL-M2-001)", () => {
  it("enforces per-playerId cap of 3 by default", () => {
    const hub = new ConnectionHub();
    const conns = [
      makeConnection("alice", "s1"),
      makeConnection("alice", "s2"),
      makeConnection("alice", "s3"),
      makeConnection("alice", "s4"),
    ];
    for (const { connection } of conns) hub.add(connection);
    expect(hub.connectionCount("alice")).toBe(3);
  });

  it("4th connection closes the oldest (first added) connection", () => {
    const hub = new ConnectionHub();
    const first = makeConnection("alice", "s1");
    const second = makeConnection("alice", "s2");
    const third = makeConnection("alice", "s3");
    const fourth = makeConnection("alice", "s4");
    hub.add(first.connection);
    hub.add(second.connection);
    hub.add(third.connection);
    hub.add(fourth.connection);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    expect(third.close).not.toHaveBeenCalled();
    expect(fourth.close).not.toHaveBeenCalled();
  });

  it("set size never exceeds cap across many additions", () => {
    const hub = new ConnectionHub();
    const all: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    for (let i = 0; i < 10; i++) {
      const c = makeConnection("alice", `s${i + 1}`);
      all.push(c);
      hub.add(c.connection);
    }
    expect(hub.connectionCount("alice")).toBe(3);
    // Oldest 7 should have been closed; newest 3 should not
    for (let i = 0; i < 7; i++) expect(all[i].close).toHaveBeenCalled();
    for (let i = 7; i < 10; i++) expect(all[i].close).not.toHaveBeenCalled();
  });

  it("evicted connections no longer receive messages", () => {
    const hub = new ConnectionHub();
    const conns = [
      makeConnection("alice", "s1"),
      makeConnection("alice", "s2"),
      makeConnection("alice", "s3"),
      makeConnection("alice", "s4"),
    ];
    for (const { connection } of conns) hub.add(connection);
    const envelope = { type: "snapshot" } as never;
    hub.send("alice", envelope);
    expect(conns[0].send).not.toHaveBeenCalled();
    expect(conns[1].send).toHaveBeenCalledOnce();
    expect(conns[2].send).toHaveBeenCalledOnce();
    expect(conns[3].send).toHaveBeenCalledOnce();
  });

  it("different playerIds have independent caps", () => {
    const hub = new ConnectionHub();
    for (let i = 0; i < 4; i++) hub.add(makeConnection("alice", `a${i + 1}`).connection);
    for (let i = 0; i < 4; i++) hub.add(makeConnection("bob", `b${i + 1}`).connection);
    expect(hub.connectionCount("alice")).toBe(3);
    expect(hub.connectionCount("bob")).toBe(3);
  });

  it("custom cap value is respected", () => {
    const hub = new ConnectionHub({ cap: 2 });
    const a = makeConnection("alice", "s1");
    const b = makeConnection("alice", "s2");
    const c = makeConnection("alice", "s3");
    hub.add(a.connection);
    hub.add(b.connection);
    hub.add(c.connection);
    expect(hub.connectionCount("alice")).toBe(2);
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).not.toHaveBeenCalled();
    expect(c.close).not.toHaveBeenCalled();
  });

  it("removing a connection frees a slot under the cap", () => {
    const hub = new ConnectionHub({ cap: 2 });
    const a = makeConnection("alice", "s1");
    const b = makeConnection("alice", "s2");
    const removeA = hub.add(a.connection);
    hub.add(b.connection);
    removeA();
    expect(hub.connectionCount("alice")).toBe(1);
    const c = makeConnection("alice", "s3");
    hub.add(c.connection);
    expect(hub.connectionCount("alice")).toBe(2);
    expect(b.close).not.toHaveBeenCalled();
    expect(c.close).not.toHaveBeenCalled();
  });

  it("close is called with policy-violation code 1008", () => {
    const hub = new ConnectionHub({ cap: 1 });
    const a = makeConnection("alice", "s1");
    const b = makeConnection("alice", "s2");
    hub.add(a.connection);
    hub.add(b.connection);
    expect(a.close).toHaveBeenCalledWith(1008, "connection replaced");
  });
});

describe("ConnectionHub cross-connection throttle (VAL-M2-003)", () => {
  it("tryAcquire allows up to 30 commands per second per playerId", () => {
    const hub = new ConnectionHub();
    for (let i = 0; i < 30; i++) {
      expect(hub.tryAcquire("alice")).toBe(true);
    }
  });

  it("tryAcquire rejects the 31st command in the same window", () => {
    const hub = new ConnectionHub();
    for (let i = 0; i < 30; i++) {
      expect(hub.tryAcquire("alice")).toBe(true);
    }
    expect(hub.tryAcquire("alice")).toBe(false);
  });

  it("throttle resets after the 1-second window", () => {
    vi.useFakeTimers();
    try {
      const hub = new ConnectionHub({ throttleLimit: 2, throttleWindowMs: 1_000 });
      expect(hub.tryAcquire("alice")).toBe(true);
      expect(hub.tryAcquire("alice")).toBe(true);
      expect(hub.tryAcquire("alice")).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(hub.tryAcquire("alice")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttle budget persists across connections (survives reconnect)", () => {
    const hub = new ConnectionHub({ throttleLimit: 3 });
    // Simulate socket A: exhaust the budget
    expect(hub.tryAcquire("alice")).toBe(true);
    expect(hub.tryAcquire("alice")).toBe(true);
    expect(hub.tryAcquire("alice")).toBe(true);
    expect(hub.tryAcquire("alice")).toBe(false);
    // Simulate reconnect: new socket, same playerId, same hub
    // Budget must NOT reset — the 5th command is still rejected
    expect(hub.tryAcquire("alice")).toBe(false);
  });

  it("different playerIds have independent throttle budgets", () => {
    const hub = new ConnectionHub({ throttleLimit: 2 });
    expect(hub.tryAcquire("alice")).toBe(true);
    expect(hub.tryAcquire("alice")).toBe(true);
    expect(hub.tryAcquire("alice")).toBe(false);
    // Bob has a fresh budget
    expect(hub.tryAcquire("bob")).toBe(true);
    expect(hub.tryAcquire("bob")).toBe(true);
    expect(hub.tryAcquire("bob")).toBe(false);
  });

  it("custom throttle limit and window are respected", () => {
    vi.useFakeTimers();
    try {
      const hub = new ConnectionHub({ throttleLimit: 5, throttleWindowMs: 2_000 });
      for (let i = 0; i < 5; i++) expect(hub.tryAcquire("alice")).toBe(true);
      expect(hub.tryAcquire("alice")).toBe(false);
      vi.advanceTimersByTime(1_500);
      expect(hub.tryAcquire("alice")).toBe(false); // still within 2s window
      vi.advanceTimersByTime(600);
      expect(hub.tryAcquire("alice")).toBe(true); // 2.1s elapsed, window reset
    } finally {
      vi.useRealTimers();
    }
  });
});
