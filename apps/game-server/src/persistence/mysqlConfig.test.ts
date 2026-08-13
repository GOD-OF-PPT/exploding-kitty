import { describe, expect, it } from "vitest";
import { readMysqlConnectionOptions } from "./mysqlConfig.js";

describe("readMysqlConnectionOptions", () => {
  it("keeps MySQL optional when no variable is set", () => {
    expect(readMysqlConnectionOptions({})).toBeUndefined();
  });

  it("parses the WeChat Cloud Run host and port format", () => {
    expect(readMysqlConnectionOptions({
      MYSQL_ADDRESS: "10.0.0.8:3307",
      MYSQL_USERNAME: "game",
      MYSQL_PASSWORD: "secret",
      MYSQL_DATABASE: "exploding_kitty",
    })).toEqual({
      host: "10.0.0.8",
      port: 3_307,
      user: "game",
      password: "secret",
      database: "exploding_kitty",
      charset: "utf8mb4",
      timezone: "Z",
    });
  });

  it("defaults to port 3306", () => {
    expect(readMysqlConnectionOptions({
      MYSQL_ADDRESS: "mysql.internal",
      MYSQL_USERNAME: "game",
      MYSQL_PASSWORD: "secret",
      MYSQL_DATABASE: "exploding_kitty",
    })?.port).toBe(3_306);
  });

  it("rejects a partial configuration", () => {
    expect(() => readMysqlConnectionOptions({ MYSQL_ADDRESS: "mysql.internal" }))
      .toThrow("MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_DATABASE");
  });

  it("rejects an invalid port", () => {
    expect(() => readMysqlConnectionOptions({
      MYSQL_ADDRESS: "mysql.internal:not-a-port",
      MYSQL_USERNAME: "game",
      MYSQL_PASSWORD: "secret",
      MYSQL_DATABASE: "exploding_kitty",
    })).toThrow("Invalid MySQL port");
  });
});
