import { describe, expect, it } from "vitest";
import type { ClientEnvelope, ServerEnvelope } from "@exploding-kitty/protocol";
import { MemorySessionRepository, MemoryTransport, RemoteGameSession } from "./index";

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
});
