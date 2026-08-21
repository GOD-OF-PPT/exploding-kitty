import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SCREEN_FIXTURES } from "../../../visual-preview/src/fixtures";
import { VIEWPORTS, type ViewportProfile } from "../../../visual-preview/src/viewports";
import type { ScreenAction, ScreenModel, ScreenRow } from "../model";
import { renderScene } from "./rendererRegistry";
import type { RenderSceneOptions } from "./types";

type LayoutEngine = typeof import("../layoutEngine")["default"];
type LayoutElement = NonNullable<ReturnType<LayoutEngine["getElementById"]>>;
type ScrollElement = LayoutElement & Readonly<{ scrollHeight: number }>;

const WIDTH = 390;
const HEIGHT = 585;
const FIXTURE_VIEWPORTS = [
  VIEWPORTS["390x844"],
  VIEWPORTS["372x749"],
  VIEWPORTS["389x584"],
] as const;
const FIXTURE_LAYOUT_CASES = [
  {
    id: "login",
    requiredIds: ["action-0"],
    touchIds: ["action-0"],
  },
  {
    id: "play-mode",
    requiredIds: ["back", "row-0", "row-1", "action-0"],
    touchIds: ["back", "row-0", "row-1", "action-0"],
  },
  {
    id: "game-menu",
    requiredIds: ["back", "row-0", "row-1", "row-2", "action-0", "action-1"],
    touchIds: ["back", "row-0", "row-1", "row-2", "action-0", "action-1"],
  },
  {
    id: "settings",
    requiredIds: ["back", "row-0", "row-1", "row-2", "row-3", "row-4", "action-0"],
    touchIds: ["back", "row-0", "row-1", "row-2", "row-3", "action-0"],
  },
  {
    id: "response",
    requiredIds: ["action-0", "action-1"],
    touchIds: ["action-0", "action-1"],
  },
  {
    id: "network",
    requiredIds: ["row-0", "row-1", "row-2", "action-0"],
    touchIds: ["action-0"],
  },
  {
    id: "give-card",
    requiredIds: ["back", "card-0", "card-1", "card-2", "card-3", "action-0"],
    touchIds: ["back", "card-0", "card-1", "card-2", "card-3", "action-0"],
  },
] as const;
const OPTIONS: RenderSceneOptions = {
  height: HEIGHT,
  safeTop: 24,
  safeBottom: 0,
  capsule: null,
  canGoBack: true,
  selectedTokens: [],
  error: null,
  viewerId: "viewer",
  displayFont: "ZCOOL KuaiLe",
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
  it.each(FIXTURE_VIEWPORTS)("keeps fixture interaction targets usable at $key", (viewport) => {
    for (const fixtureCase of FIXTURE_LAYOUT_CASES) {
      const model = SCREEN_FIXTURES[fixtureCase.id];
      const options = fixtureOptions(model, viewport);
      layout(model, options, viewport.width, viewport.height);

      for (const id of fixtureCase.requiredIds) {
        expect.soft(Layout.getElementById(id), `${fixtureCase.id}:${id} exists`).toBeTruthy();
      }
      for (const id of fixtureCase.touchIds) {
        expectTouchTarget(id, `${fixtureCase.id}:${id}`);
      }
      expectFixedActionsInsideCanvas(model, options.height);
    }
  });

  it.each(FIXTURE_VIEWPORTS)("keeps the create artboard controls explicit at $key", (viewport) => {
    const model = SCREEN_FIXTURES.create;
    const options = fixtureOptions(model, viewport);
    layout(model, options, viewport.width, viewport.height);

    expect(firstByClass("createArtboard").layoutBox).toMatchObject({ width: 390, height: 844 });
    for (const id of ["row-0-down", "row-0-up", "row-1-down", "row-1-up", "row-2"]) {
      expectTouchTarget(id, `create:${id}`);
    }
    expect(elementById("row-3")).toBeTruthy();
  });

  it.each(FIXTURE_VIEWPORTS)("keeps fixture content clear of fixed controls at $key", (viewport) => {
    for (const fixtureCase of FIXTURE_LAYOUT_CASES) {
      const model = SCREEN_FIXTURES[fixtureCase.id];
      const options = fixtureOptions(model, viewport);
      layout(model, options, viewport.width, viewport.height);
      const dock = firstByClass("actionDock");

      if (["play-mode", "game-menu", "settings", "give-card"].includes(model.id)) {
        const scroll = firstByClass("scrollBody") as ScrollElement;
        expect.soft(scroll.type, `${model.id}: scrollable body`).toBe("ScrollView");
        expect.soft(scroll.layoutBox.height, `${model.id}: usable scroll viewport`).toBeGreaterThan(0);
        expect.soft(bottom(scroll), `${model.id}: scroll viewport clears dock`)
          .toBeLessThanOrEqual(dock.layoutBox.absoluteY);
      }

      if (model.id === "login") {
        const body = firstByClass("brandBody");
        const burst = firstByClass("loginBurst");
        const legal = firstByClass("loginLegal");
        const primary = elementById("action-0");
        const burstCenter = burst.layoutBox.absoluteX + burst.layoutBox.width / 2;
        const physicalBurstCenter = burstCenter * (viewport.width / WIDTH);
        expect.soft(
          Math.abs(physicalBurstCenter - viewport.width / 2),
          "login: question sticker is horizontally centered within pixel rounding",
        ).toBeLessThanOrEqual(0.5);
        expect.soft(bottom(body), "login: brand content clears dock").toBeLessThanOrEqual(dock.layoutBox.absoluteY);
        expect.soft(overlaps(primary, legal), "login: primary action clears legal copy").toBe(false);
      }

      if (model.id === "game-menu") {
        expect.soft(firstByClass("warningCallout").layoutBox.height, "game-menu: warning remains readable")
          .toBeGreaterThanOrEqual(44);
      }

      if (model.id === "settings") {
        expect(allByClass("settingsToggle"), "settings: two direct switches").toHaveLength(2);
        expect(elementById("row-4"), "settings: fifth version row").toBeTruthy();
      }

      if (model.id === "response") {
        const modal = firstByClass("responseModal");
        const actionDock = firstByClass("responseActions");
        const protectedContent = [firstByClass("responseTitle"), firstByClass("countdown")];
        const controls = [elementById("action-0"), elementById("action-1")];
        expect.soft(bottom(modal), "response: modal clears primary action dock")
          .toBeLessThanOrEqual(actionDock.layoutBox.absoluteY);
        for (const content of protectedContent) {
          for (const control of controls) {
            expect.soft(overlaps(content, control), "response: title/countdown remain unobstructed").toBe(false);
          }
        }
      }

      if (model.id === "network") {
        const body = firstByClass("networkBody") as ScrollElement;
        const recoveryDetail = elementById("row-2");
        const recoveryDetailVisible = bottom(recoveryDetail) <= bottom(body);
        const recoveryDetailScrollable = body.type === "ScrollView" && body.scrollHeight > body.layoutBox.height;
        expect.soft(bottom(body), "network: body clears retry dock").toBeLessThanOrEqual(dock.layoutBox.absoluteY);
        expect.soft(
          recoveryDetailVisible || recoveryDetailScrollable,
          "network: recovery detail is visible or reachable by scrolling before the retry dock",
        ).toBe(true);
      }

      if (model.id === "give-card") {
        const scroll = firstByClass("scrollBody") as ScrollElement;
        const cardItems = allByClass("cardItemGive");
        const cardImages = allByClass("giveCardImage");
        expect.soft(firstByClass("giveRecipient").layoutBox.height, "give-card: recipient bar remains readable")
          .toBeGreaterThanOrEqual(44);
        expect(cardItems, "give-card: all fixture cards remain selectable").toHaveLength(4);
        cardItems.forEach((card, index) => {
          const image = cardImages[index]!;
          expect.soft(card.layoutBox.width / card.layoutBox.height, `give-card:card-${index} 7:10 slot`)
            .toBeCloseTo(0.7, 2);
          expect.soft(image.layoutBox.absoluteX).toBeGreaterThanOrEqual(card.layoutBox.absoluteX);
          expect.soft(rightEdge(image)).toBeLessThanOrEqual(rightEdge(card));
          expect.soft(image.layoutBox.absoluteY).toBeGreaterThanOrEqual(card.layoutBox.absoluteY);
          expect.soft(bottom(image)).toBeLessThanOrEqual(bottom(card));
          expectTouchTarget(`card-${index}`, `give-card:card-${index}`);
        });
        const rows = groupElementsByTop(cardItems);
        expect(rows.map((row) => row.length), "give-card: centered 2 × 2 grid").toEqual([2, 2]);
        for (const row of rows) {
          const rowCenter = (row[0]!.layoutBox.absoluteX + rightEdge(row[1]!)) / 2;
          expect.soft(rowCenter, "give-card: each card row is horizontally centered").toBeCloseTo(WIDTH / 2, 4);
        }
        if (viewport.key === "390x844") {
          for (const card of cardItems) {
            expect.soft(card.layoutBox.absoluteY, "give-card: standard card starts inside viewport")
              .toBeGreaterThanOrEqual(scroll.layoutBox.absoluteY);
            expect.soft(bottom(card), "give-card: standard card is fully visible above CTA")
              .toBeLessThanOrEqual(bottom(scroll));
            expect.soft(overlaps(card, dock), "give-card: standard card clears CTA").toBe(false);
          }
        }
        if (viewport.key === "389x584") {
          expect.soft(scroll.scrollHeight, "give-card: short layout remains scrollable")
            .toBeGreaterThan(scroll.layoutBox.height);
        }
      }
    }
  });

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

  it("keeps the compact result subtitle inside its hero and clear of the first rank", () => {
    const viewport = VIEWPORTS["372x749"];
    const model = SCREEN_FIXTURES.result;
    const options = fixtureOptions(model, viewport);
    layout(model, options, viewport.width, viewport.height);

    const hero = firstByClass("winnerHero");
    const detail = firstByClass("choicePromptDetail");
    const firstRank = elementById("row-0");
    expect.soft(bottom(detail), "winner detail stays inside its reserved hero").toBeLessThanOrEqual(bottom(hero));
    expect.soft(bottom(detail) + 4, "winner detail clears the first ranking card")
      .toBeLessThanOrEqual(firstRank.layoutBox.absoluteY);
  });

  it("keeps every ultra-short result rank fully visible above the fixed actions", () => {
    const viewport = VIEWPORTS["389x584"];
    const model = SCREEN_FIXTURES.result;
    const options = fixtureOptions(model, viewport);
    layout(model, options, viewport.width, viewport.height);

    const dock = firstByClass("actionDock");
    for (const [index] of (model.rows ?? []).entries()) {
      expect.soft(bottom(elementById(`row-${index}`)), `result:row-${index} clears fixed actions`)
        .toBeLessThanOrEqual(dock.layoutBox.absoluteY);
    }
  });

  it("keeps the short rules danger description on one readable line", () => {
    const viewport = VIEWPORTS["389x584"];
    const model = SCREEN_FIXTURES.rules;
    const options = fixtureOptions(model, viewport);
    layout(model, options, viewport.width, viewport.height, 12);

    const dangerDetail = allByClass("rowDetailPaper")[1];
    expect(dangerDetail, "danger row detail exists").toBeDefined();
    expect.soft(dangerDetail!.layoutBox.height, "danger detail has no orphan punctuation line")
      .toBeLessThanOrEqual(22);
    const dangerCaret = allByClass("rowCaret")[1];
    expect.soft(rightEdge(dangerDetail!), "danger detail clears its caret")
      .toBeLessThanOrEqual(dangerCaret!.layoutBox.absoluteX);
    expect.soft(bottom(dangerDetail!), "danger detail remains inside its row")
      .toBeLessThanOrEqual(bottom(elementById("row-1")));
  });

  it("keeps standard rule descriptions free of single-glyph trailing lines", () => {
    const viewport = VIEWPORTS["390x844"];
    const model = SCREEN_FIXTURES.rules;
    const options = fixtureOptions(model, viewport);
    layout(model, options, viewport.width, viewport.height, 12);

    const attackIndex = model.rows?.findIndex((row) => row.id === "attack") ?? -1;
    expect(attackIndex).toBeGreaterThanOrEqual(0);
    expectNoSingleGlyphLastLine(
      model.rows?.[attackIndex]?.detail,
      allByClass("rowDetailPaper")[attackIndex]!,
      12,
      "rules:attack detail has no orphan punctuation",
    );
  });

  it("can scroll the final short rules card fully above the fixed dock", () => {
    const viewport = VIEWPORTS["389x584"];
    const model = SCREEN_FIXTURES.rules;
    const options = fixtureOptions(model, viewport);
    layout(model, options, viewport.width, viewport.height, 12);

    const scroll = firstByClass("scrollBody") as ScrollElement;
    const dock = firstByClass("actionDock");
    const finalRow = elementById(`row-${model.rows!.length - 1}`);
    const maxScrollTop = scroll.scrollHeight - scroll.layoutBox.height;

    expect(maxScrollTop).toBeGreaterThan(0);
    expect(bottom(finalRow) - maxScrollTop).toBeLessThanOrEqual(dock.layoutBox.absoluteY);
  });

  it("collapses the real card-detail summary block when it has no body copy", () => {
    const viewport = VIEWPORTS["390x844"];
    const model = SCREEN_FIXTURES["card-detail"];
    const options = fixtureOptions(model, viewport);
    layout(model, options, viewport.width, viewport.height);

    const detail = firstByClass("detailCopy");
    expect(detail.layoutBox.height).toBeLessThanOrEqual(72);
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
        type: "SEE_FUTURE",
        name: `card ${index}`,
        image: `assets/cards/card-${index}.png`,
        playable: true,
        singlePlayable: true,
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

  it.each([
    {
      name: "favor",
      model: { id: "favor", title: "选择目标玩家", heroImage: "assets/cards/peek.png", actions: [action("done")] },
      className: "choiceHero",
    },
    {
      name: "future",
      model: { id: "future", title: "未来的三张牌", heroImage: "assets/cards/peek.png", actions: [action("done")] },
      className: "choiceHero",
    },
    {
      name: "defuse",
      model: {
        id: "defuse",
        title: "把危险放回哪里？",
        heroImage: "assets/cards/defuse.png",
        rows: [
          { id: "position-prev", title: "向牌堆顶移动一格", action: action("prev") },
          { id: "position-current", title: "当前位置", badge: "第 10 张" },
          { id: "position-next", title: "向牌堆底移动一格", action: action("next") },
        ],
        actions: [action("insert")],
      },
      className: "choiceHero",
    },
    {
      name: "tutorial",
      model: {
        id: "tutorial",
        title: "快速教学",
        heroImage: "assets/cards/skip.png",
        rows: [{ id: "step", title: "先出牌，再抽牌" }],
        actions: [action("next")],
      },
      className: "tutorialImage",
    },
    {
      name: "rules",
      model: {
        id: "rules",
        title: "规则图鉴",
        rows: [{ id: "attack", title: "攻击", image: "assets/cards/attack.png" }],
        actions: [action("back")],
      },
      className: "ruleCardImage",
    },
    {
      name: "card-detail",
      model: { id: "card-detail", title: "攻击", heroImage: "assets/cards/attack.png", actions: [action("back")] },
      className: "detailHero",
    },
    {
      name: "explosion",
      model: { id: "explosion", title: "砰！你抽到了危险", heroImage: "assets/cards/danger.png", actions: [action("defuse")] },
      className: "explosionHero",
    },
  ] satisfies readonly { name: string; model: ScreenModel; className: string }[])(
    "keeps the complete $name card in a short-screen 7:10 frame",
    ({ model, className }) => {
      layout(model);

      const image = firstByClass(className);
      expect.soft(image.layoutBox.width / image.layoutBox.height, `${model.id}: 7:10 art frame`)
        .toBeCloseTo(0.7, 2);
      expect.soft(image.layoutBox.absoluteX).toBeGreaterThanOrEqual(0);
      expect.soft(rightEdge(image)).toBeLessThanOrEqual(WIDTH);
      expectFixedActionsInsideCanvas(model, HEIGHT);
    },
  );

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

  it.each([
    { name: "390 x 585", options: OPTIONS },
    { name: "390 x 844", options: { ...OPTIONS, height: 844, safeTop: 47, safeBottom: 34 } },
  ])("keeps the response table, scrim, modal, close target, and CTA in separate layers at $name", ({ options }) => {
    layout({
      id: "response",
      eyebrow: "否决窗口 · 7 秒",
      title: "要取消这次行动吗？",
      subtitle: "阿橘打出了攻击，目标是你。",
      actions: [action("nope", "red"), action("pass", "cream")],
      table: table(false),
    }, options);

    const context = firstByClass("responseTableContext");
    const scrim = firstByClass("responseBackdropScrim");
    const modal = firstByClass("responseModal");
    const sheet = firstByClass("responseSheet");
    const dock = firstByClass("responseActions");

    expect(context.layoutBox.absoluteY).toBe(options.safeTop);
    expect(bottom(context)).toBe(options.height);
    expect(scrim.layoutBox).toMatchObject({ absoluteX: 0, absoluteY: 0, width: WIDTH, height: options.height });
    expect(bottom(modal) + 8).toBeLessThanOrEqual(dock.layoutBox.absoluteY);
    expect(bottom(elementById("action-0"))).toBeLessThanOrEqual(options.height);
    expect(bottom(elementById("action-1"))).toBeLessThanOrEqual(options.height);
    expect(overlaps(elementById("action-0"), elementById("action-1"))).toBe(false);
  });

  it.each([
    { name: "390 x 585", options: OPTIONS },
    { name: "390 x 844", options: { ...OPTIONS, height: 844, safeTop: 47, safeBottom: 34 } },
  ])("keeps the defuse position selector explicit and touchable at $name", ({ options }) => {
    layout({
      id: "defuse",
      eyebrow: "秘密操作 · 18 秒",
      title: "把危险放回哪里？",
      subtitle: "牌堆当前共 20 张。位置只有你知道。",
      rows: [
        { id: "position-prev", title: "向牌堆顶移动一格", badge: "向顶", action: action("prev") },
        { id: "position-current", title: "当前位置", detail: "第 10 / 21 个可选位置", badge: "第 10 张" },
        { id: "position-next", title: "向牌堆底移动一格", badge: "向底", action: action("next") },
      ],
      actions: [action("insert", "cyan")],
    }, options);

    const selector = firstByClass("defuseSelector");
    const controls = [elementById("row-0"), elementById("row-1"), elementById("row-2")];
    for (const position of controls) {
      expect.soft(position.layoutBox.width).toBeGreaterThanOrEqual(44);
      expect.soft(position.layoutBox.height).toBeGreaterThanOrEqual(44);
      expect.soft(position.layoutBox.absoluteX).toBeGreaterThanOrEqual(selector.layoutBox.absoluteX);
      expect.soft(rightEdge(position)).toBeLessThanOrEqual(rightEdge(selector));
      expect.soft(position.layoutBox.absoluteY).toBeGreaterThanOrEqual(selector.layoutBox.absoluteY);
      expect.soft(bottom(position)).toBeLessThanOrEqual(bottom(selector));
    }
    expect(bottom(elementById("action-0"))).toBeLessThanOrEqual(options.height);
  });

  it("keeps settings switches and navigation rows readable above the tall-screen dock", () => {
    const options = { ...OPTIONS, height: 844, safeTop: 47, safeBottom: 34 };
    layout({
      id: "settings",
      eyebrow: "当前设备",
      title: "设置",
      rows: [
        { id: "sound", title: "音效", detail: "卡牌与危险提示音", badge: "开启", action: action("sound") },
        { id: "vibration", title: "震动反馈", detail: "出牌与危险提示", badge: "关闭", action: action("vibration") },
        { id: "tutorial", title: "重看教学", detail: "回顾基础流程", action: action("tutorial") },
        { id: "rules", title: "规则与版本", detail: "查看当前规则", action: action("rules") },
      ],
      actions: [action("done", "cream")],
    }, options);

    const dock = firstByClass("actionDock");
    const switches = allByClass("settingsToggle");
    expect(switches).toHaveLength(2);
    switches.forEach((toggle) => {
      expect.soft(toggle.layoutBox.width).toBeGreaterThanOrEqual(44);
      expect.soft(toggle.layoutBox.height).toBeGreaterThanOrEqual(44);
    });
    expect(allByClass("settingsToggleKnobOn")).toHaveLength(1);
    for (const index of [0, 1, 2, 3]) {
      const row = elementById(`row-${index}`);
      expect.soft(bottom(row), `row-${index}`).toBeLessThanOrEqual(dock.layoutBox.absoluteY);
    }
    expect(bottom(elementById("action-0"))).toBeLessThanOrEqual(options.height);
  });

  it("keeps the contained eliminated hero clear of the subtitle and contains the placement copy", () => {
    const options = { ...OPTIONS, height: 844, safeTop: 47, safeBottom: 34 };
    layout(SCREEN_FIXTURES.eliminated, options);

    const subtitle = firstByClass("outcomeSubtitle");
    const hero = firstByClass("eliminatedHero");
    expect.soft(hero.layoutBox.absoluteY, "contained cat art clears the full subtitle")
      .toBeGreaterThanOrEqual(bottom(subtitle) + 4);
    expect.soft(hero.layoutBox.absoluteX).toBeGreaterThanOrEqual(0);
    expect.soft(rightEdge(hero)).toBeLessThanOrEqual(WIDTH);

    const card = elementById("row-0");
    const reason = firstByClass("placementReason");
    expect.soft(reason.layoutBox.absoluteY).toBeGreaterThanOrEqual(card.layoutBox.absoluteY);
    expect.soft(bottom(reason)).toBeLessThanOrEqual(bottom(card));
  });

  it.each([
    { name: "390 x 585", options: OPTIONS },
    { name: "390 x 844", options: { ...OPTIONS, height: 844, safeTop: 47, safeBottom: 34 } },
  ])("keeps other-turn context, countdown, and current-player marker unobstructed at $name", ({ options }) => {
    layout({
      id: "other-turn",
      eyebrow: "第 8 回合 · 32 秒",
      title: "等待行动",
      subtitle: "等待阿橘行动",
      actions: [action("history", "cream"), action("menu", "ink")],
      table: table(false),
    }, options);

    const topbar = firstByClass("tableTopbar");
    const timer = firstByClass("tableTurnTimer");
    const marker = firstByClass("tableCurrentMark");
    const count = firstByClass("opponentCount");
    const canvas = elementById("tableCanvas");
    const dock = firstByClass("actionDockTable");

    expect(timer.layoutBox.width).toBeGreaterThanOrEqual(44);
    expect(timer.layoutBox.height).toBeGreaterThanOrEqual(44);
    expect(timer.layoutBox.absoluteY).toBeGreaterThanOrEqual(topbar.layoutBox.absoluteY);
    expect(bottom(timer)).toBeLessThanOrEqual(bottom(topbar));
    expect(overlaps(marker, count)).toBe(false);
    expect(bottom(canvas)).toBeLessThanOrEqual(dock.layoutBox.absoluteY);
    expect(bottom(dock)).toBeLessThanOrEqual(options.height);
  });

  it("keeps the compact attack warning below opponents and away from their counters", () => {
    layout({
      id: "attack",
      eyebrow: "第 8 回合 · 32 秒",
      title: "轮到你了",
      heroLabel: "×3\n欠回合",
      actions: [action("draw"), action("menu", "ink")],
      table: { ...table(true), turnsOwed: 3 },
    });

    const opponents = firstByClass("opponentStrip");
    const warning = firstByClass("debtStamp");
    expect(warning.layoutBox.width).toBeLessThanOrEqual(100);
    expect(warning.layoutBox.absoluteY).toBeGreaterThanOrEqual(bottom(opponents));
    for (const count of allByClass("opponentCount")) expect.soft(overlaps(warning, count)).toBe(false);
  });

  it("preserves the production attack table surface above the 389 x 584 dock", () => {
    const model = SCREEN_FIXTURES.attack;
    const viewport = VIEWPORTS["389x584"];
    const options = fixtureOptions(model, viewport);
    layout(model, options, viewport.width, viewport.height);

    const opponents = firstByClass("opponentStrip");
    const canvas = elementById("tableCanvas");
    const dock = firstByClass("actionDockTable");
    expect.soft(canvas.layoutBox.width, "real table width").toBeGreaterThanOrEqual(367);
    expect.soft(canvas.layoutBox.height, "real ultra-short table height").toBeGreaterThanOrEqual(330);
    expect.soft(canvas.layoutBox.height, "real ultra-short table height budget").toBeLessThanOrEqual(340);
    expect.soft(canvas.layoutBox.absoluteY, "table follows opponents").toBeGreaterThanOrEqual(bottom(opponents));
    expect.soft(bottom(canvas), "table clears fixed dock").toBeLessThanOrEqual(dock.layoutBox.absoluteY);
  });
});

function layout(
  model: ScreenModel,
  options: RenderSceneOptions = OPTIONS,
  viewportWidth = WIDTH,
  viewportHeight = options.height,
  textAdvance = 10,
): void {
  Layout.clear();
  const scene = renderScene(model, options);
  // FitImage and View have identical layout semantics; replacing the tag keeps
  // this regression focused on the real engine's reflow without loading assets.
  const template = scene.template.replace(/<fitimage([^>]*)><\/fitimage>/g, "<view$1></view>");
  Layout.init(template, scene.styles);
  Layout.updateViewPort({ x: 0, y: 0, width: viewportWidth, height: viewportHeight });
  Layout.layout(context(viewportHeight, viewportWidth, textAdvance));
}

function fixtureOptions(model: ScreenModel, viewport: ViewportProfile): RenderSceneOptions {
  const scale = viewport.width / WIDTH;
  const { left, top, right, bottom: capsuleBottom } = viewport.capsule;
  return {
    ...OPTIONS,
    height: viewport.height / scale,
    safeTop: viewport.safeTop / scale,
    safeBottom: viewport.safeBottom / scale,
    capsule: {
      left: left / scale,
      top: top / scale,
      right: right / scale,
      bottom: capsuleBottom / scale,
      width: (right - left) / scale,
      height: (capsuleBottom - top) / scale,
    },
    canGoBack: !["login", "home", "response", "explosion", "eliminated", "network"].includes(model.id),
    selectedTokens: model.id === "give-card" ? ["attack-01"] : [],
  };
}

function expectTouchTarget(id: string, label: string): void {
  const target = elementById(id);
  expect.soft(target.layoutBox.width, `${label} width`).toBeGreaterThanOrEqual(44);
  expect.soft(target.layoutBox.height, `${label} height`).toBeGreaterThanOrEqual(44);
}

function groupElementsByTop(elements: readonly LayoutElement[]): LayoutElement[][] {
  const rows = new Map<number, LayoutElement[]>();
  for (const element of elements) {
    const top = Math.round(element.layoutBox.absoluteY * 1000) / 1000;
    rows.set(top, [...(rows.get(top) ?? []), element]);
  }
  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, row]) => row.sort((left, right) => left.layoutBox.absoluteX - right.layoutBox.absoluteX));
}

function expectNoSingleGlyphLastLine(
  value: string | undefined,
  element: LayoutElement,
  glyphAdvance: number,
  label: string,
): void {
  const glyphs = [...(value ?? "")];
  const glyphsPerLine = Math.max(1, Math.floor(element.layoutBox.width / glyphAdvance));
  const trailingGlyphs = glyphs.length <= glyphsPerLine
    ? glyphs.length
    : glyphs.length % glyphsPerLine || glyphsPerLine;
  expect.soft(trailingGlyphs, label).not.toBe(1);
}

function expectFixedActionsInsideCanvas(model: ScreenModel, logicalHeight: number): void {
  const controls = (model.actions ?? []).map((_, index) => elementById(`action-${index}`));
  controls.forEach((control, index) => {
    expect.soft(control.layoutBox.absoluteX, `${model.id}:action-${index} left edge`).toBeGreaterThanOrEqual(0);
    expect.soft(rightEdge(control), `${model.id}:action-${index} right edge`).toBeLessThanOrEqual(WIDTH);
    expect.soft(control.layoutBox.absoluteY, `${model.id}:action-${index} top edge`).toBeGreaterThanOrEqual(0);
    expect.soft(bottom(control), `${model.id}:action-${index} bottom edge`).toBeLessThanOrEqual(logicalHeight);
  });
  controls.forEach((control, index) => {
    for (const peer of controls.slice(index + 1)) {
      expect.soft(overlaps(control, peer), `${model.id}: fixed actions do not overlap`).toBe(false);
    }
  });
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

function table(myTurn: boolean): NonNullable<ScreenModel["table"]> {
  return {
    turn: 8,
    direction: "clockwise",
    deckCount: 20,
    hand: [],
    players: [
      { id: "viewer", name: "你", avatar: "assets/cats/player.png", alive: true, handCount: 6, ready: true, bot: false, host: true, connected: true },
      { id: "orange", name: "阿橘", avatar: "assets/cats/a-ju.png", alive: true, handCount: 5, ready: true, bot: false, host: false, connected: true },
      { id: "grey", name: "小灰", avatar: "assets/cats/xiao-hui.png", alive: true, handCount: 7, ready: true, bot: false, host: false, connected: true },
    ],
    myTurn,
    turnsOwed: 1,
  };
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

function context(height = HEIGHT, width = WIDTH, textAdvance = 10): CanvasRenderingContext2D {
  const target = {
    canvas: { width, height },
    measureText: (value: string) => ({ width: [...String(value)].length * textAdvance }),
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
