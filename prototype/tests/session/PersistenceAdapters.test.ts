import { describe, expect, it } from "vitest";

import { BrowserSessionRepository } from "../../src/adapters/persistence/BrowserSessionRepository";
import { MemorySessionRepository } from "../../src/adapters/persistence/MemorySessionRepository";
import type { StoredSession, StorageLike } from "../../src/adapters/persistence/public";

class TestStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const stored: StoredSession = {
  schemaVersion: 1,
  mode: "remote",
  sessionId: "room-42",
  updatedAt: 123,
  payload: { sequence: 7, view: { phase: "match" }, resumeToken: "secret" },
};

describe("session repositories", () => {
  it.each([
    ["memory", () => new MemorySessionRepository()],
    ["browser", () => new BrowserSessionRepository(new TestStorage(), { prefix: "test:" })],
  ])("round-trips and removes sessions with the %s adapter", async (_name, create) => {
    const repository = create();
    await repository.save(stored);
    expect(await repository.load(stored.sessionId)).toEqual(stored);
    await repository.remove(stored.sessionId);
    expect(await repository.load(stored.sessionId)).toBeNull();
  });

  it("treats malformed browser data as absent", async () => {
    const storage = new TestStorage();
    storage.setItem("ek:bad", "not-json");
    const repository = new BrowserSessionRepository(storage);
    await expect(repository.load("bad")).resolves.toBeNull();
  });
});
