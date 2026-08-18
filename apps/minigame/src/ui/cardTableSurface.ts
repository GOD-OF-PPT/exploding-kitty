import type { CardModel, PlayerModel } from "./model";

const COLORS = {
  ink: "#171512",
  cream: "#fff1c7",
  yellow: "#ffc928",
  red: "#da301f",
  redDark: "#b51e14",
} as const;

const BACKGROUND = "assets/ui/backgrounds/comic-bg-390x844.jpg";
const CARD_BACK = "assets/cards/card-back.png";

// The reference table occupies the 358 x 705 area below the player strip in
// the 390 x 844 audit captures. Card dimensions stay width-driven; short
// surfaces collapse vertical gaps and only shrink the table controls after a
// usable, bottom-anchored hand region has been reserved.
const REFERENCE_WIDTH = 358;
const REFERENCE_HEIGHT = 705;
const HAND_HEIGHT = 335;
const COMPACT_TABLE_HEIGHT = 264;
const MIN_HAND_VISIBLE = 190;
const ULTRA_SHORT_SURFACE_HEIGHT = 360;
const ULTRA_SHORT_SIX_HAND_VISIBLE = 127;
const ULTRA_SHORT_DENSE_HAND_VISIBLE = 141;
const ULTRA_SHORT_BURST_WIDTH = 188;
const CARD_WIDTH = 92.4;
const CARD_HEIGHT = 132;
const COMPACT_DENSE_HAND_THRESHOLD = 334;
const COMPACT_DENSE_CARD_WIDTH = 56;
const ULTRA_SHORT_SIX_CARD_WIDTH = 50;
const ULTRA_SHORT_DENSE_CARD_WIDTH = 44;
const DENSE_ROW_GAP = 6;
const DENSE_COMPACT_TOP_OFFSET = 22;
const DENSE_FULL_TOP_OFFSET = 60;
const ULTRA_SHORT_SIX_TOP_OFFSET = 22;
const ULTRA_SHORT_DENSE_TOP_OFFSET = 8;
const MIN_CARD_TOUCH_SIZE = 44;
const DENSE_HAND_ROW_LENGTH = 5;
const SIX_CARD_ROW_LENGTH = 3;
const DENSE_HIT_INSET = 4;
const DENSE_SELECTION_INSET = 5;
const DENSE_SELECTION_LINE_WIDTH = 4;
const SELECTED_LIFT = 55;
const SELECTED_SCALE = 1.05;
const CARD_ROTATION_ORIGIN = 1.6;
const WAITING_ALPHA = 0.48;
const DISABLED_CARD_ALPHA = 0.72;
const DRAW_PILE_BRIGHTNESS = 0.22;
const DRAW_PILE_SHADE = 1 - DRAW_PILE_BRIGHTNESS;
const DIMMED_DRAW_IMAGE_ALPHA = (DRAW_PILE_BRIGHTNESS * WAITING_ALPHA)
  / (DRAW_PILE_BRIGHTNESS * WAITING_ALPHA + 1 - WAITING_ALPHA);

export type TableSurfaceState = Readonly<{
  width: number;
  height: number;
  renderScale?: number;
  deckCount: number;
  discard?: CardModel;
  hand: readonly CardModel[];
  players: readonly PlayerModel[];
  myTurn: boolean;
  canDraw: boolean;
  turnsOwed: number;
  waitingLabel?: string;
  selectedTokens?: readonly string[];
  fontFamily?: string;
}>;

type TableLayout = Readonly<{
  scale: number;
  tableScale: number;
  handTop: number;
  compactDenseHand: boolean;
  ultraShortDenseHand: boolean;
  pileLabelGap: number;
  banner: Rect;
  drawPile: Rect;
  discardPile: Rect;
  drawBurst: Rect;
}>;

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

type CardSlot = Readonly<{
  card: CardModel;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  selected: boolean;
  layoutScale: number;
  artworkInset: number;
  hitTarget?: Rect;
}>;

export class CardTableSurface {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private state: TableSurfaceState;
  private renderScale = 1;
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly invalidationListeners = new Set<() => void>();

  constructor(
    createCanvas: () => HTMLCanvasElement,
    private readonly createImage: (() => HTMLImageElement) | undefined,
    state: TableSurfaceState,
  ) {
    this.canvas = createCanvas();
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_2D_UNAVAILABLE");
    this.ctx = context;
    this.state = state;
    this.resize(state.width, state.height, state.renderScale);
    this.preload(state);
    this.draw();
  }

  get element(): HTMLCanvasElement { return this.canvas; }

  subscribeInvalidation(listener: () => void): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }

  update(state: TableSurfaceState): void {
    this.state = state;
    const renderScale = normalizedRenderScale(state.renderScale);
    const backingWidth = backingSize(state.width, renderScale);
    const backingHeight = backingSize(state.height, renderScale);
    if (
      this.canvas.width !== backingWidth
      || this.canvas.height !== backingHeight
      || this.renderScale !== renderScale
    ) this.resize(state.width, state.height, renderScale);
    this.preload(state);
    this.draw();
  }

  cardAt(x: number, y: number): CardModel | null {
    if (!this.state.myTurn) return null;
    const slots = this.paintOrder(this.handSlots());
    const denseHand = slots.some((slot) => slot.hitTarget);
    for (const slot of slots) {
      if (!slot.hitTarget || !pointInRect(slot.hitTarget, x, y)) continue;
      return slot.card.playable ? slot.card : null;
    }
    if (denseHand) return null;
    for (let index = slots.length - 1; index >= 0; index -= 1) {
      const slot = slots[index]!;
      if (!pointInCard(slot, x, y)) continue;
      return slot.card.playable ? slot.card : null;
    }
    return null;
  }

  drawAt(x: number, y: number): boolean {
    return this.state.canDraw && pointInRect(this.tableLayout().drawBurst, x, y);
  }

  private resize(width: number, height: number, requestedRenderScale?: number): void {
    const renderScale = normalizedRenderScale(requestedRenderScale);
    this.canvas.width = backingSize(width, renderScale);
    this.canvas.height = backingSize(height, renderScale);
    this.ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    // Assign after the backing store changes: resizing a canvas resets the 2D
    // state, including interpolation quality, on browsers and WeChat runtimes.
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.renderScale = renderScale;
  }

  private preload(state: TableSurfaceState): void {
    if (!this.createImage) return;
    const sources = [BACKGROUND, CARD_BACK, state.discard?.image, ...state.hand.map((card) => card.image)]
      .filter((value): value is string => Boolean(value));
    for (const source of new Set(sources)) {
      if (this.images.has(source)) continue;
      const image = this.createImage();
      image.onload = () => {
        this.draw();
        for (const listener of this.invalidationListeners) listener();
      };
      image.src = source;
      this.images.set(source, image);
    }
  }

  private draw(): void {
    const { ctx } = this;
    const { width, height, deckCount, discard, myTurn, canDraw, turnsOwed } = this.state;
    const layout = this.tableLayout();
    ctx.clearRect(0, 0, width, height);

    const background = this.images.get(BACKGROUND);
    if (isReady(background)) drawImageCover(ctx, background, 0, 0, width, height, 0.5, 0.46);
    else {
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = "rgba(12, 11, 9, 0.78)";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(242, 59, 32, 0.13)";
    ctx.beginPath();
    ctx.moveTo(0, 18 * layout.scale);
    ctx.lineTo(width * 0.58, 0);
    ctx.lineTo(0, height * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(22, 191, 210, 0.07)";
    ctx.beginPath();
    ctx.moveTo(width, height * 0.18);
    ctx.lineTo(width * 0.68, height * 0.44);
    ctx.lineTo(width, height * 0.54);
    ctx.closePath();
    ctx.fill();

    this.drawTurnBanner(layout.banner, myTurn, turnsOwed, layout.tableScale);
    this.drawPile(layout.drawPile, CARD_BACK, "draw", deckCount, !canDraw, layout.tableScale, layout.pileLabelGap);
    this.drawPile(layout.discardPile, discard?.image, "discard", undefined, false, layout.tableScale, layout.pileLabelGap);
    this.drawDrawBurst(layout.drawBurst, myTurn, canDraw, turnsOwed, layout.tableScale);
    this.drawHandZone(layout);

    for (const slot of this.paintOrder(this.handSlots(layout))) this.drawCard(slot, !myTurn || !slot.card.playable);
  }

  private tableLayout(): TableLayout {
    const { width, height, hand } = this.state;
    const scale = Math.max(0, width / REFERENCE_WIDTH);
    const splitSix = hand.length === 6;
    const denseHand = hand.length === 6 || hand.length > DENSE_HAND_ROW_LENGTH;
    const ultraShortDenseHand = denseHand && height <= ULTRA_SHORT_SURFACE_HEIGHT * scale;
    const compactTableHeight = COMPACT_TABLE_HEIGHT * scale;
    const referenceTableHeight = (REFERENCE_HEIGHT - HAND_HEIGHT) * scale;
    const naturalHandTop = height - HAND_HEIGHT * scale;
    const minimumHandVisible = ultraShortDenseHand
      ? Math.max(
          120,
          (splitSix ? ULTRA_SHORT_SIX_HAND_VISIBLE : ULTRA_SHORT_DENSE_HAND_VISIBLE) * scale,
        )
      : MIN_HAND_VISIBLE * scale;
    const latestHandTop = Math.max(0, height - minimumHandVisible);
    const handTop = Math.max(0, Math.min(Math.max(naturalHandTop, compactTableHeight), latestHandTop));
    const compactDenseHand = denseHand
      && height - handTop < COMPACT_DENSE_HAND_THRESHOLD * scale;

    let tableScale = scale;
    let bannerY: number;
    let pileY: number;
    let burstY: number;
    let pileLabelGap: number;
    if (handTop < compactTableHeight) {
      tableScale = compactTableHeight > 0 ? scale * (handTop / compactTableHeight) : 0;
      bannerY = 0;
      pileY = 45 * tableScale;
      burstY = 205 * tableScale;
      pileLabelGap = (ultraShortDenseHand ? (splitSix ? 12 : 10) : 17) * tableScale;
    } else if (handTop < referenceTableHeight) {
      const progress = (handTop - compactTableHeight) / Math.max(1, referenceTableHeight - compactTableHeight);
      bannerY = 11 * scale * progress;
      pileY = (45 + 48 * progress) * scale;
      burstY = (205 + 95 * progress) * scale;
      pileLabelGap = (17 + 14 * progress) * scale;
    } else {
      bannerY = 11 * scale;
      pileY = handTop * (163 / 370) - 70 * scale;
      burstY = handTop - 70 * scale;
      pileLabelGap = 31 * scale;
    }

    const pileWidth = 97 * tableScale;
    const pileHeight = 140 * tableScale;
    const pileCenterOffset = 78.5 * tableScale;
    const burstWidth = ultraShortDenseHand
      ? Math.max(195 * tableScale, ULTRA_SHORT_BURST_WIDTH * scale)
      : 195 * tableScale;
    const burstHeight = ultraShortDenseHand
      ? Math.max(MIN_CARD_TOUCH_SIZE, 59 * tableScale)
      : 59 * tableScale;
    const fittedBurstY = ultraShortDenseHand
      ? Math.min(burstY, Math.max(0, handTop - burstHeight - 0.75 * scale))
      : burstY;

    return {
      scale,
      tableScale,
      handTop,
      compactDenseHand,
      ultraShortDenseHand,
      pileLabelGap,
      banner: {
        x: (width - 276 * tableScale) / 2,
        y: bannerY,
        width: 276 * tableScale,
        height: 45 * tableScale,
      },
      drawPile: {
        x: width / 2 - pileCenterOffset - pileWidth / 2,
        y: pileY,
        width: pileWidth,
        height: pileHeight,
      },
      discardPile: {
        x: width / 2 + pileCenterOffset - pileWidth / 2,
        y: pileY,
        width: pileWidth,
        height: pileHeight,
      },
      drawBurst: {
        x: (width - burstWidth) / 2,
        y: fittedBurstY,
        width: burstWidth,
        height: burstHeight,
      },
    };
  }

  private drawTurnBanner(rect: Rect, myTurn: boolean, turnsOwed: number, scale: number): void {
    const { ctx } = this;
    const label = myTurn
      ? (turnsOwed > 1 ? `你还欠 ${turnsOwed} 个回合！` : "轮到你了")
      : this.state.waitingLabel ?? "等待其他玩家行动…";
    ctx.save();
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.rotate(-Math.PI / 180);
    ctx.fillStyle = "#000000";
    roundedRect(ctx, -rect.width / 2 + 4 * scale, -rect.height / 2 + 5 * scale, rect.width, rect.height, scale);
    ctx.fill();
    // The waiting state dims only the unavailable draw/hand controls; the
    // reference keeps the turn banner at full vermilion for legibility.
    ctx.fillStyle = "#f23b20";
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3 * scale;
    roundedRect(ctx, -rect.width / 2, -rect.height / 2, rect.width, rect.height, scale);
    ctx.fill();
    ctx.stroke();
    this.setFont(Math.max(14, 25 * scale), 900, true);
    ctx.fillStyle = COLORS.cream;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0, Math.max(1, rect.width - 12));
    ctx.restore();
  }

  private drawPile(
    rect: Rect,
    source: string | undefined,
    kind: "draw" | "discard",
    count: number | undefined,
    dim: boolean,
    scale: number,
    labelGap: number,
  ): void {
    const { ctx } = this;
    const priorAlpha = ctx.globalAlpha;
    ctx.save();
    if (dim) ctx.globalAlpha = priorAlpha * WAITING_ALPHA;
    drawOffsetShadow(ctx, rect.x, rect.y, rect.width, rect.height, 8 * scale, 10 * scale, "#6a5a48");
    drawOffsetShadow(ctx, rect.x, rect.y, rect.width, rect.height, 5 * scale, 6 * scale, "#000000");

    const inset = 3 * scale;
    const image = source ? this.images.get(source) : undefined;
    const filterContext = ctx as CanvasRenderingContext2D & { filter?: string };
    const priorFilter = filterContext.filter;
    ctx.save();
    roundedRect(ctx, rect.x + inset, rect.y + inset, rect.width - inset * 2, rect.height - inset * 2, 5 * scale);
    ctx.clip();
    if (dim && typeof priorFilter === "string") filterContext.filter = "grayscale(70%)";
    if (kind === "draw" && dim) ctx.globalAlpha = priorAlpha * DIMMED_DRAW_IMAGE_ALPHA;
    ctx.fillStyle = kind === "draw" ? COLORS.redDark : COLORS.ink;
    ctx.fillRect(rect.x + inset, rect.y + inset, rect.width - inset * 2, rect.height - inset * 2);
    if (isReady(image)) {
      // A discard is semantic game state, and the card back has the same
      // canonical 7:10 contract. Keep both complete instead of cropping them
      // to an incidental pile-frame ratio.
      drawImageContain(ctx, image, rect.x + inset, rect.y + inset, rect.width - inset * 2, rect.height - inset * 2);
    }
    if (typeof priorFilter === "string") filterContext.filter = priorFilter;
    ctx.globalAlpha = dim ? priorAlpha * WAITING_ALPHA : priorAlpha;
    if (kind === "draw") {
      // The card back remains intentionally ominous even on the active turn;
      // the adjusted image alpha preserves the same result when the disabled
      // pile is composited without allocating another offscreen canvas.
      ctx.fillStyle = `rgba(0, 0, 0, ${DRAW_PILE_SHADE})`;
      ctx.fillRect(rect.x + inset, rect.y + inset, rect.width - inset * 2, rect.height - inset * 2);
    }
    ctx.restore();
    ctx.strokeStyle = COLORS.cream;
    ctx.lineWidth = 4 * scale;
    roundedRect(ctx, rect.x + 2 * scale, rect.y + 2 * scale, rect.width - 4 * scale, rect.height - 4 * scale, 6 * scale);
    ctx.stroke();

    const centerX = rect.x + rect.width / 2;
    const labelY = rect.y + rect.height + labelGap;
    ctx.textBaseline = "alphabetic";
    if (kind === "draw") {
      this.setFont(Math.max(11, 11 * scale), 800, false);
      ctx.fillStyle = COLORS.cream;
      ctx.textAlign = "right";
      ctx.fillText("牌堆", centerX + scale, labelY);
      this.setFont(Math.max(14, 18 * scale), 900, false);
      ctx.fillStyle = COLORS.yellow;
      ctx.textAlign = "left";
      ctx.fillText(String(count ?? 0), centerX + 5 * scale, labelY);
    } else {
      this.setFont(Math.max(11, 11 * scale), 800, false);
      ctx.fillStyle = COLORS.cream;
      ctx.textAlign = "center";
      ctx.fillText("弃牌堆", centerX, labelY);
    }
    ctx.globalAlpha = priorAlpha;
    ctx.restore();
  }

  private drawDrawBurst(rect: Rect, myTurn: boolean, canDraw: boolean, turnsOwed: number, scale: number): void {
    const { ctx } = this;
    const label = !myTurn ? "现在不是你的回合" : !canDraw ? "请先完成当前操作" : turnsOwed > 1 ? "抽牌 · 完成 1 回合" : "抽一张";
    const priorAlpha = ctx.globalAlpha;
    ctx.save();
    if (!canDraw) ctx.globalAlpha = priorAlpha * WAITING_ALPHA;
    burstPath(ctx, rect.x + 4 * scale, rect.y + 4 * scale, rect.width, rect.height);
    ctx.fillStyle = "#000000";
    ctx.fill();
    burstPath(ctx, rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = canDraw ? COLORS.yellow : "#5d5348";
    ctx.fill();
    ctx.fillStyle = canDraw ? COLORS.ink : "#d5c7af";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const collapsed = rect.height < 44;
    if (canDraw && turnsOwed > 1 && collapsed) {
      this.setFont(13, 700, true);
      ctx.fillText("抽牌", centerX, centerY - 7, Math.max(1, rect.width - 14));
      ctx.fillText("完成 1 回合", centerX, centerY + 8, Math.max(1, rect.width - 14));
    } else {
      const activeFontSize = turnsOwed > 1 ? 20 : 26;
      const minimumFontSize = canDraw ? (turnsOwed > 1 ? 15 : 16) : 12;
      this.setFont(Math.max(minimumFontSize, (canDraw ? activeFontSize : 15) * scale), 700, true);
      ctx.fillText(label, centerX, centerY + scale, Math.max(1, rect.width - 14));
    }
    ctx.globalAlpha = priorAlpha;
    ctx.restore();
  }

  private drawHandZone(layout: TableLayout): void {
    const { ctx } = this;
    const { width, height, hand } = this.state;
    const gradient = ctx.createLinearGradient(0, layout.handTop, 0, height);
    gradient.addColorStop(0, "rgba(218, 48, 31, 0)");
    gradient.addColorStop(0.2, COLORS.red);
    gradient.addColorStop(1, COLORS.redDark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, layout.handTop, width, height - layout.handTop);

    ctx.save();
    const dividerOffset = layout.compactDenseHand ? 0 : 27.5 * layout.scale;
    ctx.translate(width / 2, layout.handTop + dividerOffset);
    ctx.rotate(-Math.PI / 180);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(-width / 2 - 2 * layout.scale, -2.5 * layout.scale, width + 4 * layout.scale, 5 * layout.scale);
    ctx.restore();
    this.drawHandCount(layout, hand.length);
  }

  private drawHandCount(layout: TableLayout, count: number): void {
    const { ctx } = this;
    const centerX = this.state.width / 2;
    const baseline = layout.handTop + (layout.compactDenseHand ? 5 : 45) * layout.scale;
    this.setFont(
      layout.compactDenseHand ? Math.max(10, 9 * layout.scale) : Math.max(11, 9 * layout.scale),
      800,
      false,
    );
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.cream;
    ctx.fillText("你的手牌", centerX + 8 * layout.scale, baseline);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.yellow;
    ctx.fillText(String(count), centerX + 13 * layout.scale, baseline);
  }

  private drawCard(slot: CardSlot, dim: boolean): void {
    const { ctx } = this;
    const { x, y, width, height, rotation, card, selected, layoutScale, artworkInset } = slot;
    const originX = x + width / 2;
    const originY = y + height * CARD_ROTATION_ORIGIN;
    const left = -width / 2;
    const top = -height * CARD_ROTATION_ORIGIN;
    const priorAlpha = ctx.globalAlpha;

    ctx.save();
    if (dim) ctx.globalAlpha = priorAlpha * DISABLED_CARD_ALPHA;
    ctx.translate(originX, originY);
    ctx.rotate(rotation);
    ctx.scale(slot.scale, slot.scale);
    if (selected && !slot.hitTarget) {
      ctx.fillStyle = COLORS.yellow;
      roundedRect(ctx, left - 4 * layoutScale, top - 4 * layoutScale, width + 8 * layoutScale, height + 8 * layoutScale, 10 * layoutScale);
      ctx.fill();
    }
    drawOffsetShadow(ctx, left, top, width, height, 4 * layoutScale, 5 * layoutScale, "#000000");

    const inset = artworkInset;
    const image = this.images.get(card.image);
    const filterContext = ctx as CanvasRenderingContext2D & { filter?: string };
    const priorFilter = filterContext.filter;
    ctx.save();
    roundedRect(ctx, left + inset, top + inset, width - inset * 2, height - inset * 2, 5 * layoutScale);
    ctx.clip();
    if (dim && typeof priorFilter === "string") filterContext.filter = "grayscale(70%)";
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(left + inset, top + inset, width - inset * 2, height - inset * 2);
    if (isReady(image)) {
      // Hand cards communicate legal state. Cropping even a small part can
      // remove the identifying illustration or border, so semantic card art
      // is always drawn with its entire source rectangle.
      drawImageContain(ctx, image, left + inset, top + inset, width - inset * 2, height - inset * 2);
    }
    if (typeof priorFilter === "string") filterContext.filter = priorFilter;
    ctx.restore();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3 * layoutScale;
    roundedRect(ctx, left + 1.5 * layoutScale, top + 1.5 * layoutScale, width - 3 * layoutScale, height - 3 * layoutScale, 6.5 * layoutScale);
    ctx.stroke();

    this.setFont(Math.max(8, Math.min(13 * layoutScale, width * 0.18)), 800, true);
    const labelWidth = Math.min(width - 12 * layoutScale, (card.name.length * 13 + 16) * layoutScale);
    const labelHeight = Math.min(24 * layoutScale, Math.max(16 * layoutScale, width * 0.36));
    ctx.fillStyle = COLORS.cream;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2 * layoutScale;
    roundedRect(ctx, left + 5 * layoutScale, top + 5 * layoutScale, labelWidth, labelHeight, 2 * layoutScale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      card.name,
      left + 5 * layoutScale + labelWidth / 2,
      top + 5 * layoutScale + labelHeight / 2,
      Math.max(1, labelWidth - 4 * layoutScale),
    );
    ctx.globalAlpha = priorAlpha;
    if (selected && slot.hitTarget) {
      const selectionInset = DENSE_SELECTION_INSET * layoutScale;
      ctx.strokeStyle = COLORS.yellow;
      ctx.lineWidth = DENSE_SELECTION_LINE_WIDTH * layoutScale;
      ctx.strokeRect(
        left + selectionInset,
        top + selectionInset,
        width - selectionInset * 2,
        height - selectionInset * 2,
      );
    }
    ctx.restore();
  }

  private handSlots(layout = this.tableLayout()): CardSlot[] {
    const { width, height, hand, selectedTokens = [] } = this.state;
    if (hand.length === 0) return [];
    const selected = new Set(selectedTokens);
    // Six cards use two clearly labelled rows except on ultra-short screens,
    // where one compact row keeps every card complete. Denser hands use
    // unrotated rows of at most five. All modes keep painted and hit ownership
    // aligned over a full 44px square even while a card is selected.
    const splitSix = hand.length === 6;
    const denseHand = hand.length > 6 || splitSix;
    const availableHandHeight = Math.max(0, height - layout.handTop);
    const canonicalAspect = CARD_WIDTH / CARD_HEIGHT;
    let cardWidth = CARD_WIDTH * layout.scale;
    let cardHeight = CARD_HEIGHT * layout.scale;
    let denseTopOffset = DENSE_FULL_TOP_OFFSET * layout.scale;
    let denseRowGap = DENSE_ROW_GAP * layout.scale;
    const ultraShortSingleRow = splitSix && layout.ultraShortDenseHand;
    if (denseHand && layout.ultraShortDenseHand) {
      cardWidth = Math.max(
        (ultraShortSingleRow ? ULTRA_SHORT_SIX_CARD_WIDTH : ULTRA_SHORT_DENSE_CARD_WIDTH) * layout.scale,
        MIN_CARD_TOUCH_SIZE + 2 * layout.scale,
      );
      cardHeight = cardWidth / canonicalAspect;
      denseTopOffset = (
        ultraShortSingleRow ? ULTRA_SHORT_SIX_TOP_OFFSET : ULTRA_SHORT_DENSE_TOP_OFFSET
      ) * layout.scale;
      // Larger ultra-short hands retain two reduced rows; the extra reserve
      // keeps their complete frames above the Canvas boundary.
      denseRowGap = 0;
    } else if (denseHand && layout.compactDenseHand) {
      const preferredTop = DENSE_COMPACT_TOP_OFFSET * layout.scale;
      const maximumCardHeight = Math.max(
        MIN_CARD_TOUCH_SIZE / canonicalAspect,
        (availableHandHeight - preferredTop - denseRowGap - 4 * layout.scale) / 2,
      );
      cardHeight = Math.min(CARD_HEIGHT * layout.scale, maximumCardHeight);
      cardWidth = Math.max(COMPACT_DENSE_CARD_WIDTH * layout.scale, cardHeight * canonicalAspect);
      cardHeight = cardWidth / canonicalAspect;
      denseTopOffset = Math.max(
        16 * layout.scale,
        Math.min(
          preferredTop,
          availableHandHeight - cardHeight * 2 - denseRowGap - 4 * layout.scale,
        ),
      );
    }
    const artworkInset = layout.ultraShortDenseHand
      ? layout.scale
      : Math.min(
          3 * layout.scale,
          Math.max(layout.scale, (cardWidth - MIN_CARD_TOUCH_SIZE) / 2),
        );
    const hitInset = Math.min(
      DENSE_HIT_INSET * layout.scale,
      Math.max(0, (cardWidth - MIN_CARD_TOUCH_SIZE) / 2),
    );
    const top = denseHand
      ? layout.handTop + denseTopOffset
      : Math.max(height - 205 * layout.scale, layout.handTop + 65 * layout.scale);
    const rowLengthLimit = ultraShortSingleRow
      ? hand.length
      : splitSix ? SIX_CARD_ROW_LENGTH : DENSE_HAND_ROW_LENGTH;
    const rowCount = denseHand ? Math.ceil(hand.length / rowLengthLimit) : 1;
    const baseRowLength = Math.floor(hand.length / rowCount);
    const longerRows = hand.length % rowCount;
    const rowGap = denseHand ? cardHeight + denseRowGap : 0;
    let handIndex = 0;

    return Array.from({ length: rowCount }, (_, rowIndex) => {
      const rowLength = baseRowLength + (rowIndex < longerRows ? 1 : 0);
      const center = (rowLength - 1) / 2;
      const naturalSpread = rowLength <= 1
        ? 0
        : Math.min(48 * layout.scale, (230 * layout.scale) / (rowLength - 1));
      const splitSixSpread = rowLength <= 1
        ? 0
        : Math.min(
            106 * layout.scale,
            (width - cardWidth - 16 * layout.scale) / (rowLength - 1),
          );
      const spread = splitSix
        ? Math.max(MIN_CARD_TOUCH_SIZE + DENSE_HIT_INSET, splitSixSpread)
        : denseHand
          ? Math.max(MIN_CARD_TOUCH_SIZE + DENSE_HIT_INSET, naturalSpread)
        : naturalSpread;
      const angleStep = Math.min(4, 28 / Math.max(1, rowLength - 1)) * Math.PI / 180;
      const rowStart = handIndex;
      handIndex += rowLength;
      return hand.slice(rowStart, handIndex).map((card, index) => {
        const isSelected = selected.has(card.token);
        const x = width / 2 - cardWidth / 2 + (index - center) * spread;
        const rowTop = top + rowIndex * rowGap;
        return {
          card,
          x,
          y: rowTop - (isSelected && !denseHand ? SELECTED_LIFT * layout.scale : 0),
          width: cardWidth,
          height: cardHeight,
          rotation: denseHand || isSelected ? 0 : (index - center) * angleStep,
          scale: isSelected && !denseHand ? SELECTED_SCALE : 1,
          selected: isSelected,
          layoutScale: layout.scale,
          artworkInset,
          hitTarget: denseHand ? {
            x: index === rowLength - 1
              ? x + cardWidth - hitInset - MIN_CARD_TOUCH_SIZE
              : x + hitInset,
            y: Math.min(
              rowTop + Math.max(
                artworkInset + 2 * layout.scale,
                DENSE_HIT_INSET * layout.scale,
              ),
              height - MIN_CARD_TOUCH_SIZE,
            ),
            width: MIN_CARD_TOUCH_SIZE,
            height: MIN_CARD_TOUCH_SIZE,
          } : undefined,
        };
      });
    }).flat();
  }

  private paintOrder(slots: CardSlot[]): CardSlot[] {
    if (slots.some((slot) => slot.hitTarget)) return slots;
    return [...slots.filter((slot) => !slot.selected), ...slots.filter((slot) => slot.selected)];
  }

  private setFont(size: number, weight: number, display: boolean): void {
    const family = display && this.state.fontFamily ? `"${this.state.fontFamily}"` : "sans-serif";
    this.ctx.font = `${weight} ${size}px ${family}`;
  }
}

function normalizedRenderScale(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function backingSize(logicalSize: number, renderScale: number): number {
  return Math.max(1, Math.round(logicalSize * renderScale));
}

function pointInCard(slot: CardSlot, x: number, y: number): boolean {
  const originX = slot.x + slot.width / 2;
  const originY = slot.y + slot.height * CARD_ROTATION_ORIGIN;
  const dx = x - originX;
  const dy = y - originY;
  const cosine = Math.cos(slot.rotation);
  const sine = Math.sin(slot.rotation);
  const localX = (dx * cosine + dy * sine) / slot.scale + slot.width / 2;
  const localY = (-dx * sine + dy * cosine) / slot.scale + slot.height * CARD_ROTATION_ORIGIN;
  const padding = 4 * slot.layoutScale;
  return localX >= -padding
    && localX <= slot.width + padding
    && localY >= -padding
    && localY <= slot.height + padding;
}

function pointInRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x
    && x < rect.x + rect.width
    && y >= rect.y
    && y < rect.y + rect.height;
}

function isReady(image: HTMLImageElement | undefined): image is HTMLImageElement {
  if (!image) return false;
  return (image.width || image.naturalWidth) > 0 && (image.height || image.naturalHeight) > 0;
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  focalX = 0.5,
  focalY = 0.5,
): void {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  const sourceX = Math.max(0, Math.min(sourceWidth - cropWidth, (sourceWidth - cropWidth) * focalX));
  const sourceY = Math.max(0, Math.min(sourceHeight - cropHeight, (sourceHeight - cropHeight) * focalY));
  ctx.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, x, y, width, height);
}

function burstPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  const points = [
    [0, 0.32], [0.08, 0.27], [0.05, 0.08], [0.21, 0.14], [0.29, 0], [0.38, 0.15],
    [0.53, 0.03], [0.64, 0.16], [0.79, 0.02], [0.84, 0.23], [1, 0.28], [0.93, 0.49],
    [1, 0.71], [0.85, 0.76], [0.82, 1], [0.66, 0.88], [0.54, 1], [0.43, 0.87],
    [0.29, 1], [0.23, 0.82], [0.05, 0.91], [0.08, 0.66], [0, 0.56],
  ] as const;
  ctx.beginPath();
  ctx.moveTo(x + points[0][0] * width, y + points[0][1] * height);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    ctx.lineTo(x + point[0] * width, y + point[1] * height);
  }
  ctx.closePath();
}

function drawOffsetShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x + width, y + offsetY, offsetX, height);
  ctx.fillRect(x + offsetX, y + height, Math.max(0, width - offsetX), offsetY);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}
