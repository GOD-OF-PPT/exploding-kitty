import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

describe("production configuration", () => {
  it("requires the database and WeChat credentials", () => {
    expect(() => readConfig({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32) })).toThrow("DATABASE_URL");
    expect(() => readConfig({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), DATABASE_URL: "postgres://db" })).toThrow("WECHAT_APP_ID");
    expect(readConfig({
      NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), DATABASE_URL: "postgres://db",
      WECHAT_APP_ID: "appid", WECHAT_APP_SECRET: "secret", DEV_AUTH_ENABLED: "true",
    }).devAuthEnabled).toBe(false);
  });

  it("requires development auth to be explicitly enabled outside production", () => {
    expect(readConfig({}).devAuthEnabled).toBe(false);
    expect(readConfig({ DEV_AUTH_ENABLED: "true" }).devAuthEnabled).toBe(true);
  });
});
