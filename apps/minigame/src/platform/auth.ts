import type { WxLike } from "./wx";
import { wxError } from "./wx";
import { WxDevelopmentIdentityRepository } from "./storage";

export type AuthSession = Readonly<{ token: string; playerId: string }>;

export type AuthEndpoint =
  | Readonly<{ kind: "direct"; apiBaseUrl: string }>
  | Readonly<{ kind: "cloudContainer"; environmentId: string; serviceName: string }>;

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export class WxAuthAdapter {
  private readonly developmentIdentity: WxDevelopmentIdentityRepository;
  private readonly endpoint: AuthEndpoint;
  private cloudInitialization?: Promise<void>;

  constructor(
    private readonly wx: WxLike,
    endpoint: AuthEndpoint | string,
    createDevelopmentDeviceId?: () => string,
  ) {
    this.endpoint = typeof endpoint === "string" ? { kind: "direct", apiBaseUrl: endpoint } : endpoint;
    this.developmentIdentity = new WxDevelopmentIdentityRepository(wx, createDevelopmentDeviceId);
  }

  async signIn(): Promise<AuthSession> {
    if (this.endpoint.kind === "cloudContainer") {
      return this.exchange("/v1/auth/wechat", {});
    }
    const code = await new Promise<string>((resolve, reject) => {
      this.wx.login({ timeout: 8000, success: (result) => resolve(result.code), fail: (error) => reject(wxError(error, "WX_LOGIN_FAILED")) });
    });
    return this.exchange("/v1/auth/wechat", { code });
  }

  async signInForDevelopment(): Promise<AuthSession> {
    const identity = this.developmentIdentity.getOrCreate();
    return this.exchange("/v1/auth/dev", {
      developmentIdentity: identity.deviceId,
      profile: { displayName: identity.displayName },
    });
  }

  private exchange(path: string, data: unknown): Promise<AuthSession> {
    if (this.endpoint.kind === "cloudContainer") return this.exchangeThroughCloudContainer(path, data);
    return this.exchangeDirectly(path, data);
  }

  private exchangeDirectly(path: string, data: unknown): Promise<AuthSession> {
    const endpoint = this.endpoint;
    if (endpoint.kind !== "direct") throw new Error("DIRECT_AUTH_ENDPOINT_REQUIRED");
    return new Promise((resolve, reject) => {
      this.wx.request({
        url: apiUrl(endpoint.apiBaseUrl, path),
        method: "POST",
        data,
        header: { "content-type": "application/json" },
        timeout: 10000,
        success: ({ statusCode, data: body }) => {
          if (statusCode < 200 || statusCode >= 300 || !isAuthSession(body)) {
            reject(new Error(`AUTH_INVALID_RESPONSE (${statusCode})`));
            return;
          }
          resolve(body);
        },
        fail: (error) => reject(wxError(error, "AUTH_SERVICE_UNAVAILABLE")),
      });
    });
  }

  private async exchangeThroughCloudContainer(path: string, data: unknown): Promise<AuthSession> {
    const endpoint = this.endpoint;
    if (endpoint.kind !== "cloudContainer") throw new Error("CLOUD_AUTH_ENDPOINT_REQUIRED");
    const cloud = this.wx.cloud;
    if (!cloud) throw new Error("WX_CLOUD_UNAVAILABLE");
    this.cloudInitialization ??= Promise.resolve(cloud.init({ env: endpoint.environmentId, traceUser: true }));
    await this.cloudInitialization;
    let response;
    try {
      response = await cloud.callContainer({
        config: { env: endpoint.environmentId },
        path,
        method: "POST",
        data,
        header: {
          "content-type": "application/json",
          "X-WX-SERVICE": endpoint.serviceName,
        },
        timeout: 10_000,
      });
    } catch (error) {
      throw wxError(asWxResult(error), "AUTH_SERVICE_UNAVAILABLE");
    }
    if (response.statusCode < 200 || response.statusCode >= 300 || !isAuthSession(response.data)) {
      throw new Error(`AUTH_INVALID_RESPONSE (${response.statusCode})`);
    }
    return response.data;
  }
}

function asWxResult(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return { errMsg: typeof value === "string" ? value : "AUTH_SERVICE_UNAVAILABLE" };
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.token === "string" && record.token.length > 0 && typeof record.playerId === "string" && record.playerId.length > 0;
}
