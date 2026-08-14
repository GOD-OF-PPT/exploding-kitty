import { afterEach, describe, expect, it, vi } from "vitest";
import { WxAuthAdapter } from "./auth";
import { WxDevelopmentIdentityRepository, WxSessionRepository } from "./storage";
import { WxSocketTransport, toWebSocketUrl } from "./socketTransport";
import type { WxLike } from "./wx";
import { WxMediaAdapter } from "./media";

afterEach(() => {
  vi.useRealTimers();
});

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
      {
        kind: "direct",
        url: toWebSocketUrl("https://example.test"),
        header: { Authorization: "Bearer secret-session" },
      },
      { encode: JSON.stringify, decode: JSON.parse },
    );
    expect(connection).toMatchObject({
      url: "wss://example.test/v1/session",
      header: { Authorization: "Bearer secret-session" },
    });
    expect(connection?.url).not.toContain("secret-session");
    transport.dispose();
  });

  it("opens a cloud-container socket without requiring a public websocket URL", async () => {
    const socket = socketTaskFake();
    const connectContainer = vi.fn().mockResolvedValue({ socketTask: socket.task });
    const connectSocket = vi.fn();
    const platform = {
      cloud: { connectContainer },
      connectSocket,
    } as unknown as WxLike;
    const events: Array<{ type: string; message?: unknown }> = [];
    const transport = new WxSocketTransport(
      platform,
      {
        kind: "cloudContainer",
        environmentId: "prod-env",
        serviceName: "exploding-kitty-api",
        path: "/v1/session",
      },
      { encode: JSON.stringify, decode: JSON.parse },
    );
    transport.subscribe((event) => events.push(event));

    await flushPromises();
    expect(connectContainer).toHaveBeenCalledWith({
      config: { env: "prod-env" },
      service: "exploding-kitty-api",
      path: "/v1/session",
      timeout: 10_000,
    });
    expect(connectSocket).not.toHaveBeenCalled();

    socket.open();
    socket.message(JSON.stringify({ type: "snapshot", revision: 1 }));
    expect(events).toEqual([
      { type: "open" },
      { type: "message", message: { type: "snapshot", revision: 1 } },
    ]);
    transport.dispose();
  });

  it("retries when opening a cloud-container socket rejects", async () => {
    vi.useFakeTimers();
    const socket = socketTaskFake();
    const connectContainer = vi.fn()
      .mockRejectedValueOnce({ errMsg: "connectContainer:fail unavailable" })
      .mockResolvedValueOnce({ socketTask: socket.task });
    const platform = { cloud: { connectContainer } } as unknown as WxLike;
    const events: Array<{ type: string; retrying?: boolean; reason?: string }> = [];
    const transport = new WxSocketTransport(
      platform,
      {
        kind: "cloudContainer",
        environmentId: "prod-env",
        serviceName: "exploding-kitty-api",
        path: "/v1/session",
      },
      { encode: JSON.stringify, decode: JSON.parse },
    );
    transport.subscribe((event) => {
      if (event.type === "closed") events.push(event);
    });

    await flushPromises();
    expect(events).toEqual([{
      type: "closed",
      retrying: true,
      reason: "connectContainer:fail unavailable",
    }]);
    expect(connectContainer).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(connectContainer).toHaveBeenCalledTimes(2);
    transport.dispose();
  });

  it("closes a cloud socket that resolves after the transport was disposed", async () => {
    const socket = socketTaskFake();
    let resolveConnection: ((value: { socketTask: typeof socket.task }) => void) | undefined;
    const connectContainer = vi.fn(() => new Promise<{ socketTask: typeof socket.task }>((resolve) => {
      resolveConnection = resolve;
    }));
    const platform = { cloud: { connectContainer } } as unknown as WxLike;
    const transport = new WxSocketTransport(
      platform,
      {
        kind: "cloudContainer",
        environmentId: "prod-env",
        serviceName: "exploding-kitty-api",
        path: "/v1/session",
      },
      { encode: JSON.stringify, decode: JSON.parse },
    );

    transport.dispose();
    resolveConnection?.({ socketTask: socket.task });
    await flushPromises();

    expect(socket.close).toHaveBeenCalledWith({ code: 1000, reason: "client disposed" });
  });

  it("ignores a stale pending cloud connection after manual reconnect", async () => {
    const first = socketTaskFake();
    const second = socketTaskFake();
    const resolvers: Array<(value: { socketTask: typeof first.task }) => void> = [];
    const connectContainer = vi.fn(() => new Promise<{ socketTask: typeof first.task }>((resolve) => {
      resolvers.push(resolve);
    }));
    const platform = { cloud: { connectContainer } } as unknown as WxLike;
    const transport = new WxSocketTransport(
      platform,
      {
        kind: "cloudContainer",
        environmentId: "prod-env",
        serviceName: "exploding-kitty-api",
        path: "/v1/session",
      },
      { encode: JSON.stringify, decode: JSON.parse },
    );

    transport.reconnect();
    expect(connectContainer).toHaveBeenCalledTimes(2);
    resolvers[0]?.({ socketTask: first.task });
    resolvers[1]?.({ socketTask: second.task });
    await flushPromises();

    expect(first.close).toHaveBeenCalledWith({ code: 1012, reason: "stale connection" });
    second.open();
    await expect(transport.send({ type: "resume" })).resolves.toBeUndefined();
    expect(second.send).toHaveBeenCalledWith(expect.objectContaining({ data: JSON.stringify({ type: "resume" }) }));
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

  it("uses gateway identity without calling wx.login in WeChat Cloud Run", async () => {
    const init = vi.fn();
    const login = vi.fn();
    const callContainer = vi.fn().mockResolvedValue({
      statusCode: 200,
      data: { token: "cloud-token", playerId: "wx-player" },
    });
    const platform = {
      cloud: { init, callContainer },
      login,
      getStorageSync: () => undefined,
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    } as unknown as WxLike;
    const auth = new WxAuthAdapter(platform, {
      kind: "cloudContainer",
      environmentId: "prod-env",
      serviceName: "exploding-kitty-api",
    });

    await expect(auth.signIn()).resolves.toEqual({ token: "cloud-token", playerId: "wx-player" });
    expect(init).toHaveBeenCalledWith({ env: "prod-env", traceUser: true });
    expect(callContainer).toHaveBeenCalledWith({
      config: { env: "prod-env" },
      path: "/v1/auth/wechat",
      method: "POST",
      data: {},
      header: {
        "content-type": "application/json",
        "X-WX-SERVICE": "exploding-kitty-api",
      },
      timeout: 10_000,
    });
    expect(login).not.toHaveBeenCalled();
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
    const transport = new WxSocketTransport(
      platform,
      { kind: "direct", url: "wss://example.test/v1/session" },
      { encode: JSON.stringify, decode: JSON.parse },
    );
    await expect(transport.send({ type: "command" })).rejects.toThrow("TRANSPORT_OFFLINE");
    transport.dispose();
  });
});

function socketTaskFake() {
  let openListener: (() => void) | undefined;
  let messageListener: ((event: { data: string | ArrayBuffer }) => void) | undefined;
  let closeListener: ((event: { code?: number; reason?: string }) => void) | undefined;
  let errorListener: ((error: Record<string, unknown>) => void) | undefined;
  const send = vi.fn((options: { success?: () => void }) => options.success?.());
  const close = vi.fn((options?: { code?: number; reason?: string }) => closeListener?.(options ?? {}));
  const task = {
    send,
    close,
    onOpen: (listener: typeof openListener) => { openListener = listener; },
    onMessage: (listener: typeof messageListener) => { messageListener = listener; },
    onClose: (listener: typeof closeListener) => { closeListener = listener; },
    onError: (listener: typeof errorListener) => { errorListener = listener; },
  };
  return {
    task,
    send,
    close,
    open: () => openListener?.(),
    message: (data: string | ArrayBuffer) => messageListener?.({ data }),
    closeFromServer: (event: { code?: number; reason?: string }) => closeListener?.(event),
    error: (error: Record<string, unknown>) => errorListener?.(error),
  };
}

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
