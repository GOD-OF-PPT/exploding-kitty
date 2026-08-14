import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScreenAction, ScreenModel, ScreenRow } from "../model";
import { renderScene } from "./rendererRegistry";
import type { RenderSceneOptions } from "./types";

type LayoutEngine = typeof import("../layoutEngine")["default"];
type LayoutElement = NonNullable<ReturnType<LayoutEngine["getElementById"]>>;
type ScrollElement = LayoutElement & Readonly<{ scrollHeight: number }>;

const WIDTH = 390;
const HEIGHT = 585;
const OPTIONS: RenderSceneOptions = {
  height: HEIGHT,
  safeTop: 24,
  safeBottom: 0,
  capsule: null,
  canGoBack: true,
  selectedTokens: [],
  error: null,
  viewerId: "viewer",
};

let Layout: LayoutEngine;

beforeAll(async () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createElement: vi.fn((tagName: string) => tagName === "canvas"
      ? {
          width: 1,
          height: 1,
          getContext: () => ({
            font: "",
            measureText: (value: string) => ({ width: [...String(value)].length * 10 }),
          }),
        }
      : {}),
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    Layout = (await import("../layoutEngine")).default;
  } finally {
    log.mockRestore();
  }
});

afterEach(() => {
  Layout.clear();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("real short-screen layout", () => {
  it.each([
    {
      name: "rules",
      model: screen("rules", rows(12, true)),
    },
    {
      name: "history",
      model: screen("history", rows(20)),
    },
    {
      name: "card-detail",
      model: screen("card-detail", rows(5)),
    },
  ])("constrains the $name content to a genuinely scrollable viewport", ({ model }) => {
    layout(model);
    const scroll = firstByClass("scrollBody") as ScrollElement;
    const dock = firstByClass("actionDock");

    expect(scroll.layoutBox.top).toBe(78);
    expect(scroll.type).toBe("ScrollView");
    expect((scroll as unknown as { scrollY: boolean }).scrollY).toBe(true);
    expect(scroll.layoutBox.height).toBeGreaterThan(0);
    expect(bottom(scroll)).toBeLessThanOrEqual(dock.layoutBox.absoluteY);
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.layoutBox.height);
    expect(bottom(dock)).toBeLessThanOrEqual(HEIGHT);
  });

  it("keeps all four home actions inside the 390 x 585 canvas", () => {
    layout({
      id: "home",
      title: "home",
      rows: [{ id: "settings", title: "settings" }],
      actions: [
        action("play"),
        action("join", "cream"),
        action("tutorial", "cyan"),
        action("rules", "cream"),
      ],
    });

    const actions = [0, 1, 2, 3].map((index) => elementById(`action-${index}`));
    for (const control of actions) {
      expect.soft(control.layoutBox.absoluteY).toBeGreaterThanOrEqual(0);
      expect.soft(bottom(control)).toBeLessThanOrEqual(HEIGHT);
    }
    expect(bottom(firstByClass("actionDock"))).toBeLessThanOrEqual(HEIGHT);
  });

  it("keeps the network action inside the 390 x 585 canvas", () => {
    layout({
      id: "network",
      title: "network",
      heroLabel: "ONLINE",
      rows: rows(2),
      actions: [action("back", "cream")],
    });

    const body = firstByClass("networkBody");
    const dock = firstByClass("actionDock");
    const control = elementById("action-0");
    expect(bottom(body)).toBeLessThanOrEqual(dock.layoutBox.absoluteY);
    expect(bottom(control)).toBeLessThanOrEqual(HEIGHT);
    expect(bottom(dock)).toBe(HEIGHT);
  });

  it("keeps the table canvas clear of a wrapped fixed CTA", () => {
    layout({
      id: "game",
      title: "game",
      actions: [
        action("draw"),
        action("play", "cyan"),
        action("menu", "ink"),
      ],
      table: {
        turn: 1,
        direction: "clockwise",
        deckCount: 20,
        hand: [],
        players: [],
        myTurn: true,
        turnsOwed: 1,
      },
    });

    const canvas = elementById("tableCanvas");
    const dock = firstByClass("actionDockTable");
    const actions = [0, 1, 2].map((index) => elementById(`action-${index}`));
    expect(bottom(canvas)).toBeLessThanOrEqual(dock.layoutBox.absoluteY);
    for (const control of actions) expect.soft(bottom(control)).toBeLessThanOrEqual(HEIGHT);
  });

  it("keeps the response sheet and its two fixed actions disjoint", () => {
    layout({
      id: "response",
      title: "response",
      subtitle: "response detail",
      actions: [action("nope", "red"), action("pass", "cream")],
    });

    const sheet = firstByClass("responseSheet");
    const dock = firstByClass("actionDockLinks");
    expect(bottom(sheet) + 8).toBeLessThanOrEqual(dock.layoutBox.absoluteY);
    for (const index of [0, 1]) expect.soft(bottom(elementById(`action-${index}`))).toBeLessThanOrEqual(HEIGHT);
  });

  it.each([
    { name: "390 x 585", options: OPTIONS },
    {
      name: "390 x 844",
      options: { ...OPTIONS, height: 844, safeTop: 47, safeBottom: 34 },
    },
  ])("keeps response actions clear of title and countdown at $name", ({ options }) => {
    layout({
      id: "response",
      title: "要取消这次行动吗？",
      subtitle: "一名玩家打出了攻击牌，目标是你。再次否决会让原动作重新生效。",
      actions: [action("nope", "red"), action("pass", "cream")],
    }, options);

    const protectedContent = [firstByClass("responseTitle"), firstByClass("countdown")];
    const controls = [elementById("action-0"), elementById("action-1")];
    for (const content of protectedContent) {
      for (const control of controls) expect.soft(overlaps(content, control)).toBe(false);
    }
    for (const control of controls) expect.soft(bottom(control)).toBeLessThanOrEqual(options.height);
    expect(bottom(firstByClass("actionDockLinks"))).toBe(options.height);
  });

  it.each([
    { name: "390 x 585", options: OPTIONS },
    {
      name: "390 x 844",
      options: { ...OPTIONS, height: 844, safeTop: 47, safeBottom: 34 },
    },
  ])("contains ordered-card images inside their $name rows", ({ options }) => {
    layout({
      id: "future",
      title: "future",
      cards: [0, 1, 2].map((index) => ({
        token: `card-${index}`,
        type: "ATTACK" as const,
        name: `card ${index}`,
        image: `assets/cards/card-${index}.png`,
        playable: false,
        singlePlayable: false,
      })),
      actions: [action("done")],
    }, options);

    const rows = allByClass("cardItemOrdered");
    const images = allByClass("orderedCardImage");
    expect(images).toHaveLength(rows.length);
    rows.forEach((row, index) => {
      const image = images[index]!;
      expect.soft(image.layoutBox.absoluteX).toBeGreaterThanOrEqual(row.layoutBox.absoluteX);
      expect.soft(rightEdge(image)).toBeLessThanOrEqual(rightEdge(row));
      expect.soft(image.layoutBox.absoluteY).toBeGreaterThanOrEqual(row.layoutBox.absoluteY);
      expect.soft(bottom(image)).toBeLessThanOrEqual(bottom(row));
      if (rows[index + 1]) expect.soft(bottom(image)).toBeLessThanOrEqual(rows[index + 1]!.layoutBox.absoluteY);
    });
  });

  it("keeps all four lobby grid actions visible and gives the orphan its own row", () => {
    layout({
      id: "lobby-host",
      eyebrow: "ROOM #123456",
      title: "lobby",
      rows: rows(5),
      actions: [
        action("share"),
        action("bot", "cream"),
        action("start", "cyan"),
        action("leave", "ink"),
      ],
      scroll: true,
    });

    const dock = firstByClass("actionDockGrid");
    const actions = [0, 1, 2, 3].map((index) => elementById(`action-${index}`));
    for (const control of actions) {
      expect.soft(control.layoutBox.absoluteY).toBeGreaterThanOrEqual(dock.layoutBox.absoluteY);
      expect.soft(bottom(control)).toBeLessThanOrEqual(HEIGHT);
    }
    expect(actions[3]!.layoutBox.width).toBe(actions[0]!.layoutBox.width);
    expect(actions[3]!.layoutBox.absoluteY).toBeGreaterThan(actions[2]!.layoutBox.absoluteY);
  });
});

function layout(model: ScreenModel, options: RenderSceneOptions = OPTIONS): void {
  const scene = renderScene(model, options);
  // FitImage and View have identical layout semantics; replacing the tag keeps
  // this regression focused on the real engine's reflow without loading assets.
  const template = scene.template.replace(/<fitimage([^>]*)><\/fitimage>/g, "<view$1></view>");
  Layout.init(template, scene.styles);
  Layout.updateViewPort({ x: 0, y: 0, width: WIDTH, height: options.height });
  Layout.layout(context(options.height));
}

function screen(id: "rules" | "history" | "card-detail", values: readonly ScreenRow[]): ScreenModel {
  return {
    id,
    title: id,
    rows: values,
    actions: [action("back", "cream")],
    scroll: true,
  };
}

function rows(count: number, interactive = false): readonly ScreenRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    title: `row ${index}`,
    detail: `detail ${index}`,
    ...(interactive ? { action: action(`row-${index}`) } : {}),
  }));
}

function action(id: string, tone: ScreenAction["tone"] = "yellow"): ScreenAction {
  return { id, label: id, tone };
}

function elementById(id: string): LayoutElement {
  const element = Layout.getElementById(id);
  if (!element) throw new Error(`missing layout element: ${id}`);
  return element;
}

function firstByClass(className: string): LayoutElement {
  const element = Layout.getElementsByClassName<LayoutElement>(className)[0];
  if (!element) throw new Error(`missing layout class: ${className}`);
  return element;
}

function allByClass(className: string): LayoutElement[] {
  return Layout.getElementsByClassName<LayoutElement>(className).filter((element): element is LayoutElement => Boolean(element));
}

function bottom(element: LayoutElement): number {
  return element.layoutBox.absoluteY + element.layoutBox.height;
}

function rightEdge(element: LayoutElement): number {
  return element.layoutBox.absoluteX + element.layoutBox.width;
}

function overlaps(left: LayoutElement, right: LayoutElement): boolean {
  return left.layoutBox.absoluteX < rightEdge(right)
    && rightEdge(left) > right.layoutBox.absoluteX
    && left.layoutBox.absoluteY < bottom(right)
    && bottom(left) > right.layoutBox.absoluteY;
}

function context(height = HEIGHT): CanvasRenderingContext2D {
  const target = {
    canvas: { width: WIDTH, height },
    measureText: (value: string) => ({ width: [...String(value)].length * 10 }),
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as keyof typeof object];
      return () => undefined;
    },
    set(object, property, value) {
      (object as Record<PropertyKey, unknown>)[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
