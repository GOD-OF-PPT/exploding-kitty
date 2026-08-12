import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayableSession } from "../../src/app/createPlayableApp.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("default playable app composition", () => {
  it("lets the simulated host start a joined local room after the member readies", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const session = await createPlayableSession({ sessionId: "default-join-room" });

    expect(await session.send({ type: "JoinRoom", code: "654321" })).toMatchObject({ ok: true });
    const joined = session.getSnapshot().view;
    expect(joined).toMatchObject({
      phase: "LOBBY",
      viewerId: "you",
      room: { ownerId: "orange" },
    });
    expect(joined.room.players.find((player) => player.id === "orange")).toMatchObject({
      bot: true,
      host: true,
      ready: true,
    });
    expect(joined.room.players.find((player) => player.id === "you")).toMatchObject({
      host: false,
      ready: false,
    });

    expect(await session.send({ type: "SetReady", ready: true })).toMatchObject({ ok: true });
    const started = session.getSnapshot().view;
    expect(started).toMatchObject({
      phase: "MATCH",
      status: "ACTIVE",
      turn: { playerId: "orange" },
      room: { ownerId: "orange" },
    });
  });
});
