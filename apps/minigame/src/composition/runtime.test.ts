import { afterEach, describe, expect, it } from "vitest";
import { createGameSession, miniGameServerCodec, readRuntimeConfig } from "./runtime";
import type { WxLike } from "../platform";

const priorNodeEnv = process.env.NODE_ENV;
const priorApi = process.env.MINIGAME_API_BASE_URL;
const priorCloudEnvironment = process.env.MINIGAME_CLOUD_ENV_ID;
const priorCloudService = process.env.MINIGAME_CLOUD_SERVICE_NAME;
const priorWebsocket = process.env.MINIGAME_WEBSOCKET_BASE_URL;

afterEach(() => {
  process.env.NODE_ENV = priorNodeEnv;
  restoreEnvironment("MINIGAME_API_BASE_URL", priorApi);
  restoreEnvironment("MINIGAME_CLOUD_ENV_ID", priorCloudEnvironment);
  restoreEnvironment("MINIGAME_CLOUD_SERVICE_NAME", priorCloudService);
  restoreEnvironment("MINIGAME_WEBSOCKET_BASE_URL", priorWebsocket);
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("mini-game runtime config", () => {
  it("ignores untrusted endpoint and auth downgrade query values in production", () => {
    process.env.NODE_ENV = "production";
    process.env.MINIGAME_API_BASE_URL = "https://trusted.example";
    const wx = { getLaunchOptionsSync: () => ({ query: { server: "http%3A%2F%2Fevil.test", dev: "1", demo: "1", room: "123456" } }) } as unknown as WxLike;
    expect(readRuntimeConfig(wx)).toMatchObject({
      apiBaseUrl: "https://trusted.example",
      websocketBaseUrl: "https://trusted.example",
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

  it("uses WeChat Cloud Run for HTTP and a public origin for authenticated WSS", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MINIGAME_API_BASE_URL;
    process.env.MINIGAME_CLOUD_ENV_ID = "prod-env";
    process.env.MINIGAME_CLOUD_SERVICE_NAME = "exploding-kitty-api";
    process.env.MINIGAME_WEBSOCKET_BASE_URL = "https://game.example.com";
    const wx = { getLaunchOptionsSync: () => ({ query: {} }) } as unknown as WxLike;

    expect(readRuntimeConfig(wx)).toEqual({
      apiBaseUrl: undefined,
      cloudEnvironmentId: "prod-env",
      cloudServiceName: "exploding-kitty-api",
      websocketBaseUrl: "https://game.example.com",
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

  it("never falls back to demo on a real device or when developer tools has a configured API", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MINIGAME_API_BASE_URL;
    const device = {
      getLaunchOptionsSync: () => ({ query: {} }),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, platform: "ios" }),
    } as unknown as WxLike;
    expect(readRuntimeConfig(device)).toMatchObject({ apiBaseUrl: undefined, forceDemo: false });

    process.env.MINIGAME_API_BASE_URL = "https://game.example.com";
    const devtools = {
      getLaunchOptionsSync: () => ({ query: {} }),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2, platform: "devtools" }),
    } as unknown as WxLike;
    expect(readRuntimeConfig(devtools)).toMatchObject({ apiBaseUrl: "https://game.example.com", forceDemo: false });
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
