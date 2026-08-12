import { describe, expect, it } from "vitest";
import { resolveBootstrapRoute } from "../src/bootstrapRoute.js";

describe("bootstrap route", () => {
  it.each(["#gallery", "#gallery/game", "#game", "#rules", "#game-menu", "#audit/game"])(
    "sends production hash %s to the live application",
    (hash) => {
      expect(resolveBootstrapRoute(hash, false).surface).toBe("live");
    },
  );

  it("keeps the legacy gallery and audit fixture available in development", () => {
    expect(resolveBootstrapRoute("#gallery/game", true)).toEqual({ surface: "gallery", route: "gallery/game" });
    expect(resolveBootstrapRoute("#rules", true)).toEqual({ surface: "gallery", route: "rules" });
    expect(resolveBootstrapRoute("#audit/game", true)).toEqual({ surface: "audit", route: "game" });
    expect(resolveBootstrapRoute("#unrecognized", true)).toEqual({ surface: "live", route: "unrecognized" });
  });
});
