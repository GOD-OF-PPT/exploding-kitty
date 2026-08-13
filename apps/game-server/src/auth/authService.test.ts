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
