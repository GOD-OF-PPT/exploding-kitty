import { afterEach, describe, expect, it } from "vitest";
import { miniGameServerCodec, readRuntimeConfig } from "./runtime";
import type { WxLike } from "../platform";

const priorNodeEnv = process.env.NODE_ENV;
const priorApi = process.env.MINIGAME_API_BASE_URL;

afterEach(() => {
  process.env.NODE_ENV = priorNodeEnv;
  process.env.MINIGAME_API_BASE_URL = priorApi;
});

describe("mini-game runtime config", () => {
  it("ignores untrusted endpoint and auth downgrade query values in production", () => {
    process.env.NODE_ENV = "production";
    process.env.MINIGAME_API_BASE_URL = "https://trusted.example";
    const wx = { getLaunchOptionsSync: () => ({ query: { server: "http%3A%2F%2Fevil.test", dev: "1", demo: "1", room: "123456" } }) } as unknown as WxLike;
    expect(readRuntimeConfig(wx)).toEqual({ apiBaseUrl: "https://trusted.example", forceDemo: false, allowDevAuth: false, joinCode: "123456" });
  });

  it("allows explicit debugging query values only in development builds", () => {
    process.env.NODE_ENV = "development";
    process.env.MINIGAME_API_BASE_URL = "https://trusted.example";
    const wx = { getLaunchOptionsSync: () => ({ query: { server: "http%3A%2F%2F127.0.0.1%3A3000", dev: "1" } }) } as unknown as WxLike;
    expect(readRuntimeConfig(wx)).toMatchObject({ apiBaseUrl: "http://127.0.0.1:3000", forceDemo: false, allowDevAuth: true });
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
