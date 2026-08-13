import type { PoolOptions } from "mysql2/promise";

const MYSQL_VARIABLES = ["MYSQL_ADDRESS", "MYSQL_USERNAME", "MYSQL_PASSWORD", "MYSQL_DATABASE"] as const;

export type MysqlConnectionOptions = Pick<
  PoolOptions,
  "host" | "port" | "user" | "password" | "database" | "charset" | "timezone"
>;

function parseAddress(address: string): Readonly<{ host: string; port: number }> {
  const value = address.trim();
  if (!value) throw new Error("MYSQL_ADDRESS must not be empty");

  // WeChat Cloud Run exposes host:port. Bracketed IPv6 is accepted as well so local
  // environments do not need a different configuration shape.
  const bracketed = /^\[([^\]]+)](?::(\d+))?$/.exec(value);
  if (bracketed) return { host: bracketed[1]!, port: parsePort(bracketed[2]) };

  const separator = value.lastIndexOf(":");
  if (separator > 0 && value.indexOf(":") === separator) {
    return { host: value.slice(0, separator), port: parsePort(value.slice(separator + 1)) };
  }
  return { host: value, port: 3_306 };
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3_306;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid MySQL port: ${value}`);
  }
  return port;
}

/**
 * Returns undefined when MySQL is intentionally not configured for a local
 * in-memory run. A partial configuration is always rejected.
 */
export function readMysqlConnectionOptions(
  environment: NodeJS.ProcessEnv = process.env,
): MysqlConnectionOptions | undefined {
  const present = MYSQL_VARIABLES.filter((name) => environment[name] !== undefined);
  if (present.length === 0) return undefined;
  const missing = MYSQL_VARIABLES.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) throw new Error(`Missing MySQL configuration: ${missing.join(", ")}`);

  const address = parseAddress(environment.MYSQL_ADDRESS!);
  return {
    ...address,
    user: environment.MYSQL_USERNAME!,
    password: environment.MYSQL_PASSWORD!,
    database: environment.MYSQL_DATABASE!,
    charset: "utf8mb4",
    timezone: "Z",
  };
}
