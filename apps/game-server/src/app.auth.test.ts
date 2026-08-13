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
