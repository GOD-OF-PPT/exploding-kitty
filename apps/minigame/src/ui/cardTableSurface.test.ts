import { describe, expect, it, vi } from "vitest";
import type { CardModel } from "./model";
import { CardTableSurface, type TableSurfaceState } from "./cardTableSurface";

const DENSE_SURFACE_SIZES = [358, 368].flatMap((width) => [340, 430, 520].map((height) => ({
  sizeLabel: `${width}x${height}`,
  width,
  height,
}))).concat([{ sizeLabel: "368x335 production ultra-short", width: 368, height: 335 }]);

const DENSE_SELECTION_STATES = [
  { selectionLabel: "no selection", selectedIndex: null },
  ...Array.from({ length: 10 }, (_, selectedIndex) => ({
    selectionLabel: `card ${selectedIndex + 1} selected`,
    selectedIndex,
  })),
];

const DENSE_HAND_CASES = DENSE_SURFACE_SIZES.flatMap((size) => DENSE_SELECTION_STATES.map(
  (selection) => ({ ...size, ...selection }),
));

const SIX_CARD_SELECTION_STATES = [
  { selectionLabel: "no selection", selectedIndex: null },
  ...Array.from({ length: 6 }, (_, selectedIndex) => ({
    selectionLabel: `card ${selectedIndex + 1} selected`,
    selectedIndex,
  })),
];

const SIX_CARD_HAND_CASES = DENSE_SURFACE_SIZES.flatMap((size) => SIX_CARD_SELECTION_STATES.map(
  (selection) => ({ ...size, ...selection }),
));

describe("CardTableSurface", () => {
  it("keeps the selected card above the fan for drawing and hit testing", () => {
    const harness = createHarness(state({ selectedTokens: ["attack"] }));

    // This point is shared by both cards. The selected first card is visually
    // raised above the second card and therefore owns the touch target.
    expect(harness.surface.cardAt(180, 550)?.token).toBe("attack");
    expect(harness.surface.cardAt(180, 460)?.token).toBe("attack");

    harness.surface.update(state({ selectedTokens: [] }));
    expect(harness.surface.cardAt(180, 550)?.token).toBe("skip");
  });

  it("anchors the hand to the bottom as the canvas height changes", () => {
    const oneCard = [card("attack", "攻击", "assets/cards/attack.png")];
    const harness = createHarness(state({ hand: oneCard }));

    expect(harness.surface.cardAt(179, 505)?.token).toBe("attack");
    expect(harness.surface.cardAt(135, 505)?.token).toBe("attack");
    expect(harness.surface.cardAt(223, 505)?.token).toBe("attack");
    expect(harness.surface.cardAt(125, 505)).toBeNull();
    expect(harness.surface.cardAt(233, 505)).toBeNull();

    harness.surface.update(state({ height: 844, hand: oneCard }));
    expect(harness.canvas.height).toBe(844);
    expect(vi.mocked(harness.context.fillRect).mock.calls).toContainEqual([0, 509, 358, 335]);
    expect(harness.surface.cardAt(179, 550)).toBeNull();
    expect(harness.surface.cardAt(179, 650)?.token).toBe("attack");

    harness.surface.update(state({ height: 430, hand: oneCard }));
    expect(harness.canvas.height).toBe(430);
    expect(vi.mocked(harness.context.fillRect).mock.calls).toContainEqual([0, 240, 358, 190]);
    expect(harness.surface.cardAt(179, 350)?.token).toBe("attack");
    expect(harness.surface.cardAt(135, 350)?.token).toBe("attack");
    expect(harness.surface.cardAt(223, 350)?.token).toBe("attack");
    expect(harness.surface.cardAt(125, 350)).toBeNull();
    expect(harness.surface.cardAt(233, 350)).toBeNull();

    harness.surface.update(state({ height: 340, hand: oneCard }));
    expect(harness.canvas.height).toBe(340);
    expect(vi.mocked(harness.context.fillRect).mock.calls).toContainEqual([0, 150, 358, 190]);
    expect(harness.surface.cardAt(179, 230)?.token).toBe("attack");
    expect(harness.surface.cardAt(179, 330)?.token).toBe("attack");
  });

  it("uses DPR-scaled backing pixels while retaining logical table coordinates", () => {
    const oneCard = [card("attack", "攻击", "assets/cards/attack.png")];
    const harness = createHarness(state({ width: 368, hand: oneCard, renderScale: 3 }));

    expect(harness.canvas.width).toBe(1104);
    expect(harness.canvas.height).toBe(2115);
    expect(harness.context.setTransform).toHaveBeenLastCalledWith(3, 0, 0, 3, 0, 0);
    expect(harness.context.clearRect).toHaveBeenLastCalledWith(0, 0, 368, 705);
    expect(harness.surface.cardAt(184, 505)?.token).toBe("attack");

    harness.surface.update(state({ width: 320, height: 430, hand: oneCard, renderScale: 3 }));
    expect(harness.canvas.width).toBe(960);
    expect(harness.canvas.height).toBe(1290);
    expect(harness.context.setTransform).toHaveBeenLastCalledWith(3, 0, 0, 3, 0, 0);
    expect(harness.context.clearRect).toHaveBeenLastCalledWith(0, 0, 320, 430);
  });

  it("restores high-quality interpolation after every backing-store resize", () => {
    const harness = createHarness(state({ renderScale: 2 }));

    expect(harness.context.imageSmoothingEnabled).toBe(true);
    expect(harness.context.imageSmoothingQuality).toBe("high");

    harness.surface.update(state({ width: 368, height: 430, renderScale: 3 }));
    expect(harness.context.imageSmoothingEnabled).toBe(true);
    expect(harness.context.imageSmoothingQuality).toBe("high");
  });

  it("renders the three table states with intact Chinese copy", () => {
    const hand = sixCardHand();
    const harness = createHarness(state({ hand }));

    harness.surface.update(state({ hand, turnsOwed: 3 }));
    harness.surface.update(state({ hand, myTurn: false }));
    harness.surface.update(state({ hand, myTurn: false, waitingLabel: "等待阿橘行动…" }));

    const labels = vi.mocked(harness.context.fillText).mock.calls.map(([label]) => String(label));
    expect(labels).toEqual(expect.arrayContaining([
      "轮到你了",
      "你还欠 3 个回合！",
      "等待其他玩家行动…",
      "等待阿橘行动…",
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

  it("keeps the production ultra-short table hierarchy separated and legible", () => {
    const harness = createHarness(state({
      width: 368,
      height: 335,
      hand: sixCardHand(),
      turnsOwed: 3,
    }));
    const latest = (value: string) => harness.texts.filter((text) => text.value === value).at(-1);
    const banner = harness.pathFills.find((fill) => fill.color === "#f23b20");
    const burst = harness.pathFills.find((fill) => fill.color === "#ffc928");
    const handZone = harness.fills.find((fill) => fill.color === ""
      && fill.destination[0] === 0
      && fill.destination[2] === 368
      && fill.destination[1] > 0);

    expect(banner?.destination[2], "turn banner width").toBeGreaterThanOrEqual(190);
    expect(banner?.destination[3], "turn banner height").toBeGreaterThanOrEqual(30);
    expect(burst?.destination[2], "draw instruction width").toBeGreaterThanOrEqual(190);
    expect(burst?.destination[3], "draw instruction height").toBeGreaterThanOrEqual(44);
    expect(handZone?.destination[1], "central table height").toBeGreaterThanOrEqual(190);
    expect(
      (burst?.destination[1] ?? Number.POSITIVE_INFINITY) + (burst?.destination[3] ?? 0),
      "draw instruction clears the hand zone",
    ).toBeLessThanOrEqual(handZone?.destination[1] ?? Number.NEGATIVE_INFINITY);
    expect(fontPixelSize(latest("你还欠 3 个回合！")?.font)).toBeGreaterThanOrEqual(14);
    for (const label of ["牌堆", "弃牌堆"]) {
      expect(fontPixelSize(latest(label)?.font), label).toBeGreaterThanOrEqual(11);
    }
    const instruction = latest("抽牌 · 完成 1 回合");
    expect(instruction, "single-line draw instruction").toBeDefined();
    expect(latest("抽牌"), "no squeezed first line").toBeUndefined();
    expect(latest("完成 1 回合"), "no squeezed second line").toBeUndefined();
    expect(fontPixelSize(instruction?.font)).toBeGreaterThanOrEqual(15);
    expect(instruction?.maxWidth, "draw instruction text width budget").toBeGreaterThanOrEqual(176);
    if (instruction && burst) {
      const center = transformPoint(instruction.transform, instruction.x, instruction.y);
      const halfTextHeight = fontPixelSize(instruction.font) / 2;
      expect(center.y - halfTextHeight, "instruction ink top").toBeGreaterThanOrEqual(
        burst.destination[1] + 3,
      );
      expect(center.y + halfTextHeight, "instruction ink bottom").toBeLessThanOrEqual(
        burst.destination[1] + burst.destination[3] - 3,
      );
    }
    for (const [label, source] of [
      ["draw pile", "assets/cards/card-back.png"],
      ["discard pile", "assets/cards/defuse.png"],
    ] as const) {
      const artwork = harness.draws.find((draw) => draw.source === source);
      expect(artwork, `${label} artwork`).toBeDefined();
      expect(artwork?.destinationSize[0], `${label} artwork width`).toBeGreaterThanOrEqual(68);
      expect(artwork?.destinationSize[1], `${label} artwork height`).toBeGreaterThanOrEqual(100);
    }
    for (const label of ["牌堆", "18", "弃牌堆"] as const) {
      const text = latest(label);
      expect(text, `${label} text`).toBeDefined();
      if (text && burst) {
        const baseline = transformPoint(text.transform, text.x, text.y).y;
        const descent = fontPixelSize(text.font) * 0.2;
        expect(baseline + descent, `${label} clears draw instruction`).toBeLessThanOrEqual(
          burst.destination[1] - 2,
        );
      }
    }
  });

  it("keeps a larger ultra-short hand complete and clear of the draw instruction", () => {
    const hand = tenCardHand();
    const height = 335;
    const harness = createHarness(state({ width: 368, height, hand, turnsOwed: 3 }));
    const latest = (value: string) => harness.texts.filter((text) => text.value === value).at(-1);
    const burst = harness.pathFills.find((fill) => fill.color === "#ffc928");
    const handZone = harness.fills.find((fill) => fill.color === ""
      && fill.destination[0] === 0
      && fill.destination[2] === 368
      && fill.destination[1] > 0);

    expect(burst, "draw instruction").toBeDefined();
    expect(handZone, "hand zone").toBeDefined();
    if (burst && handZone) {
      expect(
        burst.destination[1] + burst.destination[3],
        "draw instruction clears the hand zone",
      ).toBeLessThanOrEqual(handZone.destination[1]);
      for (const label of ["牌堆", "18", "弃牌堆"] as const) {
        const text = latest(label);
        expect(text, `${label} text`).toBeDefined();
        if (!text) continue;
        const baseline = transformPoint(text.transform, text.x, text.y).y;
        const descent = fontPixelSize(text.font) * 0.2;
        expect(baseline + descent, `${label} clears draw instruction`).toBeLessThanOrEqual(
          burst.destination[1] - 2,
        );
      }
    }

    for (const draw of harness.draws.filter(({ source }) => hand.some((card) => card.image === source))) {
      const frame = largestFrameStroke(harness.strokes, draw);
      expect(frame, `${draw.source} card frame`).toBeDefined();
      if (!frame?.destination) continue;
      const bounds = transformedStrokeBounds(frame);
      expect(bounds.top, `${draw.source} frame top`).toBeGreaterThanOrEqual(-0.001);
      expect(bounds.bottom, `${draw.source} frame bottom`).toBeLessThanOrEqual(height + 0.001);
    }
  });

  it("keeps semantic cards complete, canonical, aspect-correct, and dense at DPR3", () => {
    const harness = createHarness(state({ renderScale: 3 }));
    const pile = harness.draws.find((draw) => draw.source === "assets/cards/card-back.png");
    const handCard = harness.draws.find((draw) => draw.source === "assets/cards/attack.png");
    const discard = harness.draws.find((draw) => draw.source === "assets/cards/defuse.png");

    expect(handCard, "hand card artwork").toBeDefined();
    expect(discard, "discard artwork").toBeDefined();
    expect(pile, "draw-pile artwork").toBeDefined();
    for (const draw of [handCard, discard]) {
      expect(draw && artworkQualityViolations(draw), `${draw?.source} semantic artwork`).toEqual([]);
      expect(draw?.sourceRect).toEqual([0, 0, 840, 1200]);
    }
    expect(pile && artworkQualityViolations(pile, { allowLimitedCrop: true }), "card-back artwork").toEqual([]);
    expect(visibleSourceFraction(pile), "card-back visible source area").toBeGreaterThanOrEqual(0.9);

    const handFrame = handCard ? largestFrameStroke(harness.strokes, handCard) : undefined;
    expect(handFrame, "hand-card frame").toBeDefined();
    if (handFrame?.destination) {
      const [, , width, height] = handFrame.destination;
      expect(width / height, "hand-card slot aspect").toBeGreaterThanOrEqual(0.67);
      expect(width / height, "hand-card slot aspect").toBeLessThanOrEqual(0.73);
    }
    expect(vi.mocked(harness.context.fillRect).mock.calls).toContainEqual([0, 370, 358, 335]);

    harness.draws.length = 0;
    harness.surface.update(state({ myTurn: false }));
    expect(harness.draws.find((draw) => draw.source === "assets/cards/card-back.png")?.alpha).toBeCloseTo(0.1688, 4);
    expect(harness.draws.find((draw) => draw.source === "assets/cards/card-back.png")?.filter).toBe("grayscale(70%)");
    expect(harness.draws.find((draw) => draw.source === "assets/cards/attack.png")?.alpha).toBeCloseTo(0.72);
    expect(harness.draws.find((draw) => draw.source === "assets/cards/defuse.png")?.alpha).toBe(1);
    expect(harness.texts.filter((draw) => draw.value === "现在不是你的回合").at(-1)?.alpha).toBeCloseTo(0.48);
  });

  it("keeps the retired 220x513 strip slice red under the canonical card-art gate", () => {
    const legacy = card("legacy", "旧切片", "assets/cards/legacy-220x513.png");
    const harness = createHarness(state({ hand: [legacy], renderScale: 3 }));
    const draw = harness.draws.find(({ source }) => source === legacy.image);

    expect(draw, "legacy card draw").toBeDefined();
    expect(draw && artworkQualityViolations(draw)).toContain("source-aspect");
  });

  it("dims an unplayable card without giving it a touch target", () => {
    const blocked = card("defuse", "拆弹", "assets/cards/defuse-hand.png", false);
    const harness = createHarness(state({ hand: [blocked] }));

    expect(harness.draws.find((draw) => draw.source === blocked.image)?.alpha).toBeCloseTo(0.72);
    expect(harness.draws.find((draw) => draw.source === blocked.image)?.filter).toBe("grayscale(70%)");
    expect(harness.surface.cardAt(179, 505)).toBeNull();

    harness.surface.update(state({ hand: [card("attack", "攻击", "assets/cards/attack.png"), blocked] }));
    expect(harness.surface.cardAt(180, 550)).toBeNull();
  });

  it.each(SIX_CARD_HAND_CASES)(
    "shows six complete cards in responsive rows with truthful 44px ownership at $sizeLabel with $selectionLabel",
    ({ selectedIndex, width, height }) => {
    const hand = sixCardHand();
    const selectedToken = selectedIndex === null ? undefined : hand[selectedIndex]!.token;
    const harness = createHarness(state({
      width,
      height,
      hand,
      selectedTokens: selectedToken ? [selectedToken] : [],
    }));
    const cardDraws = harness.draws.filter((draw) => hand.some((card) => card.image === draw.source));
    const rows = new Map<number, RecordedDraw[]>();
    for (const draw of cardDraws) {
      const row = Math.round(draw.transform.f);
      rows.set(row, [...(rows.get(row) ?? []), draw]);
    }
    const ultraShort = height <= 360 * (width / 358);
    expect([...rows.values()].map((draws) => draws.length).sort()).toEqual(
      ultraShort ? [6] : [3, 3],
    );
    for (const draws of rows.values()) {
      const centers = draws.map((draw) => draw.transform.e).sort((left, right) => left - right);
      for (let index = 1; index < centers.length; index += 1) {
        expect(centers[index]! - centers[index - 1]!).toBeGreaterThan(
          ultraShort ? 44 : 90,
        );
      }
    }
    expectCardFrameRowsDoNotOverlap(cardDraws, harness.strokes);
    for (const draw of cardDraws) {
      const frame = largestFrameStroke(harness.strokes, draw);
      expect(frame, `${draw.source} card frame`).toBeDefined();
      if (!frame?.destination) continue;
      const bounds = transformedStrokeBounds(frame);
      expect(bounds.top, `${draw.source} frame top`).toBeGreaterThanOrEqual(-0.001);
      expect(bounds.bottom, `${draw.source} frame bottom`).toBeLessThanOrEqual(height + 0.001);
    }

    const hitOwners = Array.from({ length: height }, (_, y) => Array.from(
      { length: width },
      (_, x) => harness.surface.cardAt(x, y)?.token ?? null,
    ));
    const visualOwners = visualOwnersFromDraws(
      harness.draws,
      harness.fills,
      harness.strokes,
      hand,
      0,
      height,
      width,
    );
    const sharedOwners = hitOwners.map((row, y) => row.map(
      (owner, x) => owner && visualOwners[y]![x] === owner ? owner : null,
    ));
    expectOwnerMapsToAgree(visualOwners, hitOwners);
    expectCardFrameRowsDoNotOverlap(harness.draws.filter(
      (draw) => hand.some((card) => card.image === draw.source),
    ), harness.strokes);
    for (const { token, playable } of hand) {
      expect(largestSolidSquare(visualOwners, token), `${token} visible`).toBeGreaterThanOrEqual(44);
      if (playable) {
        expect(largestSolidSquare(sharedOwners, token), `${token} tappable`).toBeGreaterThanOrEqual(44);
      } else {
        expect(hitOwners.some((row) => row.includes(token)), `${token} must stay noninteractive`).toBe(false);
      }
    }
    if (selectedToken && selectedIndex !== null) {
      expectDenseSelectedMarkerWithinSlot(
        harness.draws,
        harness.fills,
        harness.strokes,
        hand[selectedIndex]!,
      );
    }
  });

  it.each(DENSE_HAND_CASES)(
    "keeps shared 44px targets and bounded selected markers at $sizeLabel with $selectionLabel",
    ({ selectedIndex, width, height }) => {
    const hand = tenCardHand();
    const selectedToken = selectedIndex === null ? undefined : hand[selectedIndex]!.token;
    const harness = createHarness(state({
      width,
      height,
      hand,
      selectedTokens: selectedToken ? [selectedToken] : [],
    }));
    const hitOwners = Array.from({ length: height }, (_, y) => Array.from(
      { length: width },
      (_, x) => harness.surface.cardAt(x, y)?.token ?? null,
    ));
    const visualOwners = visualOwnersFromDraws(
      harness.draws,
      harness.fills,
      harness.strokes,
      hand,
      0,
      height,
      width,
    );
    const sharedOwners = hitOwners.map((row, y) => row.map(
      (owner, x) => owner && visualOwners[y]![x] === owner ? owner : null,
    ));
    expectOwnerMapsToAgree(visualOwners, hitOwners);

    for (const { token } of hand) {
      expect(
        largestSolidSquare(sharedOwners, token),
        `${token} shared visual and hit target`,
      ).toBeGreaterThanOrEqual(44);
    }
    if (selectedToken && selectedIndex !== null) {
      expectDenseSelectedMarkerWithinSlot(
        harness.draws,
        harness.fills,
        harness.strokes,
        hand[selectedIndex]!,
      );
      expect(
        largestSolidSquare(sharedOwners, selectedToken),
        `${selectedToken} remains tappable for deselection`,
      ).toBeGreaterThanOrEqual(44);
    }
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

function tenCardHand(): CardModel[] {
  return Array.from({ length: 10 }, (_, index) => card(
    `card-${index + 1}`,
    `牌 ${index + 1}`,
    `assets/cards/test-dense-${index + 1}.png`,
  ));
}

function largestSolidSquare(owners: readonly (readonly (string | null)[])[], token: string): number {
  let previous = Array((owners[0]?.length ?? 0) + 1).fill(0) as number[];
  let longest = 0;
  for (const row of owners) {
    const current = Array(previous.length).fill(0) as number[];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== token) continue;
      current[x + 1] = Math.min(current[x]!, previous[x]!, previous[x + 1]!) + 1;
      longest = Math.max(longest, current[x + 1]!);
    }
    previous = current;
  }
  return longest;
}

function expectCardFrameRowsDoNotOverlap(
  draws: readonly RecordedDraw[],
  strokes: readonly RecordedStroke[],
): void {
  const grouped = new Map<number, RecordedDraw[]>();
  for (const draw of draws) {
    const key = Math.round(draw.transform.f);
    grouped.set(key, [...(grouped.get(key) ?? []), draw]);
  }
  const rows = [...grouped.values()]
    .map((row) => {
      const bounds = row.map((draw) => {
        const frame = largestFrameStroke(strokes, draw);
        expect(frame, `${draw.source} card frame`).toBeDefined();
        return frame?.destination ? transformedStrokeBounds(frame) : transformedBounds(draw);
      });
      return {
        top: Math.min(...bounds.map((bound) => bound.top)),
        bottom: Math.max(...bounds.map((bound) => bound.bottom)),
      };
    })
    .sort((left, right) => left.top - right.top);
  for (let index = 1; index < rows.length; index += 1) {
    expect(rows[index - 1]!.bottom, `card rows ${index} and ${index + 1} overlap`).toBeLessThanOrEqual(
      rows[index]!.top + 0.001,
    );
  }
}

function artworkQualityViolations(
  draw: RecordedDraw,
  options: Readonly<{ allowLimitedCrop?: boolean }> = {},
): string[] {
  const violations: string[] = [];
  const [sourceX, sourceY, sourceWidth, sourceHeight] = draw.sourceRect;
  const [intrinsicWidth, intrinsicHeight] = draw.intrinsicSize;
  const [, , destinationWidth, destinationHeight] = draw.destination;
  const sourceAspect = sourceWidth / sourceHeight;
  const destinationAspect = destinationWidth / destinationHeight;
  const canonicalAspect = 7 / 10;
  const fullSource = sourceX === 0
    && sourceY === 0
    && sourceWidth === intrinsicWidth
    && sourceHeight === intrinsicHeight;

  if (!fullSource && (!options.allowLimitedCrop || visibleSourceFraction(draw) < 0.9)) violations.push("crop");
  if (Math.abs(sourceAspect / destinationAspect - 1) > 0.01) violations.push("distortion");
  if (Math.abs(intrinsicWidth / intrinsicHeight / canonicalAspect - 1) > 0.04) violations.push("source-aspect");

  const physicalWidth = destinationWidth * Math.hypot(draw.transform.a, draw.transform.b);
  const physicalHeight = destinationHeight * Math.hypot(draw.transform.c, draw.transform.d);
  if (sourceWidth / physicalWidth < 0.85 || sourceHeight / physicalHeight < 0.85) violations.push("density");
  return violations;
}

function visibleSourceFraction(draw: RecordedDraw | undefined): number {
  if (!draw) return 0;
  const [, , sourceWidth, sourceHeight] = draw.sourceRect;
  const [intrinsicWidth, intrinsicHeight] = draw.intrinsicSize;
  return (sourceWidth * sourceHeight) / (intrinsicWidth * intrinsicHeight);
}

function largestFrameStroke(
  strokes: readonly RecordedStroke[],
  draw: RecordedDraw,
): RecordedStroke | undefined {
  return strokes
    .filter((stroke) => stroke.color === "#171512"
      && Boolean(stroke.destination)
      && sameTransform(stroke.transform, draw.transform))
    .sort((left, right) => rectangleArea(right.destination) - rectangleArea(left.destination))[0];
}

function rectangleArea(rect: readonly [number, number, number, number] | undefined): number {
  return rect ? rect[2] * rect[3] : 0;
}

function expectOwnerMapsToAgree(
  visualOwners: readonly (readonly (string | null)[])[],
  hitOwners: readonly (readonly (string | null)[])[],
): void {
  let ownerConflict: Readonly<{ x: number; y: number; visual: string; hit: string }> | null = null;
  for (let y = 0; y < visualOwners.length && !ownerConflict; y += 1) {
    for (let x = 0; x < visualOwners[y]!.length; x += 1) {
      const visual = visualOwners[y]![x];
      const hit = hitOwners[y]![x];
      if (hit && visual !== hit) {
        ownerConflict = { x, y, visual: visual ?? "none", hit };
        break;
      }
    }
  }
  expect(ownerConflict, "every hit pixel must belong to the same visible card").toBeNull();
}

function visualOwnersFromDraws(
  draws: readonly RecordedDraw[],
  fills: readonly RecordedFill[],
  strokes: readonly RecordedStroke[],
  hand: readonly CardModel[],
  top: number,
  height: number,
  width: number,
): (string | null)[][] {
  const tokenBySource = new Map(hand.map(({ image, token }) => [image, token]));
  const cardDraws = draws.filter(({ source }) => tokenBySource.has(source));
  const layers: Array<{
    kind: "area" | "stroke";
    layer: RecordedDraw | RecordedFill | RecordedStroke;
    token: string;
  }> = cardDraws.map((draw) => ({ kind: "area", layer: draw, token: tokenBySource.get(draw.source)! }));
  for (const fill of fills) {
    if (fill.color !== "#ffc928") continue;
    const ownerDraw = cardDrawWithTransform(cardDraws, fill);
    if (ownerDraw) layers.push({ kind: "area", layer: fill, token: tokenBySource.get(ownerDraw.source)! });
  }
  for (const stroke of strokes) {
    if (stroke.color !== "#ffc928" || !stroke.destination) continue;
    const ownerDraw = cardDrawWithTransform(cardDraws, stroke);
    if (ownerDraw) layers.push({ kind: "stroke", layer: stroke, token: tokenBySource.get(ownerDraw.source)! });
  }
  layers.sort((left, right) => left.layer.order - right.layer.order);
  return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, x) => {
    const y = row + top;
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const { kind, layer, token } = layers[index]!;
      if (kind === "stroke") {
        if (pointInRecordedStroke(layer as RecordedStroke, x, y)) return token;
      } else if (pointInRecordedLayer(layer as RecordedDraw | RecordedFill, x, y)) return token;
    }
    return null;
  }));
}

function expectDenseSelectedMarkerWithinSlot(
  draws: readonly RecordedDraw[],
  fills: readonly RecordedFill[],
  strokes: readonly RecordedStroke[],
  selectedCard: CardModel,
): void {
  const selectedDraw = draws.find(({ source }) => source === selectedCard.image);
  expect(selectedDraw, `${selectedCard.token} image draw`).toBeDefined();
  const marker = selectedDraw
    ? strokes.find((stroke) => stroke.color === "#ffc928"
      && Boolean(stroke.destination)
      && sameTransform(stroke.transform, selectedDraw.transform))
    : undefined;
  expect(marker, `${selectedCard.token} dense selected marker`).toBeDefined();
  if (!selectedDraw || !marker?.destination) return;

  const frame = largestFrameStroke(strokes, selectedDraw);
  expect(frame, `${selectedCard.token} black frame`).toBeDefined();
  if (!frame?.destination) return;
  const markerBounds = transformedStrokeBounds(marker);
  const slotBounds = transformedStrokeBounds(frame);
  const priorBlackStrokes = strokes.filter((stroke) => stroke.color === "#171512"
    && sameTransform(stroke.transform, selectedDraw.transform)
    && stroke.order < marker.order);
  expect(priorBlackStrokes.length, `${selectedCard.token} black border recorded`).toBeGreaterThan(0);
  expect(marker.order, `${selectedCard.token} marker after image`).toBeGreaterThan(selectedDraw.order);
  expect(marker.order, `${selectedCard.token} marker after black border`).toBeGreaterThan(
    Math.max(...priorBlackStrokes.map(({ order }) => order)),
  );
  expect(marker.color).toBe("#ffc928");
  expect(marker.lineWidth / frame.lineWidth).toBeCloseTo(4 / 3);
  expect(
    fills.some((fill) => fill.color === "#ffc928" && sameTransform(fill.transform, selectedDraw.transform)),
    `${selectedCard.token} has no pre-image yellow fill`,
  ).toBe(false);
  expect(markerBounds.left, `${selectedCard.token} marker left bound`).toBeGreaterThanOrEqual(slotBounds.left - 0.001);
  expect(markerBounds.top, `${selectedCard.token} marker top bound`).toBeGreaterThanOrEqual(slotBounds.top - 0.001);
  expect(markerBounds.right, `${selectedCard.token} marker right bound`).toBeLessThanOrEqual(slotBounds.right + 0.001);
  expect(markerBounds.bottom, `${selectedCard.token} marker bottom bound`).toBeLessThanOrEqual(slotBounds.bottom + 0.001);
}

function cardDrawWithTransform(
  draws: readonly RecordedDraw[],
  layer: RecordedFill | RecordedStroke,
): RecordedDraw | undefined {
  return draws.find((draw) => sameTransform(draw.transform, layer.transform));
}

function sameTransform(left: TransformMatrix, right: TransformMatrix): boolean {
  return Math.abs(left.a - right.a) < 0.0001
    && Math.abs(left.b - right.b) < 0.0001
    && Math.abs(left.c - right.c) < 0.0001
    && Math.abs(left.d - right.d) < 0.0001
    && Math.abs(left.e - right.e) < 0.0001
    && Math.abs(left.f - right.f) < 0.0001;
}

function pointInRecordedLayer(layer: RecordedDraw | RecordedFill, x: number, y: number): boolean {
  const { a, b, c, d, e, f } = layer.transform;
  const determinant = a * d - b * c;
  if (determinant === 0) return false;
  const translatedX = x - e;
  const translatedY = y - f;
  const localX = (d * translatedX - c * translatedY) / determinant;
  const localY = (-b * translatedX + a * translatedY) / determinant;
  const [left, top, width, height] = layer.destination;
  return localX >= left
    && localX < left + width
    && localY >= top
    && localY < top + height;
}

function pointInRecordedStroke(stroke: RecordedStroke, x: number, y: number): boolean {
  if (!stroke.destination) return false;
  const local = inverseTransformPoint(stroke.transform, x, y);
  if (!local) return false;
  const [left, top, width, height] = stroke.destination;
  const halfLine = stroke.lineWidth / 2;
  const inOuter = local.x >= left - halfLine
    && local.x < left + width + halfLine
    && local.y >= top - halfLine
    && local.y < top + height + halfLine;
  const inInner = local.x > left + halfLine
    && local.x < left + width - halfLine
    && local.y > top + halfLine
    && local.y < top + height - halfLine;
  return inOuter && !inInner;
}

function inverseTransformPoint(transform: TransformMatrix, x: number, y: number): Readonly<{ x: number; y: number }> | null {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (determinant === 0) return null;
  const translatedX = x - transform.e;
  const translatedY = y - transform.f;
  return {
    x: (transform.d * translatedX - transform.c * translatedY) / determinant,
    y: (-transform.b * translatedX + transform.a * translatedY) / determinant,
  };
}

function transformedBounds(layer: RecordedDraw | RecordedFill): Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}> {
  const [left, top, width, height] = layer.destination;
  const corners = [
    transformPoint(layer.transform, left, top),
    transformPoint(layer.transform, left + width, top),
    transformPoint(layer.transform, left, top + height),
    transformPoint(layer.transform, left + width, top + height),
  ];
  return {
    left: Math.min(...corners.map(({ x }) => x)),
    top: Math.min(...corners.map(({ y }) => y)),
    right: Math.max(...corners.map(({ x }) => x)),
    bottom: Math.max(...corners.map(({ y }) => y)),
  };
}

function transformedStrokeBounds(stroke: RecordedStroke): Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}> {
  const [left, top, width, height] = stroke.destination!;
  const halfLine = stroke.lineWidth / 2;
  return transformedBounds({
    color: stroke.color,
    destination: [
      left - halfLine,
      top - halfLine,
      width + stroke.lineWidth,
      height + stroke.lineWidth,
    ],
    transform: stroke.transform,
    order: stroke.order,
  });
}

function transformPoint(transform: TransformMatrix, x: number, y: number): Readonly<{ x: number; y: number }> {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f,
  };
}

function createHarness(initial: TableSurfaceState) {
  const recording = recordingContext();
  let canvasWidth = 0;
  let canvasHeight = 0;
  const canvas = {
    get width() { return canvasWidth; },
    set width(value: number) {
      canvasWidth = value;
      recording.resetBitmapState();
    },
    get height() { return canvasHeight; },
    set height(value: number) {
      canvasHeight = value;
      recording.resetBitmapState();
    },
    getContext: vi.fn(() => recording.context),
  } as unknown as HTMLCanvasElement;
  const createImage = vi.fn(() => readyImage());
  const surface = new CardTableSurface(() => canvas, createImage, initial);
  return {
    canvas,
    context: recording.context,
    createImage,
    draws: recording.draws,
    fills: recording.fills,
    pathFills: recording.pathFills,
    strokes: recording.strokes,
    surface,
    texts: recording.texts,
  };
}

function readyImage(): HTMLImageElement {
  let source = "";
  let dimensions = { width: 0, height: 0 };
  return {
    get width() { return dimensions.width; },
    get height() { return dimensions.height; },
    get naturalWidth() { return dimensions.width; },
    get naturalHeight() { return dimensions.height; },
    onload: null,
    get src() { return source; },
    set src(value: string) {
      source = value;
      dimensions = imageDimensions(value);
    },
  } as unknown as HTMLImageElement;
}

function imageDimensions(source: string): Readonly<{ width: number; height: number }> {
  if (source === "assets/cards/legacy-220x513.png") return { width: 220, height: 513 };
  if (source.includes("/cards/")) return { width: 840, height: 1200 };
  if (source.endsWith("comic-bg-390x844.jpg")) return { width: 1170, height: 2532 };
  throw new Error(`UNMAPPED_TEST_IMAGE_DIMENSIONS:${source}`);
}

type RecordedDraw = Readonly<{
  source: string;
  alpha: number;
  filter: string;
  intrinsicSize: readonly [number, number];
  sourceRect: readonly [number, number, number, number];
  destination: readonly [number, number, number, number];
  destinationSize: readonly [number, number];
  transform: TransformMatrix;
  order: number;
}>;

type RecordedFill = Readonly<{
  color: string;
  destination: readonly [number, number, number, number];
  transform: TransformMatrix;
  order: number;
}>;

type RecordedStroke = Readonly<{
  color: string;
  lineWidth: number;
  destination?: readonly [number, number, number, number];
  transform: TransformMatrix;
  order: number;
}>;

type RecordedPathFill = Readonly<{
  color: string;
  destination: readonly [number, number, number, number];
  transform: TransformMatrix;
  order: number;
}>;

type TransformMatrix = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

type RecordedText = Readonly<{
  value: string;
  alpha: number;
  font: string;
  x: number;
  y: number;
  maxWidth?: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  transform: TransformMatrix;
  order: number;
}>;

function fontPixelSize(font: string | undefined): number {
  const match = /([\d.]+)px/u.exec(font ?? "");
  return match ? Number(match[1]) : 0;
}

function recordingContext(): {
  context: CanvasRenderingContext2D;
  draws: RecordedDraw[];
  fills: RecordedFill[];
  pathFills: RecordedPathFill[];
  resetBitmapState: () => void;
  strokes: RecordedStroke[];
  texts: RecordedText[];
} {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  const draws: RecordedDraw[] = [];
  const fills: RecordedFill[] = [];
  const pathFills: RecordedPathFill[] = [];
  const strokes: RecordedStroke[] = [];
  const texts: RecordedText[] = [];
  let paintOrder = 0;
  let transform: TransformMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let pathPoints: Array<Readonly<{ x: number; y: number }>> = [];
  const transformStack: TransformMatrix[] = [];
  const context = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    filter: "none",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    setTransform: vi.fn((a: number, b: number, c: number, d: number, e: number, f: number) => {
      transform = { a, b, c, d, e, f };
    }),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn((x: number, y: number, width: number, height: number) => {
      fills.push({
        color: typeof context.fillStyle === "string" ? context.fillStyle : "",
        destination: [x, y, width, height],
        transform,
        order: paintOrder,
      });
      paintOrder += 1;
    }),
    beginPath: vi.fn(() => { pathPoints = []; }),
    moveTo: vi.fn((x: number, y: number) => { pathPoints.push({ x, y }); }),
    lineTo: vi.fn((x: number, y: number) => { pathPoints.push({ x, y }); }),
    quadraticCurveTo: vi.fn((cpx: number, cpy: number, x: number, y: number) => {
      pathPoints.push({ x: cpx, y: cpy }, { x, y });
    }),
    closePath: vi.fn(),
    fill: vi.fn(() => {
      if (pathPoints.length === 0) return;
      const xs = pathPoints.map(({ x }) => x);
      const ys = pathPoints.map(({ y }) => y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      pathFills.push({
        color: typeof context.fillStyle === "string" ? context.fillStyle : "",
        destination: [left, top, Math.max(...xs) - left, Math.max(...ys) - top],
        transform,
        order: paintOrder,
      });
      paintOrder += 1;
    }),
    stroke: vi.fn(() => {
      const xs = pathPoints.map(({ x }) => x);
      const ys = pathPoints.map(({ y }) => y);
      strokes.push({
        color: typeof context.strokeStyle === "string" ? context.strokeStyle : "",
        lineWidth: context.lineWidth,
        ...(pathPoints.length > 0 ? {
          destination: [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs) - Math.min(...xs),
            Math.max(...ys) - Math.min(...ys),
          ] as const,
        } : {}),
        transform,
        order: paintOrder,
      });
      paintOrder += 1;
    }),
    strokeRect: vi.fn((x: number, y: number, width: number, height: number) => {
      strokes.push({
        color: typeof context.strokeStyle === "string" ? context.strokeStyle : "",
        lineWidth: context.lineWidth,
        destination: [x, y, width, height],
        transform,
        order: paintOrder,
      });
      paintOrder += 1;
    }),
    save: vi.fn(() => transformStack.push(transform)),
    restore: vi.fn(() => { transform = transformStack.pop() ?? transform; }),
    translate: vi.fn((x: number, y: number) => {
      transform = {
        ...transform,
        e: transform.a * x + transform.c * y + transform.e,
        f: transform.b * x + transform.d * y + transform.f,
      };
    }),
    rotate: vi.fn((angle: number) => {
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      transform = {
        a: transform.a * cosine + transform.c * sine,
        b: transform.b * cosine + transform.d * sine,
        c: -transform.a * sine + transform.c * cosine,
        d: -transform.b * sine + transform.d * cosine,
        e: transform.e,
        f: transform.f,
      };
    }),
    scale: vi.fn((x: number, y: number) => {
      transform = {
        a: transform.a * x,
        b: transform.b * x,
        c: transform.c * y,
        d: transform.d * y,
        e: transform.e,
        f: transform.f,
      };
    }),
    clip: vi.fn(),
    drawImage: vi.fn((image: HTMLImageElement, ...args: number[]) => {
      const x = args.at(-4) ?? Number.NaN;
      const y = args.at(-3) ?? Number.NaN;
      const width = args.at(-2) ?? Number.NaN;
      const height = args.at(-1) ?? Number.NaN;
      const intrinsicWidth = image.naturalWidth || image.width;
      const intrinsicHeight = image.naturalHeight || image.height;
      const sourceRect = args.length === 8
        ? [args[0]!, args[1]!, args[2]!, args[3]!] as const
        : [0, 0, intrinsicWidth, intrinsicHeight] as const;
      draws.push({
        source: image.src,
        alpha: context.globalAlpha,
        filter: context.filter,
        intrinsicSize: [intrinsicWidth, intrinsicHeight],
        sourceRect,
        destination: [x, y, width, height],
        destinationSize: [width, height],
        transform,
        order: paintOrder,
      });
      paintOrder += 1;
    }),
    fillText: vi.fn((value: string, x: number, y: number, maxWidth?: number) => {
      texts.push({
        value,
        alpha: context.globalAlpha,
        font: context.font,
        x,
        y,
        maxWidth,
        textAlign: context.textAlign as CanvasTextAlign,
        textBaseline: context.textBaseline as CanvasTextBaseline,
        transform,
        order: paintOrder,
      });
      paintOrder += 1;
    }),
    measureText: vi.fn((value: string) => ({ width: value.length * 10 } as TextMetrics)),
  };
  return {
    context: context as unknown as CanvasRenderingContext2D,
    draws,
    fills,
    pathFills,
    resetBitmapState: () => {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    },
    strokes,
    texts,
  };
}
