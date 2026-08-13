import { describe, expect, it, vi } from "vitest";
import type { WxLike } from "../platform";
import { applyLayoutTransform, extractCssPoint, resolveCanvasMetrics, sizeDisplayCanvas } from "./canvasMetrics";

describe("mini-game canvas metrics", () => {
  it("keeps layout, backing pixels and touch coordinates in their own coordinate spaces", () => {
    const metrics = resolveCanvasMetrics(systemInfo({ windowWidth: 390, windowHeight: 844, pixelRatio: 3 }));
    expect(metrics.viewport).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(metrics.backingWidth).toBe(1170);
    expect(metrics.backingHeight).toBe(2532);
    expect(metrics.renderScale).toBe(3);
    expect(extractCssPoint({ changedTouches: [{ pageX: 120, pageY: 240 }] })).toEqual({ x: 120, y: 240 });
  });

  it("fits the 390 x 844 design uniformly and converts the real safe area to design units", () => {
    const metrics = resolveCanvasMetrics(systemInfo({
      windowWidth: 390,
      windowHeight: 844,
      pixelRatio: 3,
      safeArea: { left: 0, top: 47, right: 390, bottom: 810, width: 390, height: 763 },
    }));
    expect(metrics.layoutScale).toBe(1);
    expect(metrics.safeInsets).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });

    const short = resolveCanvasMetrics(systemInfo({ windowWidth: 390, windowHeight: 700, pixelRatio: 2 }));
    expect(short.layoutScale).toBeCloseTo(700 / 844);
    expect(short.viewport.width).toBeLessThan(390);
    expect(short.viewport.x).toBeGreaterThan(0);
  });

  it("applies the same DPR and viewport transform used by hit testing", () => {
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
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 40, 0);
  });
});

function systemInfo(overrides: Partial<ReturnType<WxLike["getSystemInfoSync"]>>): ReturnType<WxLike["getSystemInfoSync"]> {
  return { windowWidth: 390, windowHeight: 844, pixelRatio: 1, ...overrides };
}
