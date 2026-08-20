import { describe, expect, it, vi } from "vitest";
import { CardTableSurface, type TableSurfaceState } from "./cardTableSurface";

describe("CardTableSurface invalidation", () => {
  it("redraws and notifies the current subscriber when an image loads without a later state update", () => {
    const context = recordingContext();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const images: HTMLImageElement[] = [];
    const surface = new CardTableSurface(
      () => canvas,
      () => {
        const image = readyImage();
        images.push(image);
        return image;
      },
      state(),
    );
    const invalidate = vi.fn();
    const unsubscribe = surface.subscribeInvalidation(invalidate);
    const drawsBeforeLoad = vi.mocked(context.clearRect).mock.calls.length;

    fireLoad(images[0]!);

    expect(context.clearRect).toHaveBeenCalledTimes(drawsBeforeLoad + 1);
    expect(invalidate).toHaveBeenCalledTimes(1);

    unsubscribe();
    fireLoad(images[1]!);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

function state(): TableSurfaceState {
  return {
    width: 368,
    height: 705,
    renderScale: 3,
    deckCount: 18,
    hand: [],
    players: [],
    myTurn: true,
    turnsOwed: 1,
  };
}

function readyImage(): HTMLImageElement {
  return {
    width: 220,
    height: 396,
    naturalWidth: 220,
    naturalHeight: 396,
    onload: null,
    src: "",
  } as unknown as HTMLImageElement;
}

function fireLoad(image: HTMLImageElement): void {
  if (typeof image.onload === "function") image.onload.call(image, {} as Event);
}

function recordingContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  const target: Record<PropertyKey, unknown> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    filter: "none",
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    measureText: vi.fn((value: string) => ({ width: value.length * 10 } as TextMetrics)),
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      const method = vi.fn();
      object[property] = method;
      return method;
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
