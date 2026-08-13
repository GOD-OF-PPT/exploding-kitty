export type ServerConfig = Readonly<{
  host: string;
  port: number;
  authSecret: string;
  wechatAppId?: string;
  wechatAppSecret?: string;
  wechatTrustCloudHeaders: boolean;
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
  const wechatTrustCloudHeaders = environment.WECHAT_TRUST_CLOUD_HEADERS === "true";
  if (production) {
    const missingMysqlVariables = ["MYSQL_ADDRESS", "MYSQL_USERNAME", "MYSQL_PASSWORD", "MYSQL_DATABASE"]
      .filter((name) => !environment[name]?.trim());
    if (missingMysqlVariables.length > 0) {
      throw new Error(`${missingMysqlVariables.join(", ")} are required in production`);
    }
  }
  if (production && !wechatTrustCloudHeaders
    && (!environment.WECHAT_APP_ID?.trim() || !environment.WECHAT_APP_SECRET?.trim())) {
    throw new Error(
      "WECHAT_APP_ID and WECHAT_APP_SECRET are required in production unless WECHAT_TRUST_CLOUD_HEADERS=true",
    );
  }
  const authSecret = environment.AUTH_SECRET ?? (production ? "" : "development-only-auth-secret-change-me");
  if (authSecret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return {
    host: environment.HOST ?? "0.0.0.0",
    port: positiveInteger(environment.PORT, 3_000),
    authSecret,
    wechatAppId: environment.WECHAT_APP_ID,
    wechatAppSecret: environment.WECHAT_APP_SECRET,
    wechatTrustCloudHeaders,
    devAuthEnabled: !production && environment.DEV_AUTH_ENABLED === "true",
    logLevel: environment.LOG_LEVEL ?? "info",
    deadlinePollMs: positiveInteger(environment.DEADLINE_POLL_MS, 1_000),
  };
}
