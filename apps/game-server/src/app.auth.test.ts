import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { AuthService, DisabledWechatProvider, type WechatIdentityProvider } from "./auth/authService.js";

const identity = "00112233445566778899aabbccddeeff";

function dependencies(
  devAuthEnabled: boolean,
  wechatTrustCloudHeaders = false,
  wechat: WechatIdentityProvider = new DisabledWechatProvider(),
) {
  const auth = new AuthService("test-auth-secret-that-is-at-least-32-chars", wechat, () => 1_000);
  return {
    auth,
    devAuthEnabled,
    wechatTrustCloudHeaders,
    rooms: {} as never,
    store: {} as never,
    gateway: {} as never,
    hub: {} as never,
  };
}

describe("development auth endpoint", () => {
  it("issues a session from developmentIdentity while keeping profile display-only", async () => {
    const context = dependencies(true);
    const app = await buildApp(context);
    const first = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: identity, profile: { displayName: "测试开发者" } } });
    const renamed = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: identity, profile: { displayName: "新名字" } } });
    expect(first.statusCode).toBe(200);
    expect(renamed.statusCode).toBe(200);
    expect(first.json().playerId).toBe(renamed.json().playerId);
    expect(context.auth.authenticate(renamed.json().token).displayName).toBe("新名字");
    await app.close();
  });

  it.each([{}, { developmentIdentity: "" }, { developmentIdentity: "not-an-identity" }])("rejects missing or invalid developmentIdentity", async (payload) => {
    const app = await buildApp(dependencies(true));
    const response = await app.inject({ method: "POST", url: "/v1/auth/dev", payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_DEVELOPMENT_IDENTITY", retryable: false });
    await app.close();
  });

  it("does not expose the endpoint when development auth is disabled", async () => {
    const app = await buildApp(dependencies(false));
    const response = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: identity } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "NOT_FOUND" });
    await app.close();
  });
});

describe("WeChat auth endpoint", () => {
  it("issues a session from the WeChat Cloud Run-injected OpenID only in explicit trusted mode", async () => {
    const exchange = vi.fn();
    const context = dependencies(false, true, { exchange });
    const app = await buildApp(context);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/wechat",
      headers: { "x-wx-openid": "cloud_open-id-123", "x-wx-source": "wx-client" },
      payload: { code: "must-not-be-used", profile: { displayName: "Cloud Player" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().playerId).toBe("wx_cloud_open-id-123");
    expect(context.auth.authenticate(response.json().token).displayName).toBe("Cloud Player");
    expect(exchange).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([undefined, "invalid openid", "first,second", ""])(
    "rejects a missing or malformed trusted OpenID (%s)",
    async (openId) => {
      const app = await buildApp(dependencies(false, true));
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/wechat",
        headers: {
          "x-wx-source": "wx-client",
          ...(openId === undefined ? {} : { "x-wx-openid": openId }),
        },
        payload: { code: "client-code-cannot-replace-the-trusted-header" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: "WECHAT_CLOUD_IDENTITY_REQUIRED", retryable: false });
      await app.close();
    },
  );

  it.each([undefined, ""])("fails closed when the trusted source header is absent (%s)", async (source) => {
    const app = await buildApp(dependencies(false, true));
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/wechat",
      headers: {
        "x-wx-openid": "cloud_open-id-123",
        ...(source === undefined ? {} : { "x-wx-source": source }),
      },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "WECHAT_CLOUD_SOURCE_REQUIRED", retryable: false });
    await app.close();
  });

  it("ignores a client-supplied X-WX-OPENID when trusted mode is disabled", async () => {
    const app = await buildApp(dependencies(false));
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/wechat",
      headers: { "x-wx-openid": "spoofed-openid" },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "WECHAT_CODE_REQUIRED" });
    await app.close();
  });
});

describe("auth endpoint IP rate limiting (VAL-M2-002)", () => {
  const hexId = (i: number): string => i.toString(16).padStart(32, "0");

  it("allows 60 POST /v1/auth/dev from the same IP and returns 429 on the 61st", async () => {
    const app = await buildApp(dependencies(true));
    for (let i = 0; i < 60; i++) {
      const response = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: hexId(i + 1) } });
      expect(response.statusCode).toBe(200);
    }
    const blocked = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: hexId(61) } });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    await app.close();
  });

  it("does not rate-limit non-auth routes", async () => {
    const app = await buildApp(dependencies(true));
    for (let i = 0; i < 70; i++) {
      const response = await app.inject({ method: "GET", url: "/health/live" });
      expect(response.statusCode).toBe(200);
    }
    // Auth endpoint should still work after many health checks
    const authResponse = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: identity } });
    expect(authResponse.statusCode).toBe(200);
    await app.close();
  });

  it("rate-limits /v1/auth/wechat as well", async () => {
    const app = await buildApp(dependencies(false, true));
    for (let i = 0; i < 60; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/wechat",
        headers: { "x-wx-openid": `cloud_open-id-${i + 1}`, "x-wx-source": "wx-client" },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/auth/wechat",
      headers: { "x-wx-openid": "cloud_open-id-61", "x-wx-source": "wx-client" },
      payload: {},
    });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });

  it("rate limiter is not spoofable via x-forwarded-for without trustProxy", async () => {
    const app = await buildApp(dependencies(true));
    // Exhaust the default IP (127.0.0.1)
    for (let i = 0; i < 60; i++) {
      await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: hexId(i + 1) } });
    }
    const blocked = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: hexId(61) } });
    expect(blocked.statusCode).toBe(429);
    // Without trustProxy, request.ip is the socket remote address (127.0.0.1).
    // The x-forwarded-for header is ignored, so this is also rate-limited.
    const spoofed = await app.inject({
      method: "POST",
      url: "/v1/auth/dev",
      headers: { "x-forwarded-for": "10.0.0.1" },
      payload: { developmentIdentity: hexId(62) },
    });
    expect(spoofed.statusCode).toBe(429);
    await app.close();
  });

  it("respects a custom injected authRateLimiter with a lower limit", async () => {
    const { AuthRateLimiter } = await import("./transport/authRateLimiter.js");
    const app = await buildApp({ ...dependencies(true), authRateLimiter: new AuthRateLimiter({ limit: 3, windowMs: 60_000 }) });
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: hexId(i + 1) } });
      expect(response.statusCode).toBe(200);
    }
    const blocked = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: hexId(4) } });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });
});
