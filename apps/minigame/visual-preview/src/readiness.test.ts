import { describe, expect, it, vi } from "vitest";
import {
  hashCanvasPixels,
  waitForCanvasStability,
  waitForDecodedImages,
  waitForDisplayFont,
  type FontSetLike,
} from "./readiness";

describe("visual preview readiness", () => {
  it("explicitly loads and verifies the display font before continuing", async () => {
    const load = vi.fn(async () => []);
    const check = vi.fn(() => true);
    const fonts: FontSetLike = { load, check, ready: Promise.resolve() };

    await waitForDisplayFont(fonts, "ZCOOL KuaiLe");

    expect(load).toHaveBeenCalledWith('16px "ZCOOL KuaiLe"', "炸毛危机今晚谁先炸");
    expect(check).toHaveBeenCalledWith('16px "ZCOOL KuaiLe"', "炸毛危机今晚谁先炸");
  });

  it("waits for every renderer image decode and rejects an empty image", async () => {
    const firstDecode = vi.fn(async () => undefined);
    const secondDecode = vi.fn(async () => undefined);

    await waitForDecodedImages([
      { src: "first.png", naturalWidth: 120, decode: firstDecode },
      { src: "second.png", width: 80, decode: secondDecode },
    ], "IMAGE_FAILED");

    expect(firstDecode).toHaveBeenCalledTimes(1);
    expect(secondDecode).toHaveBeenCalledTimes(1);
    await expect(waitForDecodedImages([null], "IMAGE_FAILED")).rejects.toThrow("IMAGE_FAILED:0");
  });

  it("requires two consecutive equal preview-canvas hashes", async () => {
    const values = ["frame-a", "frame-b", "frame-b"];
    const hash = vi.fn(() => values.shift() ?? "frame-b");
    const nextFrame = vi.fn(async () => undefined);
    const settle = vi.fn(async () => undefined);

    const result = await waitForCanvasStability({} as HTMLCanvasElement, {
      hash,
      nextFrame,
      settle,
      stableSamples: 2,
      maxSamples: 5,
    });

    expect(result).toEqual({ hash: "frame-b", samples: 3, stableSamples: 2 });
    expect(nextFrame).toHaveBeenCalledTimes(3);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the canvas never stabilizes", async () => {
    let frame = 0;
    await expect(waitForCanvasStability({} as HTMLCanvasElement, {
      hash: () => `frame-${frame++}`,
      nextFrame: async () => undefined,
      settle: async () => undefined,
      maxSamples: 4,
    })).rejects.toThrow("VISUAL_PREVIEW_CANVAS_UNSTABLE:4");
  });

  it("hashes exact RGBA pixels and canvas dimensions", () => {
    const left = pixelCanvas(1, 1, [1, 2, 3, 255]);
    const same = pixelCanvas(1, 1, [1, 2, 3, 255]);
    const changedPixel = pixelCanvas(1, 1, [1, 2, 4, 255]);
    const changedSize = pixelCanvas(2, 1, [1, 2, 3, 255]);

    expect(hashCanvasPixels(left)).toBe(hashCanvasPixels(same));
    expect(hashCanvasPixels(left)).not.toBe(hashCanvasPixels(changedPixel));
    expect(hashCanvasPixels(left)).not.toBe(hashCanvasPixels(changedSize));
  });
});

function pixelCanvas(width: number, height: number, bytes: readonly number[]): HTMLCanvasElement {
  return {
    width,
    height,
    getContext: vi.fn(() => ({
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(bytes) })),
    })),
  } as unknown as HTMLCanvasElement;
}
