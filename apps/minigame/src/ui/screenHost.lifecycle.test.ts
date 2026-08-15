import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WxLike } from "../platform";
import type { GameSession, RawProductView, ScreenModel } from "./model";

const mocks = vi.hoisted(() => ({
  elements: new Map<string, unknown>(),
  invalidation: null as (() => void) | null,
  surfaceState: null as Record<string, unknown> | null,
  surfaceUnsubscribe: vi.fn(),
  useRealSurface: false,
  layout: {
    clear: vi.fn(),
    clearAll: vi.fn(),
    init: vi.fn(),
    layout: vi.fn(),
    updateViewPort: vi.fn(),
    getElementById: vi.fn((id: string) => mocks.elements.get(id) ?? null),
    getElementViewportRect: vi.fn(() => ({ left: 0, top: 0, width: 368, height: 520 })),
  },
  buildScreen: vi.fn((_id: unknown, _context: unknown): ScreenModel => ({ id: "home", title: "home" })),
  renderScene: vi.fn((_model: unknown, _options: Record<string, unknown>) => ({ template: "<view></view>", styles: {} })),
}));

vi.mock("./layoutEngine", () => ({ default: mocks.layout }));
vi.mock("./rendering/fitImage", () => ({ registerFitImage: vi.fn() }));
vi.mock("./rendering/rendererRegistry", () => ({ renderScene: mocks.renderScene }));
vi.mock("./sceneRegistry", () => ({
  deriveScreen: vi.fn(() => "home"),
  buildScreen: mocks.buildScreen,
}));
vi.mock("./cardTableSurface", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cardTableSurface")>();
  return { CardTableSurface: class CardTableSurfaceMock {
    readonly element: HTMLCanvasElement;
    readonly update: ReturnType<typeof vi.fn>;
    readonly cardAt: ReturnType<typeof vi.fn>;
    private readonly real: InstanceType<typeof actual.CardTableSurface> | null;

    constructor(
      createCanvas: () => HTMLCanvasElement,
      createImage: (() => HTMLImageElement) | undefined,
      state: Record<string, unknown>,
    ) {
      mocks.surfaceState = state;
      if (mocks.useRealSurface) {
        this.real = new actual.CardTableSurface(createCanvas, createImage, state as never);
        this.element = this.real.element;
        this.update = vi.fn((next: Record<string, unknown>) => {
          mocks.surfaceState = next;
          this.real?.update(next as never);
        });
        this.cardAt = vi.fn((x: number, y: number) => this.real?.cardAt(x, y) ?? null);
      } else {
        this.real = null;
        this.element = { width: 1, height: 1 } as HTMLCanvasElement;
        this.update = vi.fn((next: Record<string, unknown>) => { mocks.surfaceState = next; });
        this.cardAt = vi.fn(() => null);
      }
    }

    subscribeInvalidation(listener: () => void): () => void {
      if (this.real) return this.real.subscribeInvalidation(listener);
      mocks.invalidation = listener;
      return mocks.surfaceUnsubscribe;
    }
  } };
});

import { ScreenHost } from "./screenHost";

describe("ScreenHost display and table lifecycle", () => {
  beforeEach(() => {
    mocks.elements.clear();
    mocks.invalidation = null;
    mocks.surfaceState = null;
    mocks.useRealSurface = false;
    mocks.surfaceUnsubscribe.mockReset();
    for (const method of Object.values(mocks.layout)) {
      if (typeof method === "function" && "mockClear" in method) method.mockClear();
    }
    mocks.layout.getElementById.mockImplementation((id: string) => mocks.elements.get(id) ?? null);
    mocks.buildScreen.mockReset();
    mocks.buildScreen.mockReturnValue({ id: "home", title: "home" });
    mocks.renderScene.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rolls back a failed initial start and remains retryable without duplicate resources", () => {
    vi.useFakeTimers();
    const listeners: {
      windowResize?: Parameters<NonNullable<WxLike["onWindowResize"]>>[0];
      orientationChange?: Parameters<NonNullable<WxLike["onDeviceOrientationChange"]>>[0];
    } = {};
    const onWindowResize = vi.fn((listener: Parameters<NonNullable<WxLike["onWindowResize"]>>[0]) => { listeners.windowResize = listener; });
    const offWindowResize = vi.fn();
    const onDeviceOrientationChange = vi.fn((listener: Parameters<NonNullable<WxLike["onDeviceOrientationChange"]>>[0]) => { listeners.orientationChange = listener; });
    const offDeviceOrientationChange = vi.fn();
    const keyboard = { close: vi.fn() };
    const session = homeSession();
    const host = new ScreenHost(options({
      keyboard,
      session,
      wx: wxLike(() => info(390, 844, 3), { onWindowResize, offWindowResize, onDeviceOrientationChange, offDeviceOrientationChange }),
    }));
    mocks.renderScene.mockImplementationOnce(() => { throw new Error("INITIAL_RENDER_FAILED"); });

    expect(() => host.start()).toThrow("INITIAL_RENDER_FAILED");
    expect(offWindowResize).toHaveBeenCalledWith(listeners.windowResize);
    expect(offDeviceOrientationChange).toHaveBeenCalledWith(listeners.orientationChange);
    expect(session.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    expect(() => host.start()).not.toThrow();
    host.start();
    expect(onWindowResize).toHaveBeenCalledTimes(2);
    expect(onDeviceOrientationChange).toHaveBeenCalledTimes(2);
    expect(session.subscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    host.dispose();
    host.dispose();
    expect(session.unsubscribe).toHaveBeenCalledTimes(2);
    expect(keyboard.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unbinds display listeners when the session subscription fails and can retry", () => {
    vi.useFakeTimers();
    const listeners: { windowResize?: Parameters<NonNullable<WxLike["onWindowResize"]>>[0] } = {};
    const onWindowResize = vi.fn((listener: Parameters<NonNullable<WxLike["onWindowResize"]>>[0]) => { listeners.windowResize = listener; });
    const offWindowResize = vi.fn();
    const session = homeSession();
    vi.mocked(session.subscribe).mockImplementationOnce(() => { throw new Error("SUBSCRIBE_FAILED"); });
    const host = new ScreenHost(options({
      session,
      wx: wxLike(() => info(390, 844, 3), { onWindowResize, offWindowResize }),
    }));

    expect(() => host.start()).toThrow("SUBSCRIBE_FAILED");
    expect(offWindowResize).toHaveBeenCalledWith(listeners.windowResize);
    expect(vi.getTimerCount()).toBe(0);

    expect(() => host.start()).not.toThrow();
    expect(session.subscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    host.dispose();
  });

  it("unsubscribes the session and display listeners when timer creation fails", () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "setInterval").mockImplementationOnce(() => { throw new Error("TIMER_FAILED"); });
    const listeners: { windowResize?: Parameters<NonNullable<WxLike["onWindowResize"]>>[0] } = {};
    const onWindowResize = vi.fn((listener: Parameters<NonNullable<WxLike["onWindowResize"]>>[0]) => { listeners.windowResize = listener; });
    const offWindowResize = vi.fn();
    const session = homeSession();
    const host = new ScreenHost(options({
      session,
      wx: wxLike(() => info(390, 844, 3), { onWindowResize, offWindowResize }),
    }));

    expect(() => host.start()).toThrow("TIMER_FAILED");
    expect(session.unsubscribe).toHaveBeenCalledTimes(1);
    expect(offWindowResize).toHaveBeenCalledWith(listeners.windowResize);
    expect(vi.getTimerCount()).toBe(0);

    expect(() => host.start()).not.toThrow();
    expect(session.subscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    host.dispose();
  });

  it("recomputes canvas and layout metrics for window/orientation changes and unbinds on dispose", () => {
    let systemInfo = info(390, 844, 3);
    const listeners: {
      windowResize?: Parameters<NonNullable<WxLike["onWindowResize"]>>[0];
      orientationChange?: Parameters<NonNullable<WxLike["onDeviceOrientationChange"]>>[0];
    } = {};
    const onWindowResize = vi.fn((listener: Parameters<NonNullable<WxLike["onWindowResize"]>>[0]) => { listeners.windowResize = listener; });
    const offWindowResize = vi.fn();
    const onDeviceOrientationChange = vi.fn((listener: Parameters<NonNullable<WxLike["onDeviceOrientationChange"]>>[0]) => { listeners.orientationChange = listener; });
    const offDeviceOrientationChange = vi.fn();
    const canvas = displayCanvas();
    const keyboard = { close: vi.fn() };
    const session = homeSession();
    const host = new ScreenHost(options({
      canvas,
      keyboard,
      session,
      wx: wxLike(() => systemInfo, { onWindowResize, offWindowResize, onDeviceOrientationChange, offDeviceOrientationChange }),
    }));

    host.start();
    expect(onWindowResize).toHaveBeenCalledTimes(1);
    expect(onDeviceOrientationChange).toHaveBeenCalledTimes(1);

    systemInfo = info(844, 390, 2);
    listeners.windowResize?.({ size: { windowWidth: 844, windowHeight: 390 } });
    expect(canvas.width).toBe(1688);
    expect(canvas.height).toBe(780);
    expect(canvas.style.width).toBe("844px");
    expect(canvas.style.height).toBe("390px");
    expect(mocks.layout.updateViewPort).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 844, height: 390 });

    systemInfo = info(389, 584, 3);
    listeners.orientationChange?.({ value: "portrait" });
    expect(canvas.width).toBe(1167);
    expect(canvas.height).toBe(1752);
    expect(mocks.layout.updateViewPort).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 389, height: 584 });

    host.dispose();
    expect(offWindowResize).toHaveBeenCalledWith(listeners.windowResize);
    expect(offDeviceOrientationChange).toHaveBeenCalledWith(listeners.orientationChange);
    expect(session.unsubscribe).toHaveBeenCalledTimes(1);
    expect(keyboard.close).toHaveBeenCalledTimes(1);

    systemInfo = info(320, 480, 2);
    listeners.windowResize?.({ size: { windowWidth: 320, windowHeight: 480 } });
    expect(canvas.width).toBe(1167);
    expect(canvas.height).toBe(1752);
  });

  it("prefers direct resize-event dimensions while supplementing DPR and safe area from system info", () => {
    let systemInfo = info(390, 844, 3);
    const listeners: { windowResize?: Parameters<NonNullable<WxLike["onWindowResize"]>>[0] } = {};
    const canvas = displayCanvas();
    const host = new ScreenHost(options({
      canvas,
      wx: wxLike(() => systemInfo, {
        onWindowResize: vi.fn((listener: Parameters<NonNullable<WxLike["onWindowResize"]>>[0]) => { listeners.windowResize = listener; }),
        offWindowResize: vi.fn(),
      }),
    }));
    host.start();

    systemInfo = {
      ...info(390, 844, 2),
      safeArea: { left: 0, top: 20, right: 358, bottom: 410, width: 358, height: 390 },
      platform: "ios",
    };
    listeners.windowResize?.({ windowWidth: 358, windowHeight: 430 });

    expect(canvas.width).toBe(716);
    expect(canvas.height).toBe(860);
    expect(canvas.style.width).toBe("358px");
    expect(canvas.style.height).toBe("430px");
    expect(mocks.layout.updateViewPort).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 358, height: 430 });
    expect(mocks.renderScene.mock.lastCall?.[1]).toMatchObject({
      safeTop: 20 / (358 / 390),
      safeBottom: 20 / (358 / 390),
    });
    host.dispose();
  });

  it.each([
    ["empty", () => ({}) as ReturnType<WxLike["getSystemInfoSync"]>],
    ["throwing", () => { throw new Error("SYSTEM_INFO_UNAVAILABLE"); }],
  ])("keeps valid resize-event dimensions when the system snapshot is %s", (_kind, unavailableInfo) => {
    let resized = false;
    const listeners: { windowResize?: Parameters<NonNullable<WxLike["onWindowResize"]>>[0] } = {};
    const canvas = displayCanvas();
    const host = new ScreenHost(options({
      canvas,
      wx: wxLike(() => resized ? unavailableInfo() : info(390, 844, 3), {
        onWindowResize: vi.fn((listener: Parameters<NonNullable<WxLike["onWindowResize"]>>[0]) => { listeners.windowResize = listener; }),
        offWindowResize: vi.fn(),
      }),
    }));
    host.start();

    resized = true;
    listeners.windowResize?.({ windowWidth: 368, windowHeight: 520 });

    expect(canvas.width).toBe(1104);
    expect(canvas.height).toBe(1560);
    expect(canvas.style.width).toBe("368px");
    expect(canvas.style.height).toBe("520px");
    expect(mocks.layout.updateViewPort).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 368, height: 520 });
    host.dispose();
  });

  it("loads only the packaged TTF display font", () => {
    const loadFont = vi.fn(() => "ZCOOL Kuaile");
    const host = new ScreenHost(options({
      wx: wxLike(() => info(390, 844, 3), { loadFont }),
    }));

    expect(loadFont).toHaveBeenCalledOnce();
    expect(loadFont).toHaveBeenCalledWith("assets/fonts/zcool-kuaile-minigame-subset.ttf");
    host.dispose();
  });

  it("recomposites the real table surface when a placeholder image becomes ready", () => {
    mocks.useRealSurface = true;
    const surfaceCanvas = recordingCanvas();
    const images: HTMLImageElement[] = [];
    const compositeFrames: number[] = [];
    const component = {
      layoutBox: { width: 368, height: 512 },
      canvas: null as HTMLCanvasElement | null,
      update: vi.fn(() => {
        compositeFrames.push(vi.mocked(surfaceCanvas.context.drawImage).mock.calls.length);
      }),
      on: vi.fn(),
    };
    mocks.elements.set("tableCanvas", component);
    mocks.buildScreen.mockReturnValue({
      id: "game",
      title: "game",
      table: {
        turn: 1,
        direction: "clockwise",
        deckCount: 18,
        hand: [],
        players: [],
        myTurn: true,
        turnsOwed: 1,
      },
    });
    const host = new ScreenHost(options({
      wx: wxLike(() => info(390, 844, 3), {
        createCanvas: vi.fn(() => surfaceCanvas.canvas),
        createImage: vi.fn(() => {
          const image = pendingImage();
          images.push(image);
          return image;
        }),
      }),
    }));

    host.start();
    expect(images).toHaveLength(2);
    expect(compositeFrames).toEqual([0]);

    markImageReady(images[0]!);
    fireImageLoad(images[0]!);
    expect(compositeFrames).toHaveLength(2);
    expect(compositeFrames[1]).toBeGreaterThan(0);

    host.dispose();
    markImageReady(images[1]!);
    fireImageLoad(images[1]!);
    expect(compositeFrames).toHaveLength(2);
  });

  it("uses the 368px production layout box and composites late image loads without another state tick", () => {
    const update = vi.fn();
    const component = {
      layoutBox: { width: 368, height: 512 },
      canvas: null as HTMLCanvasElement | null,
      update,
      on: vi.fn(),
    };
    mocks.elements.set("tableCanvas", component);
    const host = new ScreenHost(options({ wx: wxLike(() => info(390, 844, 3)) }));
    const model: ScreenModel = {
      id: "game",
      title: "game",
      table: {
        turn: 1,
        direction: "clockwise",
        deckCount: 18,
        hand: [],
        players: [],
        myTurn: true,
        turnsOwed: 1,
      },
    };

    (host as unknown as { attachTable(value: ScreenModel, view: unknown): void })
      .attachTable(model, { game: { deadline: 0 } });

    expect(mocks.surfaceState).toMatchObject({ width: 368, height: 512, renderScale: 3 });
    expect(update).toHaveBeenCalledTimes(1);
    update.mockClear();

    mocks.invalidation?.();
    expect(update).toHaveBeenCalledTimes(1);

    host.dispose();
    expect(mocks.surfaceUnsubscribe).toHaveBeenCalledTimes(1);
    update.mockClear();
    mocks.invalidation?.();
    expect(update).not.toHaveBeenCalled();
  });

  it("never collapses an invalid layout box to 1px and resumes live dimensions when layout recovers", () => {
    const component = {
      layoutBox: { width: 0, height: Number.NaN },
      canvas: null as HTMLCanvasElement | null,
      update: vi.fn(),
      on: vi.fn(),
    };
    mocks.elements.set("tableCanvas", component);
    const host = new ScreenHost(options({ wx: wxLike(() => info(390, 844, 3)) }));
    const model: ScreenModel = {
      id: "game",
      title: "game",
      table: {
        turn: 1,
        direction: "clockwise",
        deckCount: 18,
        hand: [],
        players: [],
        myTurn: true,
        turnsOwed: 1,
      },
    };
    const attach = () => (host as unknown as { attachTable(value: ScreenModel, view: unknown): void })
      .attachTable(model, { game: { deadline: 0 } });

    attach();
    expect(mocks.surfaceState).toMatchObject({ width: 368, height: 520 });
    expect(mocks.surfaceState).not.toMatchObject({ width: 1 });
    expect(mocks.surfaceState).not.toMatchObject({ height: 1 });

    component.layoutBox.width = 374;
    component.layoutBox.height = -8;
    attach();
    expect(mocks.surfaceState).toMatchObject({ width: 374, height: 520 });

    component.layoutBox.width = -12;
    component.layoutBox.height = 532;
    attach();
    expect(mocks.surfaceState).toMatchObject({ width: 374, height: 532 });

    component.layoutBox.width = 376;
    component.layoutBox.height = 540;
    attach();
    expect(mocks.surfaceState).toMatchObject({ width: 376, height: 540 });

    host.dispose();
  });

  it("steps a defuse insertion toward either deck edge and wraps across all 19 positions", () => {
    const previous = clickableElement();
    const next = clickableElement();
    mocks.elements.set("action-0", previous.element);
    mocks.elements.set("action-1", next.element);
    mocks.buildScreen.mockReturnValue({
      id: "defuse",
      title: "选择放回位置",
      actions: [
        { id: "position-prev", label: "向牌堆顶一格", intent: { type: "CycleInsertionPosition", delta: -1 } },
        { id: "position-next", label: "向牌堆底一格", intent: { type: "CycleInsertionPosition", delta: 1 } },
      ],
    });
    const host = new ScreenHost(options({
      session: homeSession({
        phase: "MATCH",
        viewerId: "you",
        matchId: "match-1",
        pending: { kind: "DEFUSE_INSERTION", id: "prompt-1", promptId: "prompt-1", deckSize: 18 },
      }),
    }));
    const insertionPosition = () => Number((mocks.buildScreen.mock.lastCall?.[1] as { insertionPosition?: number })?.insertionPosition);

    host.start();
    expect(insertionPosition()).toBe(0);

    previous.click();
    expect(insertionPosition()).toBe(18);
    next.click();
    expect(insertionPosition()).toBe(0);

    for (let step = 0; step < 9; step += 1) next.click();
    expect(insertionPosition()).toBe(9);
    previous.click();
    expect(insertionPosition()).toBe(8);
    next.click();
    expect(insertionPosition()).toBe(9);

    host.dispose();
  });

  it("sends exactly one PassResponse command for one explicit pass action click", async () => {
    const pass = clickableElement();
    mocks.elements.set("action-0", pass.element);
    mocks.buildScreen.mockReturnValue({
      id: "response",
      title: "有人要否决吗？",
      actions: [{ id: "pass", label: "放行 / 关闭", intent: { type: "PassResponse", windowId: "window-1" } }],
    });
    const send = vi.fn(async () => ({ ok: true }));
    const session = homeSession({
      phase: "MATCH",
      viewerId: "you",
      matchId: "match-1",
      pending: { kind: "RESPONSE", id: "window-1", windowId: "window-1" },
      legalActions: [{ type: "PassResponse", windowId: "window-1" }],
    }, send);
    const host = new ScreenHost(options({ session }));

    host.start();
    pass.click();

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({ type: "PassResponse", windowId: "window-1" });
    host.dispose();
  });
});

function options(overrides: Record<string, unknown> = {}): ConstructorParameters<typeof ScreenHost>[0] {
  return {
    wx: wxLike(() => info(390, 844, 3)),
    session: homeSession(),
    keyboard: { close: vi.fn() },
    media: {
      play: vi.fn(),
      impact: vi.fn(),
      getSnapshot: vi.fn(() => ({ sound: true, vibration: true })),
    },
    share: { room: vi.fn(), copy: vi.fn() },
    canvas: displayCanvas(),
    ...overrides,
  } as unknown as ConstructorParameters<typeof ScreenHost>[0];
}

function wxLike(
  getInfo: () => ReturnType<WxLike["getSystemInfoSync"]>,
  overrides: Partial<WxLike> = {},
): WxLike {
  return {
    getSystemInfoSync: getInfo,
    getLaunchOptionsSync: vi.fn(() => ({ query: {} })),
    createCanvas: vi.fn(() => displayCanvas()),
    hideKeyboard: vi.fn(),
    ...overrides,
  } as unknown as WxLike;
}

function homeSession(
  view: RawProductView = { phase: "HOME", viewerId: "you" },
  send: ReturnType<typeof vi.fn> = vi.fn(async () => ({ ok: true })),
): GameSession<RawProductView> & {
  unsubscribe: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const unsubscribe = vi.fn();
  return {
    unsubscribe,
    getSnapshot: vi.fn(() => ({
      lifecycle: "CONNECTED",
      connectivity: "online",
      revision: 1,
      view,
    })),
    subscribe: vi.fn(() => unsubscribe),
    send,
    dispose: vi.fn(),
  } as unknown as GameSession<RawProductView> & {
    unsubscribe: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

function clickableElement(): Readonly<{ element: unknown; click(): void }> {
  let listener: (() => void) | undefined;
  const element = {
    children: [],
    on: vi.fn((event: string, next: () => void) => {
      if (event === "click") listener = next;
    }),
  };
  return {
    element,
    click() {
      expect(listener, "click listener").toBeDefined();
      listener?.();
    },
  };
}

function displayCanvas(): HTMLCanvasElement {
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
}

function recordingCanvas(): Readonly<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> {
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
    drawImage: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
  };
  const context = new Proxy(target, {
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
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

function pendingImage(): HTMLImageElement {
  return {
    width: 0,
    height: 0,
    naturalWidth: 0,
    naturalHeight: 0,
    onload: null,
    src: "",
  } as unknown as HTMLImageElement;
}

function markImageReady(image: HTMLImageElement): void {
  Object.assign(image, { width: 220, height: 396, naturalWidth: 220, naturalHeight: 396 });
}

function fireImageLoad(image: HTMLImageElement): void {
  if (typeof image.onload === "function") image.onload.call(image, {} as Event);
}

function info(windowWidth: number, windowHeight: number, pixelRatio: number): ReturnType<WxLike["getSystemInfoSync"]> {
  return { windowWidth, windowHeight, pixelRatio };
}
