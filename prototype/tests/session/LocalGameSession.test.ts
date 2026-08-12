import { describe, expect, it, vi } from "vitest";

import { MemorySessionRepository } from "../../src/adapters/persistence/MemorySessionRepository";
import type { PlayerIntent } from "../../src/session/public";
import {
  LocalGameSession,
  type LocalKernelAdapter,
} from "../../src/session/local/LocalGameSession";

type State = Readonly<{ value: number }>;
type View = Readonly<{ value: number }>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeKernel(
  execute: LocalKernelAdapter<State, View>["execute"] = (state, command) => ({
    ok: true,
    state: { value: state.value + Number(command.intent.amount ?? 1) },
  }),
): LocalKernelAdapter<State, View> {
  return {
    create: () => ({ value: 0 }),
    restore: (payload) => payload as State,
    execute,
    project: (state) => ({ value: state.value }),
    serialize: (state) => state,
  };
}

describe("LocalGameSession", () => {
  it("keeps getSnapshot referentially stable until a notification", async () => {
    const session = await LocalGameSession.open({
      sessionId: "local-stable",
      kernel: makeKernel(),
      repository: new MemorySessionRepository(),
      commandId: () => "command-1",
      now: () => 1_000,
    });

    const before = session.getSnapshot();
    expect(session.getSnapshot()).toBe(before);

    const result = await session.send({ type: "match.draw" });
    expect(result.ok).toBe(true);
    const after = session.getSnapshot();
    expect(after).not.toBe(before);
    expect(session.getSnapshot()).toBe(after);
    expect(after.view).toEqual({ value: 1 });
  });

  it("serializes sends and creates complete command envelopes", async () => {
    const gate = deferred();
    const timeline: string[] = [];
    const envelopes: Array<{ commandId: string; sessionId: string; sequence: number; sentAt: number }> = [];
    const kernel = makeKernel(async (state, command) => {
      const amount = Number(command.intent.amount);
      timeline.push(`start:${amount}`);
      envelopes.push(command);
      if (amount === 1) await gate.promise;
      timeline.push(`end:${amount}`);
      return { ok: true, state: { value: state.value + amount } };
    });
    let nextId = 0;
    const session = await LocalGameSession.open({
      sessionId: "local-order",
      kernel,
      repository: new MemorySessionRepository(),
      commandId: () => `command-${++nextId}`,
      now: () => 1_234,
    });

    const first = session.send({ type: "increment", amount: 1 });
    const second = session.send({ type: "increment", amount: 2 });
    await Promise.resolve();
    expect(timeline).toEqual(["start:1"]);

    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(timeline).toEqual(["start:1", "end:1", "start:2", "end:2"]);
    expect(envelopes).toMatchObject([
      { commandId: "command-1", sessionId: "local-order", sequence: 0, sentAt: 1_234 },
      { commandId: "command-2", sessionId: "local-order", sequence: 1, sentAt: 1_234 },
    ]);
    expect(firstResult).toMatchObject({ ok: true, commandId: "command-1", sequence: 1 });
    expect(secondResult).toMatchObject({ ok: true, commandId: "command-2", sequence: 2 });
    expect(session.getSnapshot().view).toEqual({ value: 3 });
  });

  it("restores persisted kernel state and sequence", async () => {
    const repository = new MemorySessionRepository([
      {
        schemaVersion: 1,
        mode: "local",
        sessionId: "local-resume",
        updatedAt: 900,
        payload: { kernel: { value: 9 }, sequence: 4 },
      },
    ]);
    const restore = vi.fn((payload: unknown) => payload as State);
    const kernel = { ...makeKernel(), restore };

    const session = await LocalGameSession.open({
      sessionId: "local-resume",
      kernel,
      repository,
    });

    expect(restore).toHaveBeenCalledWith({ value: 9 });
    expect(session.getSnapshot()).toMatchObject({
      lifecycle: "active",
      connectivity: "local",
      lastSequence: 4,
      view: { value: 9 },
    });
  });

  it("returns structured failures instead of throwing", async () => {
    const rejected = await LocalGameSession.open({
      sessionId: "local-rejected",
      kernel: makeKernel((state) => ({
        ok: false,
        state,
        problem: { code: "ILLEGAL_MOVE", message: "Not your turn", retryable: false },
      })),
      repository: new MemorySessionRepository(),
    });
    await expect(rejected.send({ type: "match.draw" })).resolves.toEqual({
      ok: false,
      code: "ILLEGAL_MOVE",
      message: "Not your turn",
      retryable: false,
      commandId: expect.any(String),
    });

    const broken = await LocalGameSession.open({
      sessionId: "local-broken",
      kernel: makeKernel(() => {
        throw new Error("boom");
      }),
      repository: new MemorySessionRepository(),
    });
    const result = await broken.send({ type: "match.draw" });
    expect(result).toMatchObject({ ok: false, code: "KERNEL_ERROR", retryable: false });
    expect(() => result).not.toThrow();
  });

  it("disposes idempotently and rejects later sends as results", async () => {
    const dispose = vi.fn();
    const kernel = { ...makeKernel(), dispose };
    const session = await LocalGameSession.open({
      sessionId: "local-dispose",
      kernel,
      repository: new MemorySessionRepository(),
    });

    session.dispose();
    session.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(session.send({ type: "match.draw" })).resolves.toMatchObject({
      ok: false,
      code: "SESSION_DISPOSED",
    });
  });
});
