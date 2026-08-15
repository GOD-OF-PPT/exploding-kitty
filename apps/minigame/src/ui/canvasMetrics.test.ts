import { describe, expect, it, vi } from "vitest";
import type { WxLike } from "../platform";
import {
  applyLayoutTransform,
  cssPointToDesignPoint,
  extractCssPoint,
  extractDesignPoint,
  resolveCanvasMetrics,
  sizeDisplayCanvas,
} from "./canvasMetrics";
import { resolveImageDraw } from "./rendering/fitImage";

describe("mini-game canvas metrics", () => {
  it("keeps layout, backing pixels and touch coordinates in their own coordinate spaces", () => {
    const metrics = resolveCanvasMetrics(systemInfo({ windowWidth: 390, windowHeight: 844, pixelRatio: 3 }));
    expect(metrics.viewport).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(metrics.backingWidth).toBe(1170);
    expect(metrics.backingHeight).toBe(2532);
    expect(metrics.logicalWidth).toBe(390);
    expect(metrics.logicalHeight).toBe(844);
    expect(metrics.renderScale).toBe(3);
    expect(extractCssPoint({ changedTouches: [{ pageX: 120, pageY: 240 }] })).toEqual({ x: 120, y: 240 });
    expect(extractDesignPoint({ changedTouches: [{ pageX: 120, pageY: 240 }] }, metrics)).toEqual({ x: 120, y: 240 });
  });

  it("uses the screen width as the single scale and converts safe areas to design units", () => {
    const metrics = resolveCanvasMetrics(systemInfo({
      windowWidth: 390,
      windowHeight: 844,
      pixelRatio: 3,
      safeArea: { left: 0, top: 47, right: 390, bottom: 810, width: 390, height: 763 },
    }));
    expect(metrics.layoutScale).toBe(1);
    expect(metrics.safeInsets).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });

    const short = resolveCanvasMetrics(systemInfo({ windowWidth: 389, windowHeight: 584, pixelRatio: 2 }));
    expect(short.layoutScale).toBeCloseTo(389 / 390);
    expect(short.logicalWidth).toBe(390);
    expect(short.logicalHeight).toBeCloseTo(584 / (389 / 390));
    expect(short.viewport).toEqual({ x: 0, y: 0, width: 389, height: 584 });
    expect(short.viewport.width / short.layoutScale).toBeCloseTo(390);
  });

  it("applies the same width-driven DPR transform used by hit testing", () => {
    const metrics = resolveCanvasMetrics(systemInfo({ windowWidth: 430, windowHeight: 844, pixelRatio: 2 }));
    const setTransform = vi.fn();
    const context = { setTransform } as unknown as CanvasRenderingContext2D;
    const style: { width?: string; height?: string } = {};
    const canvas = { width: 0, height: 0, style } as unknown as HTMLCanvasElement;
    sizeDisplayCanvas(canvas, metrics);
    applyLayoutTransform(context, metrics);
    expect(canvas.width).toBe(860);
    expect(canvas.height).toBe(1688);
    expect(style).toEqual({ width: "430px", height: "844px" });
    expect(setTransform).toHaveBeenCalledWith(2 * (430 / 390), 0, 0, 2 * (430 / 390), 0, 0);
  });

  it("converts the WeChat menu capsule and CSS touch points into design coordinates", () => {
    const metrics = resolveCanvasMetrics(
      systemInfo({ windowWidth: 375, windowHeight: 812, pixelRatio: 3 }),
      { left: 278, top: 24, right: 365, bottom: 56, width: 87, height: 32 },
    );
    const scale = 375 / 390;

    expect(metrics.capsuleRect).toEqual({
      left: 278 / scale,
      top: 24 / scale,
      right: 365 / scale,
      bottom: 56 / scale,
      width: 87 / scale,
      height: 32 / scale,
    });
    expect(cssPointToDesignPoint({ x: 187.5, y: 100 }, metrics)).toEqual({ x: 195, y: 104 });
    expect(extractDesignPoint({ touches: [{ clientX: 187.5, clientY: 100 }] }, metrics)).toEqual({ x: 195, y: 104 });
  });

  it("ignores invalid capsule rectangles without poisoning layout metrics", () => {
    const metrics = resolveCanvasMetrics(
      systemInfo({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
      { left: Number.NaN, top: 20, right: 360, bottom: 52, width: 80, height: 32 },
    );

    expect(metrics.capsuleRect).toBeNull();
  });
});

describe("fit image placement", () => {
  it("contains a wide cast image without stretching and honors bottom position", () => {
    expect(resolveImageDraw(960, 300, 0, 0, 250, 200, "contain", { x: 0.5, y: 1 })).toEqual({
      source: { x: 0, y: 0, width: 960, height: 300 },
      destination: { x: 0, y: 121.875, width: 250, height: 78.125 },
    });
  });

  it("covers a landscape frame by cropping a portrait instead of flattening it", () => {
    expect(resolveImageDraw(220, 396, 0, 0, 250, 200, "cover", { x: 0.5, y: 0.5 })).toEqual({
      source: { x: 0, y: 110, width: 220, height: 176 },
      destination: { x: 0, y: 0, width: 250, height: 200 },
    });
  });
});

function systemInfo(overrides: Partial<ReturnType<WxLike["getSystemInfoSync"]>>): ReturnType<WxLike["getSystemInfoSync"]> {
  return { windowWidth: 390, windowHeight: 844, pixelRatio: 1, ...overrides };
}
