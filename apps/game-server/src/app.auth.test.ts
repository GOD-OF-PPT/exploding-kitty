import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { AuthService, DisabledWechatProvider } from "./auth/authService.js";

const identity = "00112233445566778899aabbccddeeff";

function dependencies(devAuthEnabled: boolean) {
  const auth = new AuthService("test-auth-secret-that-is-at-least-32-chars", new DisabledWechatProvider(), () => 1_000);
  return {
    auth,
    devAuthEnabled,
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
