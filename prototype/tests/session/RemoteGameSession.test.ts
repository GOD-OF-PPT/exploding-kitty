import { describe, expect, it } from "vitest";

import { MemorySessionRepository } from "../../src/adapters/persistence/MemorySessionRepository";
import { FakeTransport } from "../../src/adapters/transport/FakeTransport";
import type {
  ClientEnvelope,
  ServerEnvelope,
} from "../../src/session/public";
import { RemoteGameSession } from "../../src/session/remote/RemoteGameSession";

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RemoteGameSession", () => {
  it("restores cached view, resumes, enforces sequence, and resumes after reconnect", async () => {
    const repository = new MemorySessionRepository([
      {
        schemaVersion: 1,
        mode: "remote",
        sessionId: "remote-resume",
        updatedAt: 100,
        payload: { sequence: 2, view: { value: 2 }, resumeToken: "resume-me" },
      },
    ]);
    const transport = new FakeTransport<ClientEnvelope, ServerEnvelope>();
    const session = await RemoteGameSession.open({
      sessionId: "remote-resume",
      transport,
      repository,
      now: () => 500,
    });

    expect(session.getSnapshot()).toMatchObject({
      lifecycle: "recovering",
      connectivity: "connecting",
      lastSequence: 2,
      view: { value: 2 },
    });

    transport.open();
    await flush();
    expect(transport.sent.at(-1)).toMatchObject({
      type: "session.resume",
      sessionId: "remote-resume",
      lastSequence: 2,
      resumeToken: "resume-me",
    });

    transport.message({
      type: "session.view",
      sessionId: "remote-resume",
      sequence: 3,
      view: { value: 3 },
    });
    expect(session.getSnapshot()).toMatchObject({ lastSequence: 3, view: { value: 3 } });

    transport.message({
      type: "session.view",
      sessionId: "remote-resume",
      sequence: 5,
      view: { value: 5 },
    });
    await flush();
    expect(session.getSnapshot()).toMatchObject({
      lifecycle: "recovering",
      lastSequence: 3,
      view: { value: 3 },
      problem: { code: "SEQUENCE_GAP" },
    });
    expect(transport.sent.at(-1)).toMatchObject({ type: "session.resume", lastSequence: 3 });

    transport.close(true);
    expect(session.getSnapshot()).toMatchObject({ lifecycle: "recovering", connectivity: "connecting" });
    transport.open();
    await flush();
    expect(transport.sent.at(-1)).toMatchObject({ type: "session.resume", lastSequence: 3 });
  });

  it("serializes commands, wraps them in envelopes, and resolves server results", async () => {
    const transport = new FakeTransport<ClientEnvelope, ServerEnvelope>();
    let nextId = 0;
    const session = await RemoteGameSession.open({
      sessionId: "remote-order",
      transport,
      repository: new MemorySessionRepository(),
      commandId: () => `remote-command-${++nextId}`,
      now: () => 2_000,
      ackTimeoutMs: 2_000,
    });
    transport.open();
    await flush();
    transport.clearSent();

    const first = session.send({ type: "match.draw" });
    const second = session.send({ type: "room.leave" });
    await flush();

    const firstEnvelope = transport.sent[0];
    expect(firstEnvelope).toMatchObject({
      type: "session.command",
      protocolVersion: 1,
      sessionId: "remote-order",
      commandId: "remote-command-1",
      sequence: 0,
      sentAt: 2_000,
      intent: { type: "match.draw" },
    });
    expect(transport.sent).toHaveLength(1);

    transport.message({
      type: "session.command-result",
      sessionId: "remote-order",
      commandId: "remote-command-1",
      ok: true,
      sequence: 1,
      view: { value: 1 },
    });
    await expect(first).resolves.toMatchObject({ ok: true, commandId: "remote-command-1", sequence: 1 });
    await flush();

    expect(transport.sent[1]).toMatchObject({
      type: "session.command",
      commandId: "remote-command-2",
      sequence: 1,
      intent: { type: "room.leave" },
    });
    transport.message({
      type: "session.command-result",
      sessionId: "remote-order",
      commandId: "remote-command-2",
      ok: false,
      problem: { code: "CANNOT_LEAVE", message: "Already ending", retryable: false },
    });
    await expect(second).resolves.toEqual({
      ok: false,
      commandId: "remote-command-2",
      code: "CANNOT_LEAVE",
      message: "Already ending",
      retryable: false,
    });
  });

  it("returns transport errors and dispose errors as results", async () => {
    const transport = new FakeTransport<ClientEnvelope, ServerEnvelope>();
    const session = await RemoteGameSession.open({
      sessionId: "remote-errors",
      transport,
      repository: new MemorySessionRepository(),
      commandId: () => "failed-command",
    });
    transport.open();
    await flush();
    transport.failNext(new Error("socket write failed"));

    await expect(session.send({ type: "match.draw" })).resolves.toMatchObject({
      ok: false,
      commandId: "failed-command",
      code: "TRANSPORT_SEND_FAILED",
      retryable: true,
    });

    session.dispose();
    session.dispose();
    expect(transport.disposeCalls).toBe(1);
    await expect(session.send({ type: "match.draw" })).resolves.toMatchObject({
      ok: false,
      code: "SESSION_DISPOSED",
    });
  });
});
