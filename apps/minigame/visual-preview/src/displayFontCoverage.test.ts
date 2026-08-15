import { describe, expect, it } from "vitest";
import { collectDisplayFontStrings } from "./displayFontCoverage";

describe("display font production coverage", () => {
  it("collects only text that production renderers actually draw with DISPLAY_FONT", () => {
    const strings = collectDisplayFontStrings();
    const characters = new Set(strings.join(""));

    expect(strings).toContain("本地状态正常");
    expect(characters.has("地")).toBe(true);
    expect(characters.has("常")).toBe(true);
    expect(strings).not.toContain("本局由本机演示会话驱动，不连接对局服务器；当前回合和私有状态均来自本机。");
  });
});
