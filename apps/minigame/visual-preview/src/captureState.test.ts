import { describe, expect, it, vi } from "vitest";
import type { CaptureStateTarget } from "./capturePlan";

vi.mock("../../src/ui/layoutEngine", () => {
  class MockImage {}
  return {
    default: {
      Image: MockImage,
      registerComponent: vi.fn(),
      getElementById: vi.fn(),
    },
  };
});

import { applyCaptureState } from "./renderCanvas";

describe("visual preview capture state", () => {
  it("leaves an initial capture at the renderer's top state without scroll metadata", async () => {
    const getElementById = vi.fn();
    await expect(applyCaptureState(target({ captureState: "initial" }), { getElementById }, vi.fn()))
      .resolves.toEqual({ captureState: "initial" });
    expect(getElementById).not.toHaveBeenCalled();
  });

  it("scrolls an allowed overflow target to its exact end without animation before capture", async () => {
    const scroll = scrollView(320, 910);
    const paint = vi.fn(async () => undefined);
    const result = await applyCaptureState(target(), {
      getElementById: () => scroll,
    }, paint);

    expect(scroll.scrollTo).toHaveBeenCalledWith(0, 590, false);
    expect(paint).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      captureState: "scroll-end",
      scroll: {
        selector: "#scene-scroll",
        coordinateSpace: "renderer-logical-px",
        viewportHeight: 320,
        contentHeight: 910,
        maxScrollTop: 590,
        scrollTop: 590,
      },
    });
  });

  it.each([
    ["unknown state", { captureState: "sideways" }, "VISUAL_PREVIEW_CAPTURE_STATE_UNKNOWN:sideways"],
    ["wrong screen", { screen: "settings" }, "VISUAL_PREVIEW_CAPTURE_STATE_TARGET_INVALID"],
    ["wrong viewport", { viewport: "389x584" }, "VISUAL_PREVIEW_CAPTURE_STATE_TARGET_INVALID"],
    ["comparison mode", { mode: "compare" }, "VISUAL_PREVIEW_CAPTURE_STATE_TARGET_INVALID"],
  ])("fails closed for %s", async (_label, overrides, message) => {
    const getElementById = vi.fn();
    await expect(applyCaptureState(target(overrides), { getElementById }, vi.fn()))
      .rejects.toThrow(message);
    expect(getElementById).not.toHaveBeenCalled();
  });

  it("permits only the two canonical scroll-end screen and viewport pairs", async () => {
    const scroll = scrollView(320, 910);
    await expect(applyCaptureState(target({
      screen: "rules",
      viewport: "389x584",
    }), { getElementById: () => scroll }, vi.fn(async () => undefined)))
      .resolves.toMatchObject({ captureState: "scroll-end" });
  });

  it("fails closed when the target is missing or is not a real ScrollView", async () => {
    await expect(applyCaptureState(target(), { getElementById: () => null }, vi.fn()))
      .rejects.toThrow("VISUAL_PREVIEW_SCROLL_STATE_TARGET_MISSING");
    await expect(applyCaptureState(target(), {
      getElementById: () => ({ type: "View", scrollTo: vi.fn() }),
    }, vi.fn())).rejects.toThrow("VISUAL_PREVIEW_SCROLL_STATE_TARGET_MISSING");
    await expect(applyCaptureState(target(), {
      getElementById: () => ({ type: "ScrollView", layoutBox: { height: 320 }, scrollHeight: 910 }),
    }, vi.fn())).rejects.toThrow("VISUAL_PREVIEW_SCROLL_STATE_TARGET_MISSING");
  });

  it.each([
    [0, 910],
    [320, 320],
    [320, 100],
    [Number.NaN, 910],
    [320, Number.POSITIVE_INFINITY],
  ])("fails closed for a non-overflow geometry %s/%s", async (viewportHeight, contentHeight) => {
    await expect(applyCaptureState(
      target(),
      { getElementById: () => scrollView(viewportHeight, contentHeight) },
      vi.fn(),
    )).rejects.toThrow("VISUAL_PREVIEW_SCROLL_STATE_NOT_SCROLLABLE");
  });

  it("fails closed unless the renderer reaches max scrollTop within 0.01px", async () => {
    await expect(applyCaptureState(
      target(),
      { getElementById: () => scrollView(320, 910, 589.989) },
      vi.fn(async () => undefined),
    )).rejects.toThrow("VISUAL_PREVIEW_SCROLL_STATE_NOT_AT_END");

    await expect(applyCaptureState(
      target(),
      { getElementById: () => scrollView(320, 910, 589.991) },
      vi.fn(async () => undefined),
    )).resolves.toMatchObject({ scroll: { scrollTop: 589.991, maxScrollTop: 590 } });
  });
});

function target(overrides: Readonly<Record<string, unknown>> = {}): CaptureStateTarget {
  return {
    screen: "network",
    viewport: "372x749",
    mode: "canvas",
    captureState: "scroll-end",
    ...overrides,
  } as CaptureStateTarget;
}

type ScrollViewLike = {
  type: "ScrollView";
  layoutBox: { height: number };
  scrollHeight: number;
  scrollTop: number;
  scrollTo: ReturnType<typeof vi.fn>;
};

function scrollView(
  viewportHeight: number,
  contentHeight: number,
  settledTop: number | "requested" = "requested",
): ScrollViewLike {
  const value: ScrollViewLike = {
    type: "ScrollView",
    layoutBox: { height: viewportHeight },
    scrollHeight: contentHeight,
    scrollTop: 0,
    scrollTo: vi.fn((_left: number, top: number) => {
      value.scrollTop = settledTop === "requested" ? top : settledTop;
    }),
  };
  return value;
}
