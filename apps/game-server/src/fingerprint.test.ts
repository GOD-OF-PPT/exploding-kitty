import { describe, expect, it } from "vitest";
import { canonicalFingerprint } from "./fingerprint.js";

describe("canonicalFingerprint", () => {
  it("serializes primitives via JSON.stringify", () => {
    expect(canonicalFingerprint("Draw")).toBe('"Draw"');
    expect(canonicalFingerprint(42)).toBe("42");
    expect(canonicalFingerprint(true)).toBe("true");
    expect(canonicalFingerprint(null)).toBe("null");
  });

  it("is canonical across object key insertion order", () => {
    const a = canonicalFingerprint({ type: "AddBot", roomId: "r1", count: 2 });
    const b = canonicalFingerprint({ count: 2, roomId: "r1", type: "AddBot" });
    expect(a).toBe(b);
    expect(a).toBe('{"count":2,"roomId":"r1","type":"AddBot"}');
  });

  it("preserves array order (arrays are not canonicalized by position)", () => {
    const a = canonicalFingerprint([1, 2, 3]);
    const b = canonicalFingerprint([3, 2, 1]);
    expect(a).not.toBe(b);
    expect(a).toBe("[1,2,3]");
  });

  it("handles nested objects and arrays deterministically", () => {
    const action = { type: "PlayCards", cardIds: ["c1", "c2"], targetId: null };
    const first = canonicalFingerprint(action);
    const second = canonicalFingerprint({ targetId: null, type: "PlayCards", cardIds: ["c1", "c2"] });
    expect(first).toBe(second);
    expect(first).toBe('{"cardIds":["c1","c2"],"targetId":null,"type":"PlayCards"}');
  });

  it("distinguishes different payloads (COMMAND_ID_REUSED detection)", () => {
    const addBot = canonicalFingerprint({ type: "AddBot", roomId: "r1" });
    const removeBot = canonicalFingerprint({ type: "RemoveBot", roomId: "r1", botId: "b1" });
    expect(addBot).not.toBe(removeBot);
  });

  it("is deterministic across repeated calls", () => {
    const value = { type: "StartMatch", settings: { maxPlayers: 4, turnSeconds: 45 } };
    expect(canonicalFingerprint(value)).toBe(canonicalFingerprint(value));
  });
});
