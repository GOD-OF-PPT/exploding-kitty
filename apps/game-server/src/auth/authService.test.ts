import { describe, expect, it } from "vitest";
import { AuthService, DisabledWechatProvider } from "./authService.js";

const identityA = "00112233445566778899aabbccddeeff";
const identityB = "ffeeddccbbaa99887766554433221100";

function service() {
  return new AuthService("test-auth-secret-that-is-at-least-32-chars", new DisabledWechatProvider(), () => 1_000);
}

describe("development authentication", () => {
  it("derives identity only from the dedicated opaque development identity", () => {
    const auth = service();
    const first = auth.issueDevelopment(identityA, { displayName: "Alice Dev" });
    const renamed = auth.issueDevelopment(identityA, { displayName: "Renamed Dev" });
    const other = auth.issueDevelopment(identityB, { displayName: "Alice Dev" });

    expect(renamed.playerId).toBe(first.playerId);
    expect(other.playerId).not.toBe(first.playerId);
    expect(auth.authenticate(renamed.token).displayName).toBe("Renamed Dev");
  });

  it.each([undefined, "", "abc", "00112233445566778899AABBCCDDEEFF", `${identityA}00`])(
    "rejects invalid identity %s",
    (identity) => expect(() => service().issueDevelopment(identity)).toThrow("developmentIdentity must be exactly 32 lowercase hexadecimal characters"),
  );

  it("uses a friendly default name without exposing the identity", () => {
    const auth = service();
    const session = auth.issueDevelopment(identityA);
    expect(auth.authenticate(session.token).displayName).toBe("开发玩家 EEFF");
  });
});

describe("trusted WeChat authentication", () => {
  it("issues the same identity shape as code exchange without invoking a provider", () => {
    const auth = service();
    const session = auth.issueTrustedWechat("cloud_open-id-123", "wx-client", { displayName: "  Cloud Player  " });

    expect(session.playerId).toBe("wx_cloud_open-id-123");
    expect(auth.authenticate(session.token)).toMatchObject({
      playerId: "wx_cloud_open-id-123",
      displayName: "Cloud Player",
    });
  });

  it.each([undefined, "", "has spaces", "one,two", "../openid", "a".repeat(97)])(
    "rejects an invalid trusted OpenID (%s)",
    (openId) => expect(() => service().issueTrustedWechat(openId, "wx-client")).toThrow("X-WX-OPENID"),
  );

  it.each([undefined, "", "   ", "invalid\nsource", "a".repeat(129)])(
    "rejects an invalid trusted source (%s)",
    (source) => expect(() => service().issueTrustedWechat("cloud_open-id-123", source)).toThrow("X-WX-SOURCE"),
  );

  it("binds a trusted socket token to the gateway OpenID", () => {
    const auth = service();
    const session = auth.issueTrustedWechat("cloud_open-id-123", "wx-client", { displayName: "Cloud Player" });

    expect(auth.authenticateTrustedWechatSocket(session.token, "cloud_open-id-123", "wx-client")).toMatchObject({
      playerId: "wx_cloud_open-id-123",
      displayName: "Cloud Player",
    });
    expect(() => auth.authenticateTrustedWechatSocket(session.token, "other-openid", "wx-client")).toThrow("UNAUTHORIZED");
  });

  it.each([
    { openId: undefined, source: "wx-client" },
    { openId: "cloud_open-id-123", source: undefined },
    { openId: undefined, source: undefined },
  ])("accepts a valid WeChat token when connectContainer omits optional gateway headers", ({ openId, source }) => {
    const auth = service();
    const session = auth.issueTrustedWechat("cloud_open-id-123", "wx-client");

    expect(auth.authenticateTrustedWechatSocket(session.token, openId, source).playerId)
      .toBe("wx_cloud_open-id-123");
  });

  it("does not allow a development token to stand in for a missing cloud OpenID", () => {
    const auth = service();
    const development = auth.issueDevelopment(identityA);

    expect(() => auth.authenticateTrustedWechatSocket(development.token, undefined, "wx-client"))
      .toThrow("UNAUTHORIZED");
  });

  it.each([
    { openId: "invalid openid", source: "wx-client" },
    { openId: "cloud_open-id-123", source: "" },
  ])("rejects malformed trusted socket headers ($openId, $source)", ({ openId, source }) => {
    const auth = service();
    const session = auth.issueTrustedWechat("cloud_open-id-123", "wx-client");
    expect(() => auth.authenticateTrustedWechatSocket(session.token, openId, source)).toThrow();
  });
});
