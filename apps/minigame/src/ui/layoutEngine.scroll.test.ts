import { afterEach, describe, expect, it, vi } from "vitest";

type TouchPoint = Readonly<{
  pageX: number;
  pageY: number;
}>;

type TouchEvent = Readonly<{
  timeStamp: number;
  touches: readonly TouchPoint[];
}>;

describe("layout engine ScrollView integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps WeChat touch drags in CSS coordinates when pixelRatio is 3", async () => {
    vi.resetModules();
    const wxMock = {
      getSystemInfoSync: vi.fn(() => ({ pixelRatio: 3 })),
    };
    vi.stubGlobal("wx", wxMock);
    vi.stubGlobal("GameGlobal", globalThis);

    const { default: layout } = await import("./layoutEngine");
    expect(GameGlobal.wx).toBe(wxMock);
    expect(wxMock.getSystemInfoSync()).toEqual({ pixelRatio: 3 });

    const scrollView = new layout.ScrollView({ style: {}, scrollY: true });
    const content = new layout.View({ style: {} });
    const root = {
      emit: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
      ticker: { next: vi.fn() },
    };

    scrollView.root = root as unknown as typeof scrollView.root;
    scrollView.layoutBox = box(0, 0, 100, 100);
    content.parent = scrollView;
    content.root = root as unknown as typeof content.root;
    content.layoutBox = box(0, 0, 100, 300);
    scrollView.children = [content];
    scrollView.insert({} as CanvasRenderingContext2D);

    scrollView.emit("touchstart", touchEvent(90, 0));
    scrollView.emit("touchmove", touchEvent(80, 16));
    scrollView.emit("touchmove", touchEvent(60, 32));
    scrollView.emit("touchmove", touchEvent(50, 48));

    expect(wxMock.getSystemInfoSync).toHaveBeenCalled();
    expect(scrollView.scrollTop).toBeGreaterThan(0);
    expect(scrollView.scrollTop).toBe(30);
    expect(layout.env.getDevicePixelRatio()).toBe(1);
  });
});

function touchEvent(pageY: number, timeStamp: number): TouchEvent {
  return {
    timeStamp,
    touches: [{ pageX: 50, pageY }],
  };
}

function box(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    absoluteX: left,
    absoluteY: top,
    originalAbsoluteX: left,
    originalAbsoluteY: top,
  };
}
