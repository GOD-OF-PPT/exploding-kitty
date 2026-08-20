import { describe, expect, it } from "vitest";
import { drawHardBorderShadow, installHardBorderShadow } from "./hardBorderShadow";

type Event = readonly [name: string, ...values: unknown[]];

describe("hard border shadow adapter", () => {
  it("draws only the exposed right and bottom strips with the expected offset", () => {
    const { ctx, events, state } = context();
    state.fillStyle = "before";

    drawHardBorderShadow(ctx, {
      borderWidth: 3,
      borderRightWidth: 7,
      borderBottomWidth: 8,
      borderColor: "#171512",
    }, { absoluteX: 10, absoluteY: 20, width: 100, height: 50 }, 2, 3);

    expect(events.filter(([name]) => name === "fillRect")).toEqual([
      ["fillRect", 108, 22, 4, 45, "#171512"],
      ["fillRect", 12, 67, 100, 5, "#171512"],
    ]);
    expect(events.map(([name]) => name)).toEqual(["save", "fillRect", "fillRect", "restore", "beginPath"]);
    expect(state.fillStyle).toBe("before");
  });

  it("does not draw when per-side widths add no visible shadow", () => {
    const { ctx, events } = context();
    drawHardBorderShadow(ctx, {
      borderWidth: 4,
      borderRightWidth: 4,
      borderBottomWidth: 2,
    }, { absoluteX: 0, absoluteY: 0, width: 20, height: 20 });
    expect(events).toEqual([]);
  });

  it("inherits the engine transform and paints once when an image asks for its border twice", () => {
    const { ctx, events } = context();

    class FakeElement {
      style = { borderWidth: 3, borderRightWidth: 7, borderBottomWidth: 7, borderColor: "black" };
      layoutBox = { absoluteX: 50, absoluteY: 60, width: 80, height: 40 };

      baseRender(): { needClip: boolean; needStroke: boolean } {
        ctx.translate(90, 80);
        events.push(["translate"]);
        ctx.rotate(0.1);
        events.push(["rotate"]);
        ctx.scale(0.97, 0.97);
        events.push(["scale"]);
        return this.renderBorder(ctx, 90, 80);
      }

      renderBorder(
        _context?: CanvasRenderingContext2D,
        _originX?: number,
        _originY?: number,
      ): { needClip: boolean; needStroke: boolean } {
        events.push(["originalBorder"]);
        return { needClip: false, needStroke: true };
      }

      renderLikeImage(): void {
        this.baseRender();
        events.push(["drawImage"]);
        this.renderBorder(ctx, 90, 80);
      }
    }

    installHardBorderShadow({ Element: FakeElement });
    installHardBorderShadow({ Element: FakeElement });
    new FakeElement().renderLikeImage();

    const names = events.map(([name]) => name);
    expect(names.indexOf("scale")).toBeLessThan(names.indexOf("fillRect"));
    expect(names.filter((name) => name === "fillRect")).toHaveLength(2);
    expect(names.filter((name) => name === "originalBorder")).toHaveLength(2);
    expect(names.indexOf("drawImage")).toBeGreaterThan(names.indexOf("fillRect"));
  });

  it("cleans up adapter and canvas state when baseRender throws", () => {
    const { ctx, events, state } = context();
    state.fillStyle = "before";

    class ThrowingElement {
      style = { borderWidth: 2, borderRightWidth: 6, borderBottomWidth: 6, borderColor: "black" };
      layoutBox = { absoluteX: 0, absoluteY: 0, width: 20, height: 20 };

      baseRender(): never {
        this.renderBorder(ctx);
        throw new Error("render failed");
      }

      renderBorder(
        _context?: CanvasRenderingContext2D,
        _originX?: number,
        _originY?: number,
      ): { needClip: boolean; needStroke: boolean } {
        events.push(["originalBorder"]);
        return { needClip: false, needStroke: false };
      }
    }

    installHardBorderShadow({ Element: ThrowingElement });
    const element = new ThrowingElement();
    expect(() => element.baseRender()).toThrow("render failed");
    const fillsAfterFailure = events.filter(([name]) => name === "fillRect").length;
    element.renderBorder(ctx);

    expect(events.filter(([name]) => name === "fillRect")).toHaveLength(fillsAfterFailure);
    expect(events.filter(([name]) => name === "save")).toHaveLength(1);
    expect(events.filter(([name]) => name === "restore")).toHaveLength(1);
    expect(state.fillStyle).toBe("before");
  });
});

function context(): {
  ctx: CanvasRenderingContext2D;
  events: Event[];
  state: { fillStyle: string | CanvasGradient | CanvasPattern };
} {
  const events: Event[] = [];
  const state: { fillStyle: string | CanvasGradient | CanvasPattern } = { fillStyle: "initial" };
  const stack: Array<typeof state.fillStyle> = [];
  const target = {
    get fillStyle() { return state.fillStyle; },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) { state.fillStyle = value; },
    save() { stack.push(state.fillStyle); events.push(["save"]); },
    restore() { state.fillStyle = stack.pop() ?? state.fillStyle; events.push(["restore"]); },
    beginPath() { events.push(["beginPath"]); },
    fillRect(x: number, y: number, width: number, height: number) {
      events.push(["fillRect", x, y, width, height, state.fillStyle]);
    },
    translate() { /* ordering is recorded by the fake engine */ },
    rotate() { /* ordering is recorded by the fake engine */ },
    scale() { /* ordering is recorded by the fake engine */ },
  };
  return { ctx: target as unknown as CanvasRenderingContext2D, events, state };
}
