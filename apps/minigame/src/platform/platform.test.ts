import { describe, expect, it, vi } from "vitest";
import { WxAuthAdapter } from "./auth";
import { WxDevelopmentIdentityRepository, WxSessionRepository } from "./storage";
import { WxSocketTransport, toWebSocketUrl } from "./socketTransport";
import type { WxLike } from "./wx";
import { WxMediaAdapter } from "./media";

describe("wx platform adapters", () => {
  it("plays only while sound is enabled", () => {
    const play = vi.fn();
    const createInnerAudioContext = vi.fn(() => ({ src: "", volume: 0, loop: false, play, stop: vi.fn(), destroy: vi.fn() }));
    const platform = { getStorageSync: () => undefined, setStorageSync: vi.fn(), createInnerAudioContext } as unknown as WxLike;
    const disabled = new WxMediaAdapter(platform, { sound: false, vibration: false });
    disabled.play("select", "assets/sounds/select.wav");
    expect(createInnerAudioContext).not.toHaveBeenCalled();

    disabled.update({ sound: true });
    disabled.play("select", "assets/sounds/select.wav", 0.4);
    expect(createInnerAudioContext).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
  });
  it("persists shared session-client envelopes by session id", async () => {
    const values = new Map<string, unknown>();
    const repository = new WxSessionRepository({ getStorageSync: (key) => values.get(key), setStorageSync: (key, value) => values.set(key, value), removeStorageSync: (key) => values.delete(key) });
    const stored = { schemaVersion: 1 as const, mode: "remote" as const, sessionId: "s1", updatedAt: 1, payload: { revision: 2 } };
    await repository.save(stored);
    expect(await repository.load("s1")).toEqual(stored);
    await repository.remove("s1");
    expect(await repository.load("s1")).toBeNull();
  });

  it("uses secure websocket URLs for secure API origins", () => {
    expect(toWebSocketUrl("https://example.test/")).toBe("wss://example.test/v1/session");
  });

  it("keeps the session bearer out of the websocket URL", () => {
    const socket = socketTaskFake();
    let connection: Parameters<WxLike["connectSocket"]>[0] | undefined;
    const platform = {
      connectSocket: (options: Parameters<WxLike["connectSocket"]>[0]) => {
        connection = options;
        return socket.task;
      },
    } as unknown as WxLike;
    const transport = new WxSocketTransport(
      platform,
      toWebSocketUrl("https://example.test"),
      { encode: JSON.stringify, decode: JSON.parse },
      { Authorization: "Bearer secret-session" },
    );
    expect(connection).toMatchObject({
      url: "wss://example.test/v1/session",
      header: { Authorization: "Bearer secret-session" },
    });
    expect(connection?.url).not.toContain("secret-session");
    transport.dispose();
  });

  it("persists one stable development identity per installation", () => {
    const values = new Map<string, unknown>();
    const storage = { getStorageSync: (key: string) => values.get(key), setStorageSync: (key: string, value: unknown) => values.set(key, value), removeStorageSync: (key: string) => values.delete(key) };
    const first = new WxDevelopmentIdentityRepository(storage, () => "00112233445566778899aabbccddeeff").getOrCreate();
    const restored = new WxDevelopmentIdentityRepository(storage, () => { throw new Error("must not regenerate"); }).getOrCreate();
    const otherValues = new Map<string, unknown>();
    const otherStorage = { getStorageSync: (key: string) => otherValues.get(key), setStorageSync: (key: string, value: unknown) => otherValues.set(key, value), removeStorageSync: (key: string) => otherValues.delete(key) };
    const other = new WxDevelopmentIdentityRepository(otherStorage, () => "ffeeddccbbaa99887766554433221100").getOrCreate();
    expect(restored).toEqual(first);
    expect(other.deviceId).not.toBe(first.deviceId);
    expect(other.displayName).not.toBe(first.displayName);
    expect(first).toEqual({ schemaVersion: 1, deviceId: "00112233445566778899aabbccddeeff", displayName: "开发玩家 EEFF" });
  });

  it("sends the persisted installation identity to development auth", async () => {
    const values = new Map<string, unknown>();
    let requestData: unknown;
    const platform = {
      getStorageSync: (key: string) => values.get(key),
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
      removeStorageSync: (key: string) => values.delete(key),
      request: (options: Parameters<WxLike["request"]>[0]) => {
        requestData = options.data;
        options.success({ statusCode: 200, data: { token: "token-a", playerId: "dev-player-a" } });
      },
    } as unknown as WxLike;
    const auth = new WxAuthAdapter(platform, "http://127.0.0.1:3000", () => "ffeeddccbbaa99887766554433221100");
    await expect(auth.signInForDevelopment()).resolves.toEqual({ token: "token-a", playerId: "dev-player-a" });
    expect(requestData).toEqual({ developmentIdentity: "ffeeddccbbaa99887766554433221100", profile: { displayName: "开发玩家 1100" } });
    await auth.signInForDevelopment();
    expect(requestData).toEqual({ developmentIdentity: "ffeeddccbbaa99887766554433221100", profile: { displayName: "开发玩家 1100" } });
  });

  it("migrates the old exposed development nickname without rotating its identity", () => {
    const deviceId = "0123456789abcdef0123456789abcdef";
    const values = new Map<string, unknown>([["ek.development-identity.v1", { schemaVersion: 1, deviceId, displayName: `dev:${deviceId}` }]]);
    const storage = { getStorageSync: (key: string) => values.get(key), setStorageSync: (key: string, value: unknown) => values.set(key, value), removeStorageSync: (key: string) => values.delete(key) };
    const restored = new WxDevelopmentIdentityRepository(storage, () => { throw new Error("must not rotate"); }).getOrCreate();
    expect(restored).toEqual({ schemaVersion: 1, deviceId, displayName: "开发玩家 CDEF" });
  });

  it("rejects offline sends so session-client keeps one authoritative outbox", async () => {
    const socket = socketTaskFake();
    const platform = { connectSocket: () => socket.task } as unknown as WxLike;
    const transport = new WxSocketTransport(platform, "wss://example.test/v1/session", { encode: JSON.stringify, decode: JSON.parse });
    await expect(transport.send({ type: "command" })).rejects.toThrow("TRANSPORT_OFFLINE");
    transport.dispose();
  });
});

function socketTaskFake() {
  let close: ((event: { code?: number; reason?: string }) => void) | undefined;
  const task = {
    send: () => undefined,
    close: (options?: { code?: number; reason?: string }) => close?.(options ?? {}),
    onOpen: () => undefined,
    onMessage: () => undefined,
    onClose: (listener: typeof close) => { close = listener; },
    onError: () => undefined,
  };
  return { task };
}
