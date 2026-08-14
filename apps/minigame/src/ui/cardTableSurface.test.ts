import { describe, expect, it, vi } from "vitest";
import type { CardModel } from "./model";
import { CardTableSurface, type TableSurfaceState } from "./cardTableSurface";

describe("CardTableSurface", () => {
  it("keeps the selected card above the fan for drawing and hit testing", () => {
    const harness = createHarness(state({ selectedTokens: ["attack"] }));

    // This point is shared by both cards. The selected first card is visually
    // raised above the second card and therefore owns the touch target.
    expect(harness.surface.cardAt(150, 550)?.token).toBe("attack");
    expect(harness.surface.cardAt(150, 440)?.token).toBe("attack");

    harness.surface.update(state({ selectedTokens: [] }));
    expect(harness.surface.cardAt(150, 550)?.token).toBe("skip");
  });

  it("anchors the hand to the bottom as the canvas height changes", () => {
    const oneCard = [card("attack", "攻击", "assets/cards/attack.png")];
    const harness = createHarness(state({ hand: oneCard }));

    expect(harness.surface.cardAt(179, 505)?.token).toBe("attack");
    expect(harness.surface.cardAt(119, 505)?.token).toBe("attack");
    expect(harness.surface.cardAt(239, 505)?.token).toBe("attack");
    expect(harness.surface.cardAt(109, 505)).toBeNull();
    expect(harness.surface.cardAt(249, 505)).toBeNull();

    harness.surface.update(state({ height: 844, hand: oneCard }));
    expect(harness.canvas.height).toBe(844);
    expect(vi.mocked(harness.context.fillRect).mock.calls).toContainEqual([0, 509, 358, 335]);
    expect(harness.surface.cardAt(179, 550)).toBeNull();
    expect(harness.surface.cardAt(179, 650)?.token).toBe("attack");

    harness.surface.update(state({ height: 430, hand: oneCard }));
    expect(harness.canvas.height).toBe(430);
    expect(vi.mocked(harness.context.fillRect).mock.calls).toContainEqual([0, 264, 358, 166]);
    expect(harness.surface.cardAt(179, 350)?.token).toBe("attack");
    expect(harness.surface.cardAt(119, 350)?.token).toBe("attack");
    expect(harness.surface.cardAt(239, 350)?.token).toBe("attack");
    expect(harness.surface.cardAt(109, 350)).toBeNull();
    expect(harness.surface.cardAt(249, 350)).toBeNull();

    harness.surface.update(state({ height: 340, hand: oneCard }));
    expect(harness.canvas.height).toBe(340);
    expect(harness.surface.cardAt(179, 330)?.token).toBe("attack");
  });

  it("renders the three table states with intact Chinese copy", () => {
    const hand = sixCardHand();
    const harness = createHarness(state({ hand }));

    harness.surface.update(state({ hand, turnsOwed: 3 }));
    harness.surface.update(state({ hand, myTurn: false }));

    const labels = vi.mocked(harness.context.fillText).mock.calls.map(([label]) => String(label));
    expect(labels).toEqual(expect.arrayContaining([
      "轮到你了",
      "你还欠 3 个回合！",
      "等待其他玩家行动…",
      "牌堆",
      "18",
      "弃牌堆",
      "抽一张",
      "抽牌 · 完成 1 回合",
      "现在不是你的回合",
      "你的手牌",
      "6",
    ]));
    expect(labels.join(" ")).not.toMatch(/[�锟]/u);
    expect(harness.surface.cardAt(179, 550)).toBeNull();
  });

  it("keeps pile and hand artwork at the reference aspect-correct frames", () => {
    const harness = createHarness(state());
    const pile = harness.draws.find((draw) => draw.source === "assets/cards/card-back.png");
    const handCard = harness.draws.find((draw) => draw.source === "assets/cards/attack.png");
    const discard = harness.draws.find((draw) => draw.source === "assets/cards/defuse.png");

    expect(pile?.destination).toEqual([56, 97, 89, 132]);
    expect(discard?.destination).toEqual([213, 97, 89, 132]);
    expect(handCard?.destinationSize).toEqual([120, 230]);
    expect(vi.mocked(harness.context.fillRect).mock.calls).toContainEqual([0, 370, 358, 335]);

    harness.draws.length = 0;
    harness.surface.update(state({ myTurn: false }));
    expect(harness.draws.find((draw) => draw.source === "assets/cards/card-back.png")?.alpha).toBeCloseTo(0.1688, 4);
    expect(harness.draws.find((draw) => draw.source === "assets/cards/card-back.png")?.filter).toBe("grayscale(70%)");
    expect(harness.draws.find((draw) => draw.source === "assets/cards/attack.png")?.alpha).toBeCloseTo(0.72);
    expect(harness.draws.find((draw) => draw.source === "assets/cards/defuse.png")?.alpha).toBe(1);
    expect(harness.texts.filter((draw) => draw.value === "现在不是你的回合").at(-1)?.alpha).toBeCloseTo(0.48);
  });

  it("dims an unplayable card without giving it a touch target", () => {
    const blocked = card("defuse", "拆弹", "assets/cards/defuse-hand.png", false);
    const harness = createHarness(state({ hand: [blocked] }));

    expect(harness.draws.find((draw) => draw.source === blocked.image)?.alpha).toBeCloseTo(0.72);
    expect(harness.draws.find((draw) => draw.source === blocked.image)?.filter).toBe("grayscale(70%)");
    expect(harness.surface.cardAt(179, 505)).toBeNull();

    harness.surface.update(state({ hand: [card("attack", "攻击", "assets/cards/attack.png"), blocked] }));
    expect(harness.surface.cardAt(150, 550)).toBeNull();
  });

  it("keeps the six-card fan width-driven on a short surface", () => {
    const hand = sixCardHand();
    const harness = createHarness(state({ height: 430, hand, selectedTokens: ["attack"] }));
    const cardOrigins = vi.mocked(harness.context.translate).mock.calls
      .filter(([, y]) => y > 430)
      .map(([x]) => x);

    expect(cardOrigins).toEqual([110, 156, 202, 248, 294, 64]);
    expect(harness.draws.filter((draw) => draw.destinationSize[0] === 120)).toHaveLength(6);
    expect(harness.surface.cardAt(100, 350)?.token).toBe("attack");
  });

  it("preloads only newly introduced artwork when state changes", () => {
    const harness = createHarness(state());
    expect(harness.createImage).toHaveBeenCalledTimes(5);

    harness.surface.update(state());
    expect(harness.createImage).toHaveBeenCalledTimes(5);

    harness.surface.update(state({
      hand: [...state().hand, card("new", "洗牌", "assets/cards/shuffle.png")],
    }));
    expect(harness.createImage).toHaveBeenCalledTimes(6);
  });
});

function state(overrides: Partial<TableSurfaceState> = {}): TableSurfaceState {
  return {
    width: 358,
    height: 705,
    deckCount: 18,
    discard: card("discard", "拆弹", "assets/cards/defuse.png"),
    hand: [
      card("attack", "攻击", "assets/cards/attack.png"),
      card("skip", "跳过", "assets/cards/skip.png"),
    ],
    players: [],
    myTurn: true,
    turnsOwed: 1,
    ...overrides,
  };
}

function card(token: string, name: string, image: string, playable = true): CardModel {
  return { token, type: "ATTACK", name, image, playable, singlePlayable: playable };
}

function sixCardHand(): CardModel[] {
  return [
    card("attack", "攻击", "assets/cards/attack.png"),
    card("skip", "跳过", "assets/cards/skip.png"),
    card("defuse", "拆弹", "assets/cards/defuse-hand.png", false),
    card("shuffle", "洗牌", "assets/cards/shuffle.png"),
    card("future", "预见未来", "assets/cards/peek.png"),
    card("cat", "帮忙", "assets/cards/reverse.png"),
  ];
}

function createHarness(initial: TableSurfaceState) {
  const recording = recordingContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => recording.context),
  } as unknown as HTMLCanvasElement;
  const createImage = vi.fn(() => readyImage());
  const surface = new CardTableSurface(() => canvas, createImage, initial);
  return { canvas, context: recording.context, createImage, draws: recording.draws, surface, texts: recording.texts };
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

type RecordedDraw = Readonly<{
  source: string;
  alpha: number;
  filter: string;
  destination: readonly [number, number, number, number];
  destinationSize: readonly [number, number];
}>;

type RecordedText = Readonly<{ value: string; alpha: number }>;

function recordingContext(): { context: CanvasRenderingContext2D; draws: RecordedDraw[]; texts: RecordedText[] } {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  const draws: RecordedDraw[] = [];
  const texts: RecordedText[] = [];
  const context = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    filter: "none",
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn((image: HTMLImageElement, ...args: number[]) => {
      const x = args.at(-4) ?? Number.NaN;
      const y = args.at(-3) ?? Number.NaN;
      const width = args.at(-2) ?? Number.NaN;
      const height = args.at(-1) ?? Number.NaN;
      draws.push({ source: image.src, alpha: context.globalAlpha, filter: context.filter, destination: [x, y, width, height], destinationSize: [width, height] });
    }),
    fillText: vi.fn((value: string) => texts.push({ value, alpha: context.globalAlpha })),
    measureText: vi.fn((value: string) => ({ width: value.length * 10 } as TextMetrics)),
  };
  return { context: context as unknown as CanvasRenderingContext2D, draws, texts };
}
