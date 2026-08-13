import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

const mysql = {
  MYSQL_ADDRESS: "mysql.internal:3306",
  MYSQL_USERNAME: "game",
  MYSQL_PASSWORD: "secret",
  MYSQL_DATABASE: "exploding_kitty",
};

describe("production configuration", () => {
  it("requires the database and either trusted cloud identity or WeChat credentials", () => {
    expect(() => readConfig({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32) })).toThrow("MYSQL_ADDRESS");
    expect(() => readConfig({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), ...mysql })).toThrow("WECHAT_APP_ID");
    expect(readConfig({
      NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), ...mysql,
      WECHAT_APP_ID: "appid", WECHAT_APP_SECRET: "secret", DEV_AUTH_ENABLED: "true",
    }).devAuthEnabled).toBe(false);

    const trusted = readConfig({
      NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), ...mysql,
      WECHAT_TRUST_CLOUD_HEADERS: "true",
    });
    expect(trusted.wechatTrustCloudHeaders).toBe(true);
    expect(trusted.wechatAppId).toBeUndefined();
  });

  it("trusts cloud identity headers only when explicitly set to lowercase true", () => {
    expect(readConfig({}).wechatTrustCloudHeaders).toBe(false);
    expect(readConfig({ WECHAT_TRUST_CLOUD_HEADERS: "false" }).wechatTrustCloudHeaders).toBe(false);
    expect(() => readConfig({
      NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), ...mysql,
      WECHAT_TRUST_CLOUD_HEADERS: "TRUE",
    })).toThrow("WECHAT_APP_ID");
  });

  it("requires development auth to be explicitly enabled outside production", () => {
    expect(readConfig({}).devAuthEnabled).toBe(false);
    expect(readConfig({ DEV_AUTH_ENABLED: "true" }).devAuthEnabled).toBe(true);
  });
});
