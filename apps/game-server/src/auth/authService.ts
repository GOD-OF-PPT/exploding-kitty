import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ServiceError } from "../errors.js";
import type { AuthContext } from "../model.js";

export type WechatIdentity = Readonly<{ openId: string; unionId?: string }>;

export interface WechatIdentityProvider {
  exchange(code: string): Promise<WechatIdentity>;
}

export type AuthSession = Readonly<{ token: string; playerId: string }>;
export type AuthProfile = Readonly<{ displayName?: string; avatarUrl?: string }>;

/** 128-bit installation identifier generated and persisted by an explicitly enabled dev client. */
export const DEVELOPMENT_IDENTITY_PATTERN = /^[0-9a-f]{32}$/;

type TokenPayload = Readonly<{ playerId: string; displayName?: string; avatarUrl?: string; expiresAt: number }>;

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export class AuthService {
  constructor(
    readonly secret: string,
    readonly wechat: WechatIdentityProvider,
    readonly now: () => number = Date.now,
    readonly ttlMs = 30 * 24 * 60 * 60 * 1_000,
  ) {
    if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  }

  issueDevelopment(developmentIdentity: unknown, profile?: AuthProfile): AuthSession {
    if (typeof developmentIdentity !== "string" || !DEVELOPMENT_IDENTITY_PATTERN.test(developmentIdentity)) {
      throw new ServiceError(
        "INVALID_DEVELOPMENT_IDENTITY",
        "developmentIdentity must be exactly 32 lowercase hexadecimal characters",
      );
    }
    // Only the opaque installation identity affects playerId. The profile may change without
    // creating a new player and is carried in the token solely for room/display projection.
    const playerId = `dev_${createHash("sha256").update(developmentIdentity).digest("hex").slice(0, 24)}`;
    const displayName = profile?.displayName?.trim() || `开发玩家 ${developmentIdentity.slice(-4).toUpperCase()}`;
    return {
      playerId,
      token: this.#sign({
        playerId,
        displayName,
        ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        expiresAt: this.now() + this.ttlMs,
      }),
    };
  }

  async issueWechat(code: string, profile?: AuthProfile): Promise<AuthSession> {
    if (!code.trim()) throw new ServiceError("WECHAT_CODE_REQUIRED");
    const identity = await this.wechat.exchange(code);
    const playerId = `wx_${identity.openId}`;
    return { playerId, token: this.#sign({ playerId, ...profile, expiresAt: this.now() + this.ttlMs }) };
  }

  authenticate(token: string): AuthContext {
    const [payloadPart, signature] = token.split(".");
    if (!payloadPart || !signature) throw new ServiceError("UNAUTHORIZED");
    const expected = this.#signature(payloadPart);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new ServiceError("UNAUTHORIZED");
    let payload: TokenPayload;
    try { payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as TokenPayload; }
    catch { throw new ServiceError("UNAUTHORIZED"); }
    if (!payload.playerId || payload.expiresAt <= this.now()) throw new ServiceError("SESSION_EXPIRED");
    return { playerId: payload.playerId, sessionToken: token, displayName: payload.displayName, avatarUrl: payload.avatarUrl };
  }

  #sign(payload: TokenPayload): string {
    const encoded = base64url(JSON.stringify(payload));
    return `${encoded}.${this.#signature(encoded)}`;
  }

  #signature(encoded: string): string {
    return createHmac("sha256", this.secret).update(encoded).digest("base64url");
  }
}

export class WechatCode2SessionProvider implements WechatIdentityProvider {
  constructor(readonly appId: string, readonly appSecret: string, readonly fetcher: typeof fetch = fetch) {}

  async exchange(code: string): Promise<WechatIdentity> {
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", this.appId);
    url.searchParams.set("secret", this.appSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new ServiceError("WECHAT_AUTH_UNAVAILABLE", "WeChat authentication is unavailable", true);
    const body = await response.json() as { openid?: string; unionid?: string; errcode?: number; errmsg?: string };
    if (!body.openid) throw new ServiceError("WECHAT_CODE_INVALID", body.errmsg || "WeChat login code is invalid");
    return { openId: body.openid, unionId: body.unionid };
  }
}

export class DisabledWechatProvider implements WechatIdentityProvider {
  async exchange(): Promise<WechatIdentity> {
    throw new ServiceError("WECHAT_AUTH_NOT_CONFIGURED", "WeChat authentication is not configured");
  }
}
