export type ServerConfig = Readonly<{
  host: string;
  port: number;
  databaseUrl?: string;
  authSecret: string;
  wechatAppId?: string;
  wechatAppSecret?: string;
  devAuthEnabled: boolean;
  logLevel: string;
  deadlinePollMs: number;
}>;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = environment.NODE_ENV === "production";
  if (production && !environment.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
  if (production && (!environment.WECHAT_APP_ID || !environment.WECHAT_APP_SECRET)) {
    throw new Error("WECHAT_APP_ID and WECHAT_APP_SECRET are required in production");
  }
  const authSecret = environment.AUTH_SECRET ?? (production ? "" : "development-only-auth-secret-change-me");
  if (authSecret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return {
    host: environment.HOST ?? "0.0.0.0",
    port: positiveInteger(environment.PORT, 3_000),
    databaseUrl: environment.DATABASE_URL,
    authSecret,
    wechatAppId: environment.WECHAT_APP_ID,
    wechatAppSecret: environment.WECHAT_APP_SECRET,
    devAuthEnabled: !production && environment.DEV_AUTH_ENABLED === "true",
    logLevel: environment.LOG_LEVEL ?? "info",
    deadlinePollMs: positiveInteger(environment.DEADLINE_POLL_MS, 1_000),
  };
}
