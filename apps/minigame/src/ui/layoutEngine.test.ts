import { describe, expect, it, vi } from "vitest";

type FakeNode = {
  parent: FakeNode | null;
  emit: ReturnType<typeof vi.fn>;
};

describe("layout engine adapter", () => {
  it("bubbles touch phases through visual ancestors but leaves synthetic clicks alone", async () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { installTouchBubbling } = await import("./layoutEngine");
    const root: FakeNode = { parent: null, emit: vi.fn() };
    const scroll: FakeNode = { parent: root, emit: vi.fn() };
    const button: FakeNode = { parent: scroll, emit: vi.fn() };
    const label: FakeNode = { parent: button, emit: vi.fn() };
    const fake = Object.assign(root, {
      eventHandler: (eventName: string) => (event: unknown) => label.emit(eventName, event),
      getChildByPos: (_tree: FakeNode, _x: number, _y: number, list: FakeNode[]) => list.push(root, scroll, button, label),
      eventHandlerData: {
        hasEventBind: false,
        handlers: {
          touchStart: vi.fn(),
          touchMove: vi.fn(),
          touchEnd: vi.fn(),
          touchCancel: vi.fn(),
        },
      },
      bindEvents: vi.fn(),
      unBindEvents: vi.fn(),
    });

    installTouchBubbling(fake as unknown as Parameters<typeof installTouchBubbling>[0]);
    installTouchBubbling(fake as unknown as Parameters<typeof installTouchBubbling>[0]);
    const event = { pageX: 20, pageY: 30 };
    fake.eventHandlerData.handlers.touchMove(event);

    expect(label.emit).toHaveBeenCalledTimes(1);
    expect(button.emit).toHaveBeenCalledWith("touchmove", event);
    expect(scroll.emit).toHaveBeenCalledWith("touchmove", event);
    expect(root.emit).toHaveBeenCalledWith("touchmove", event);

    label.emit.mockClear(); button.emit.mockClear(); scroll.emit.mockClear(); root.emit.mockClear();
    fake.eventHandler("click")(event);
    expect(label.emit).toHaveBeenCalledWith("click", event);
    expect(button.emit).not.toHaveBeenCalled();
    expect(scroll.emit).not.toHaveBeenCalled();
    expect(root.emit).not.toHaveBeenCalled();
  });
});
