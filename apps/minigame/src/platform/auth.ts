import type { WxLike } from "./wx";
import { wxError } from "./wx";
import { WxDevelopmentIdentityRepository } from "./storage";

export type AuthSession = Readonly<{ token: string; playerId: string }>;

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export class WxAuthAdapter {
  private readonly developmentIdentity: WxDevelopmentIdentityRepository;

  constructor(
    private readonly wx: WxLike,
    private readonly apiBaseUrl: string,
    createDevelopmentDeviceId?: () => string,
  ) {
    this.developmentIdentity = new WxDevelopmentIdentityRepository(wx, createDevelopmentDeviceId);
  }

  async signIn(): Promise<AuthSession> {
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
    return new Promise((resolve, reject) => {
      this.wx.request({
        url: apiUrl(this.apiBaseUrl, path),
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
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.token === "string" && record.token.length > 0 && typeof record.playerId === "string" && record.playerId.length > 0;
}
