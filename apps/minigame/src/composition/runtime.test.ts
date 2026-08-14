import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameSession, miniGameServerCodec, readRuntimeConfig } from "./runtime";
import type { WxLike } from "../platform";

const priorNodeEnv = process.env.NODE_ENV;
const priorApi = process.env.MINIGAME_API_BASE_URL;
const priorCloudEnvironment = process.env.MINIGAME_CLOUD_ENV_ID;
const priorCloudService = process.env.MINIGAME_CLOUD_SERVICE_NAME;

afterEach(() => {
  process.env.NODE_ENV = priorNodeEnv;
  restoreEnvironment("MINIGAME_API_BASE_URL", priorApi);
  restoreEnvironment("MINIGAME_CLOUD_ENV_ID", priorCloudEnvironment);
  restoreEnvironment("MINIGAME_CLOUD_SERVICE_NAME", priorCloudService);
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("mini-game runtime config", () => {
  it("ignores untrusted endpoint and auth downgrade query values in production", () => {
    process.env.NODE_ENV = "production";
    process.env.MINIGAME_CLOUD_ENV_ID = "prod-env";
    process.env.MINIGAME_CLOUD_SERVICE_NAME = "exploding-kitty-api";
    process.env.MINIGAME_API_BASE_URL = "https://trusted.example";
    const wx = { getLaunchOptionsSync: () => ({ query: { server: "http%3A%2F%2Fevil.test", dev: "1", demo: "1", room: "123456" } }) } as unknown as WxLike;
    expect(readRuntimeConfig(wx)).toMatchObject({
      apiBaseUrl: undefined,
      cloudEnvironmentId: "prod-env",
      forceDemo: false,
      allowDevAuth: false,
      joinCode: "123456",
    });
  });

  it("allows explicit debugging query values only in development builds", () => {
    process.env.NODE_ENV = "development";
    process.env.MINIGAME_API_BASE_URL = "https://trusted.example";
    const wx = { getLaunchOptionsSync: () => ({ query: { server: "http%3A%2F%2F127.0.0.1%3A3000", dev: "1" } }) } as unknown as WxLike;
    expect(readRuntimeConfig(wx)).toMatchObject({ apiBaseUrl: "http://127.0.0.1:3000", forceDemo: false, allowDevAuth: true });
  });

  it("never enables a direct public endpoint in a production runtime", () => {
    process.env.NODE_ENV = "production";
    process.env.MINIGAME_API_BASE_URL = "https://stale-public.example";
    delete process.env.MINIGAME_CLOUD_ENV_ID;
    delete process.env.MINIGAME_CLOUD_SERVICE_NAME;
    const wx = {
      getLaunchOptionsSync: () => ({ query: {} }),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, platform: "ios" }),
    } as unknown as WxLike;

    expect(readRuntimeConfig(wx)).toMatchObject({
      apiBaseUrl: undefined,
      cloudEnvironmentId: undefined,
      forceDemo: false,
      allowDevAuth: false,
    });
  });

  it("uses one private WeChat Cloud Run target for HTTP and WebSocket", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MINIGAME_API_BASE_URL;
    delete process.env.MINIGAME_CLOUD_ENV_ID;
    delete process.env.MINIGAME_CLOUD_SERVICE_NAME;
    process.env.MINIGAME_CLOUD_ENV_ID = "prod-env";
    process.env.MINIGAME_CLOUD_SERVICE_NAME = "exploding-kitty-api";
    const wx = { getLaunchOptionsSync: () => ({ query: {} }) } as unknown as WxLike;

    expect(readRuntimeConfig(wx)).toEqual({
      apiBaseUrl: undefined,
      cloudEnvironmentId: "prod-env",
      cloudServiceName: "exploding-kitty-api",
      forceDemo: false,
      allowDevAuth: false,
    });
  });

  it("opens a local demo in WeChat developer tools when no API was configured", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MINIGAME_API_BASE_URL;
    const wx = {
      getLaunchOptionsSync: () => ({ query: {} }),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2, platform: "devtools" }),
    } as unknown as WxLike;

    expect(readRuntimeConfig(wx)).toMatchObject({ apiBaseUrl: undefined, forceDemo: true, allowDevAuth: false });
  });

  it("boots the developer-tools fallback without requiring a remote session module", async () => {
    const session = await createGameSession({} as WxLike, { forceDemo: true });
    expect(session.getSnapshot()).toMatchObject({ connectivity: "local", view: { phase: "HOME" } });
    session.dispose();
  });

  it("authenticates and connects entirely through the private cloud container target", async () => {
    const socket = runtimeSocketTaskFake();
    const callContainer = vi.fn().mockResolvedValue({
      statusCode: 200,
      data: { token: "fresh-cloud-token", playerId: "wx_player" },
    });
    const connectContainer = vi.fn().mockResolvedValue({ socketTask: socket.task });
    const values = new Map<string, unknown>();
    const wx = {
      cloud: { init: vi.fn(), callContainer, connectContainer },
      getStorageSync: (key: string) => values.get(key),
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
      removeStorageSync: (key: string) => values.delete(key),
    } as unknown as WxLike;
    let remoteOptions: Record<string, unknown> | undefined;
    const session = await createGameSession(wx, {
      cloudEnvironmentId: "prod-env",
      cloudServiceName: "exploding-kitty-api",
    }, {
      createRemoteSession: async (options: Record<string, unknown>) => {
        remoteOptions = options;
        const transport = options.transport as { dispose(): void };
        return {
          getSnapshot: () => ({ lifecycle: "opening", connectivity: "connecting", view: null, revision: 0 }),
          subscribe: () => () => undefined,
          send: async () => ({ ok: false, commandId: "unused", code: "UNUSED", message: "unused", retryable: false }),
          dispose: () => transport.dispose(),
        };
      },
    });
    await Promise.resolve();

    expect(callContainer).toHaveBeenCalledOnce();
    expect(connectContainer).toHaveBeenCalledWith({
      config: { env: "prod-env" },
      service: "exploding-kitty-api",
      path: "/v1/session",
      timeout: 10_000,
    });
    expect(remoteOptions).toMatchObject({
      sessionId: "wx-wx_player",
      initialResumeToken: "fresh-cloud-token",
    });
    session.dispose();
  });

  it("never falls back to demo on a real device or when developer tools has a configured API", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MINIGAME_API_BASE_URL;
    delete process.env.MINIGAME_CLOUD_ENV_ID;
    delete process.env.MINIGAME_CLOUD_SERVICE_NAME;
    const device = {
      getLaunchOptionsSync: () => ({ query: {} }),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, platform: "ios" }),
    } as unknown as WxLike;
    expect(readRuntimeConfig(device)).toMatchObject({ apiBaseUrl: undefined, forceDemo: false });

    process.env.NODE_ENV = "development";
    process.env.MINIGAME_API_BASE_URL = "http://127.0.0.1:3000";
    const devtools = {
      getLaunchOptionsSync: () => ({ query: {} }),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2, platform: "devtools" }),
    } as unknown as WxLike;
    expect(readRuntimeConfig(devtools)).toMatchObject({ apiBaseUrl: "http://127.0.0.1:3000", forceDemo: false });
  });

  it("runtime-decodes WSS messages through the strict protocol and snapshot schemas", () => {
    expect(miniGameServerCodec.decode(JSON.stringify({
      type: "command.ack", protocolVersion: 1, sessionId: "s", commandId: "c", ok: true, revision: 2,
    }))).toMatchObject({ type: "command.ack", revision: 2 });
    expect(() => miniGameServerCodec.decode(JSON.stringify({
      type: "snapshot", protocolVersion: 1, sessionId: "s", revision: 2,
      snapshot: { phase: "HOME", viewerId: "alice", serverTime: 100, deck: ["secret"] },
    }))).toThrow(/HOME snapshot fields only|\.snapshot\.deck/);
  });
});

function runtimeSocketTaskFake() {
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
