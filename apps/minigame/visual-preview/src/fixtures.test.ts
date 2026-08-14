import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SCENE_RENDERERS } from "../../src/ui/rendering/rendererRegistry";
import {
  PROTOTYPE_REFERENCE_FILES,
  SCREEN_FIXTURES,
  SCREEN_ORDER,
  SHORT_SCREEN_FAMILY_REPRESENTATIVES,
} from "./fixtures";

describe("visual preview fixtures", () => {
  it("covers every renderer exactly once in the fixed capture order", () => {
    expect(SCREEN_ORDER).toHaveLength(25);
    expect(new Set(SCREEN_ORDER).size).toBe(SCREEN_ORDER.length);
    expect(Object.keys(SCREEN_FIXTURES)).toEqual([...SCREEN_ORDER]);
    expect(Object.keys(SCENE_RENDERERS)).toEqual([...SCREEN_ORDER]);
    expect(SCREEN_ORDER.map((id) => SCREEN_FIXTURES[id].id)).toEqual([...SCREEN_ORDER]);
  });

  it("provides one short-screen representative for every scene family", () => {
    expect(Object.keys(SHORT_SCREEN_FAMILY_REPRESENTATIVES)).toEqual([
      "brand",
      "room-entry",
      "lobby",
      "table",
      "choice",
      "outcome",
      "editorial",
      "utility",
    ]);
    expect(new Set(Object.values(SHORT_SCREEN_FAMILY_REPRESENTATIVES)).size).toBe(8);
  });

  it("maps every screen to a unique prototype reference", () => {
    expect(Object.keys(PROTOTYPE_REFERENCE_FILES)).toEqual([...SCREEN_ORDER]);
    expect(new Set(Object.values(PROTOTYPE_REFERENCE_FILES)).size).toBe(SCREEN_ORDER.length);
  });

  it("keeps table fixtures renderable and excludes unstable data sources", () => {
    for (const id of ["game", "other-turn", "attack"] as const) {
      expect(SCREEN_FIXTURES[id].table).toBeDefined();
    }
    const source = readFileSync(new URL("./fixtures.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Date(?:\.now)?\s*\(|Math\.random\s*\(|fetch\s*\(|(?:local|session)Storage/);
  });
});
