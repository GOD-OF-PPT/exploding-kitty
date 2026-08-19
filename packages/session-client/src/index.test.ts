import { describe, expect, it } from "vitest";
import type { ClientEnvelope, ServerEnvelope } from "@exploding-kitty/protocol";
import {
  LocalGameSession,
  MemorySessionRepository,
  MemoryTransport,
  RemoteGameSession,
  type LocalKernelAdapter,
  type SessionSnapshot,
} from "./index";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RemoteGameSession", () => {
  it("accepts full snapshots with jumping revisions and ignores stale snapshots", async () => {
    const transport = new MemoryTransport<ClientEnvelope, ServerEnvelope<{ value: number }>>();
    const session = await RemoteGameSession.open({ sessionId: "s", transport, repository: new MemorySessionRepository() });
    transport.open(); await flush();
    transport.message({ type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 20, snapshot: { value: 20 } });
    transport.message({ type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 19, snapshot: { value: 19 } });
    expect(session.getSnapshot()).toMatchObject({ lifecycle: "active", revision: 20, view: { value: 20 } });
  });

  it("settles an ack arriving before its snapshot and persists one-command outbox", async () => {
    const repository = new MemorySessionRepository();
    const transport = new MemoryTransport<ClientEnvelope, ServerEnvelope<{ value: number }>>();
    const session = await RemoteGameSession.open({ sessionId: "s", transport, repository, commandId: () => "c1" });
    transport.open(); await flush(); transport.clearSent();
    const sent = session.send({ type: "Draw", turnId: "turn-1" }); await flush();
    expect((await repository.load("s"))?.payload).toMatchObject({ outbox: { commandId: "c1" } });
    transport.message({ type: "command.ack", protocolVersion: 1, sessionId: "s", commandId: "c1", ok: true, revision: 5 });
    await expect(sent).resolves.toEqual({ ok: true, commandId: "c1", revision: 5 });
    expect(transport.sent.at(-1)).toMatchObject({ type: "resume", lastRevision: 0 });
    transport.message({ type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 5, snapshot: { value: 5 } });
    expect(session.getSnapshot()).toMatchObject({ revision: 5, view: { value: 5 } });
    expect((await repository.load("s"))?.payload).not.toHaveProperty("outbox");
  });

  it("uses a fresh login credential for the first resume instead of a cached token", async () => {
    const repository = new MemorySessionRepository([{
      schemaVersion: 1,
      mode: "remote",
      sessionId: "s",
      updatedAt: 1,
      payload: { revision: 4, commandRevision: 4, view: { value: 4 }, resumeToken: "stale-token" },
    }]);
    const transport = new MemoryTransport<ClientEnvelope, ServerEnvelope<{ value: number }>>();
    await RemoteGameSession.open({
      sessionId: "s",
      transport,
      repository,
      initialResumeToken: "fresh-login-token",
    });

    transport.open();
    await flush();

    expect(transport.sent[0]).toMatchObject({
      type: "resume",
      sessionId: "s",
      lastRevision: 4,
      resumeToken: "fresh-login-token",
    });
  });
});

describe("LocalGameSession", () => {
  it("conforms to GameSession interface, send() returns ok ack, and subscribe() fires on state change", async () => {
    type S = { count: number };
    type V = { count: number };

    const kernel: LocalKernelAdapter<S, V> = {
      create: () => ({ count: 0 }),
      restore: (payload) => (payload as S) ?? { count: 0 },
      execute: (state) => {
        const next = { count: state.count + 1 };
        return { ok: true, state: next };
      },
      project: (s) => ({ count: s.count }),
      serialize: (s) => s,
    };

    const session = await LocalGameSession.open({
      sessionId: "local-1",
      kernel,
      repository: new MemorySessionRepository(),
      commandId: () => "cmd-1",
      now: () => 1_000,
    });

    expect(session.getSnapshot()).toMatchObject({
      lifecycle: "active",
      connectivity: "local",
      view: { count: 0 },
      revision: 0,
    });

    const snapshots: SessionSnapshot<V>[] = [];
    const unsubscribe = session.subscribe(() => snapshots.push(session.getSnapshot()));

    const result = await session.send({ type: "Concede" });

    expect(result).toEqual({ ok: true, commandId: "cmd-1", revision: 1 });
    expect(session.getSnapshot()).toMatchObject({ view: { count: 1 }, revision: 1 });
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.at(-1)).toMatchObject({ view: { count: 1 }, revision: 1 });

    unsubscribe();
    session.dispose();
    expect(session.getSnapshot()).toMatchObject({ view: { count: 1 }, revision: 1 });
  });
});

describe("RemoteGameSession ack timeout", () => {
  it("settles with retryable:true after timeout and preserves outbox for retry", async () => {
    const repository = new MemorySessionRepository();
    const transport = new MemoryTransport<ClientEnvelope, ServerEnvelope<{ value: number }>>();
    const session = await RemoteGameSession.open({
      sessionId: "s",
      transport,
      repository,
      commandId: () => "c-timeout",
      ackTimeoutMs: 50,
    });
    transport.open();
    await flush();
    transport.clearSent();

    const result = await session.send({ type: "Concede" });

    expect(result).toMatchObject({
      ok: false,
      commandId: "c-timeout",
      code: "COMMAND_TIMEOUT",
      retryable: true,
    });

    const stored = await repository.load("s");
    expect(stored?.payload).toMatchObject({ outbox: { commandId: "c-timeout" } });

    session.dispose();
  });
});

describe("RemoteGameSession transport failure and snapshot interleaving", () => {
  it("preserves outbox when transport send fails", async () => {
    const repository = new MemorySessionRepository();
    const transport = new MemoryTransport<ClientEnvelope, ServerEnvelope<{ value: number }>>();
    const session = await RemoteGameSession.open({
      sessionId: "s",
      transport,
      repository,
      commandId: () => "c-fail",
      ackTimeoutMs: 10_000,
    });
    transport.open();
    await flush();
    transport.clearSent();

    transport.failNext(new Error("network down"));
    const result = await session.send({ type: "Concede" });

    expect(result).toMatchObject({
      ok: false,
      commandId: "c-fail",
      code: "TRANSPORT_SEND_FAILED",
      retryable: true,
    });

    const stored = await repository.load("s");
    expect(stored?.payload).toMatchObject({ outbox: { commandId: "c-fail" } });

    session.dispose();
  });

  it("applies a snapshot arriving mid-command without corrupting state", async () => {
    const repository = new MemorySessionRepository();
    const transport = new MemoryTransport<ClientEnvelope, ServerEnvelope<{ value: number }>>();
    const session = await RemoteGameSession.open({
      sessionId: "s",
      transport,
      repository,
      commandId: () => "c-mid",
      ackTimeoutMs: 10_000,
    });
    transport.open();
    await flush();
    transport.clearSent();

    const sendPromise = session.send({ type: "Concede" });
    await flush();

    // Snapshot arrives while the command is in-flight
    transport.message({
      type: "snapshot",
      protocolVersion: 1,
      sessionId: "s",
      revision: 10,
      snapshot: { value: 42 },
    });
    await flush();

    expect(session.getSnapshot()).toMatchObject({ revision: 10, view: { value: 42 } });

    // Ack arrives for the in-flight command
    transport.message({
      type: "command.ack",
      protocolVersion: 1,
      sessionId: "s",
      commandId: "c-mid",
      ok: true,
      revision: 10,
    });

    const result = await sendPromise;
    expect(result).toMatchObject({ ok: true, commandId: "c-mid", revision: 10 });
    expect(session.getSnapshot()).toMatchObject({ revision: 10, view: { value: 42 } });

    session.dispose();
  });
});
