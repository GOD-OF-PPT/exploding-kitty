import { describe, expect, it } from "vitest";
import { configureCaptureCanvas, parseCaptureDpr } from "./renderDpr";
import { VIEWPORTS } from "./viewports";

describe("visual preview DPR rendering contract", () => {
  it.each([1, 2, 3] as const)("renders CSS-logical pixels into a DPR%s backing store", (renderDpr) => {
    const canvas = { width: 0, height: 0, style: { width: "", height: "" } } as HTMLCanvasElement;

    expect(configureCaptureCanvas(canvas, VIEWPORTS["390x844"], renderDpr)).toEqual({
      renderDpr,
      designScale: 1,
      backingScale: renderDpr,
      intrinsic: { width: 390 * renderDpr, height: 844 * renderDpr },
    });
    expect({ width: canvas.width, height: canvas.height }).toEqual({
      width: 390 * renderDpr,
      height: 844 * renderDpr,
    });
    expect(canvas.style.width).toBe("390px");
    expect(canvas.style.height).toBe("844px");
  });

  it("fails closed instead of silently falling back to DPR1", () => {
    const canvas = { width: 0, height: 0, style: { width: "", height: "" } } as HTMLCanvasElement;
    expect(() => configureCaptureCanvas(canvas, VIEWPORTS["390x844"], 1.5 as 1))
      .toThrow("VISUAL_PREVIEW_RENDER_DPR_INVALID:1.5");
  });

  it("accepts only DPR1/2/3 canvas queries and keeps comparisons byte-exact at DPR1", () => {
    expect(parseCaptureDpr(null, "canvas")).toBe(1);
    expect(parseCaptureDpr("2", "canvas")).toBe(2);
    expect(parseCaptureDpr("3", "canvas")).toBe(3);
    expect(() => parseCaptureDpr("1.5", "canvas")).toThrow("VISUAL_PREVIEW_RENDER_DPR_UNKNOWN:1.5");
    expect(() => parseCaptureDpr("2", "compare")).toThrow("VISUAL_PREVIEW_COMPARISON_DPR_INVALID:2");
  });
});
