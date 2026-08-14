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
const MIN_HAND_VISIBLE = 120;
const CARD_WIDTH = 126;
const CARD_HEIGHT = 236;
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
  deckCount: number;
  discard?: CardModel;
  hand: readonly CardModel[];
  players: readonly PlayerModel[];
  myTurn: boolean;
  turnsOwed: number;
  selectedTokens?: readonly string[];
  fontFamily?: string;
}>;

type TableLayout = Readonly<{
  scale: number;
  tableScale: number;
  handTop: number;
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
}>;

export class CardTableSurface {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private state: TableSurfaceState;
  private readonly images = new Map<string, HTMLImageElement>();

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
    this.resize(state.width, state.height);
    this.preload(state);
    this.draw();
  }

  get element(): HTMLCanvasElement { return this.canvas; }

  update(state: TableSurfaceState): void {
    this.state = state;
    if (this.canvas.width !== state.width || this.canvas.height !== state.height) this.resize(state.width, state.height);
    this.preload(state);
    this.draw();
  }

  cardAt(x: number, y: number): CardModel | null {
    if (!this.state.myTurn) return null;
    const slots = this.paintOrder(this.handSlots());
    for (let index = slots.length - 1; index >= 0; index -= 1) {
      const slot = slots[index]!;
      if (!pointInCard(slot, x, y)) continue;
      return slot.card.playable ? slot.card : null;
    }
    return null;
  }

  private resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private preload(state: TableSurfaceState): void {
    if (!this.createImage) return;
    const sources = [BACKGROUND, CARD_BACK, state.discard?.image, ...state.hand.map((card) => card.image)]
      .filter((value): value is string => Boolean(value));
    for (const source of new Set(sources)) {
      if (this.images.has(source)) continue;
      const image = this.createImage();
      image.onload = () => this.draw();
      image.src = source;
      this.images.set(source, image);
    }
  }

  private draw(): void {
    const { ctx } = this;
    const { width, height, deckCount, discard, myTurn, turnsOwed } = this.state;
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
    this.drawPile(layout.drawPile, CARD_BACK, "draw", deckCount, !myTurn, layout.tableScale, layout.pileLabelGap);
    this.drawPile(layout.discardPile, discard?.image, "discard", undefined, false, layout.tableScale, layout.pileLabelGap);
    this.drawDrawBurst(layout.drawBurst, myTurn, turnsOwed, layout.tableScale);
    this.drawHandZone(layout);

    for (const slot of this.paintOrder(this.handSlots(layout))) this.drawCard(slot, !myTurn || !slot.card.playable);
  }

  private tableLayout(): TableLayout {
    const { width, height } = this.state;
    const scale = Math.max(0, width / REFERENCE_WIDTH);
    const compactTableHeight = COMPACT_TABLE_HEIGHT * scale;
    const referenceTableHeight = (REFERENCE_HEIGHT - HAND_HEIGHT) * scale;
    const naturalHandTop = height - HAND_HEIGHT * scale;
    const latestHandTop = Math.max(0, height - MIN_HAND_VISIBLE * scale);
    const handTop = Math.max(0, Math.min(Math.max(naturalHandTop, compactTableHeight), latestHandTop));

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
      pileLabelGap = 17 * tableScale;
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
    const burstWidth = 195 * tableScale;
    const burstHeight = 59 * tableScale;

    return {
      scale,
      tableScale,
      handTop,
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
        y: burstY,
        width: burstWidth,
        height: burstHeight,
      },
    };
  }

  private drawTurnBanner(rect: Rect, myTurn: boolean, turnsOwed: number, scale: number): void {
    const { ctx } = this;
    const label = myTurn ? (turnsOwed > 1 ? `你还欠 ${turnsOwed} 个回合！` : "轮到你了") : "等待其他玩家行动…";
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
    this.setFont(25 * scale, 900, true);
    ctx.fillStyle = COLORS.cream;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
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

    const inset = 4 * scale;
    const image = source ? this.images.get(source) : undefined;
    const filterContext = ctx as CanvasRenderingContext2D & { filter?: string };
    const priorFilter = filterContext.filter;
    ctx.save();
    roundedRect(ctx, rect.x + inset, rect.y + inset, rect.width - inset * 2, rect.height - inset * 2, 5 * scale);
    ctx.clip();
    if (dim && typeof priorFilter === "string") filterContext.filter = "grayscale(70%)";
    if (kind === "draw" && dim) ctx.globalAlpha = priorAlpha * DIMMED_DRAW_IMAGE_ALPHA;
    if (isReady(image)) drawImageCover(ctx, image, rect.x + inset, rect.y + inset, rect.width - inset * 2, rect.height - inset * 2);
    else {
      ctx.fillStyle = kind === "draw" ? COLORS.redDark : COLORS.ink;
      ctx.fillRect(rect.x + inset, rect.y + inset, rect.width - inset * 2, rect.height - inset * 2);
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
      this.setFont(11 * scale, 800, false);
      ctx.fillStyle = COLORS.cream;
      ctx.textAlign = "right";
      ctx.fillText("牌堆", centerX + scale, labelY);
      this.setFont(18 * scale, 900, false);
      ctx.fillStyle = COLORS.yellow;
      ctx.textAlign = "left";
      ctx.fillText(String(count ?? 0), centerX + 5 * scale, labelY);
    } else {
      this.setFont(11 * scale, 800, false);
      ctx.fillStyle = COLORS.cream;
      ctx.textAlign = "center";
      ctx.fillText("弃牌堆", centerX, labelY);
    }
    ctx.globalAlpha = priorAlpha;
    ctx.restore();
  }

  private drawDrawBurst(rect: Rect, myTurn: boolean, turnsOwed: number, scale: number): void {
    const { ctx } = this;
    const label = !myTurn ? "现在不是你的回合" : turnsOwed > 1 ? "抽牌 · 完成 1 回合" : "抽一张";
    const priorAlpha = ctx.globalAlpha;
    ctx.save();
    if (!myTurn) ctx.globalAlpha = priorAlpha * WAITING_ALPHA;
    burstPath(ctx, rect.x + 4 * scale, rect.y + 4 * scale, rect.width, rect.height);
    ctx.fillStyle = "#000000";
    ctx.fill();
    burstPath(ctx, rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = myTurn ? COLORS.yellow : "#5d5348";
    ctx.fill();
    this.setFont((myTurn ? 26 : 15) * scale, 700, true);
    ctx.fillStyle = myTurn ? COLORS.ink : "#d5c7af";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2 + scale);
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
    ctx.translate(width / 2, layout.handTop + 27.5 * layout.scale);
    ctx.rotate(-Math.PI / 180);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(-width / 2 - 2 * layout.scale, -2.5 * layout.scale, width + 4 * layout.scale, 5 * layout.scale);
    ctx.restore();
    this.drawHandCount(layout, hand.length);
  }

  private drawHandCount(layout: TableLayout, count: number): void {
    const { ctx } = this;
    const centerX = this.state.width / 2;
    const baseline = layout.handTop + 45 * layout.scale;
    this.setFont(9 * layout.scale, 800, false);
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
    const { x, y, width, height, rotation, card, selected, layoutScale } = slot;
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
    if (selected) {
      ctx.fillStyle = COLORS.yellow;
      roundedRect(ctx, left - 4 * layoutScale, top - 4 * layoutScale, width + 8 * layoutScale, height + 8 * layoutScale, 10 * layoutScale);
      ctx.fill();
    }
    drawOffsetShadow(ctx, left, top, width, height, 4 * layoutScale, 5 * layoutScale, "#000000");

    const inset = 3 * layoutScale;
    const image = this.images.get(card.image);
    const filterContext = ctx as CanvasRenderingContext2D & { filter?: string };
    const priorFilter = filterContext.filter;
    ctx.save();
    roundedRect(ctx, left + inset, top + inset, width - inset * 2, height - inset * 2, 5 * layoutScale);
    ctx.clip();
    if (dim && typeof priorFilter === "string") filterContext.filter = "grayscale(70%)";
    if (isReady(image)) drawImageCover(ctx, image, left + inset, top + inset, width - inset * 2, height - inset * 2, 0.5, 0.5);
    else {
      ctx.fillStyle = COLORS.cream;
      ctx.fillRect(left + inset, top + inset, width - inset * 2, height - inset * 2);
    }
    if (typeof priorFilter === "string") filterContext.filter = priorFilter;
    ctx.restore();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3 * layoutScale;
    roundedRect(ctx, left + 1.5 * layoutScale, top + 1.5 * layoutScale, width - 3 * layoutScale, height - 3 * layoutScale, 6.5 * layoutScale);
    ctx.stroke();

    this.setFont(13 * layoutScale, 800, true);
    const labelWidth = Math.min(width - 12 * layoutScale, (card.name.length * 13 + 16) * layoutScale);
    const labelHeight = 24 * layoutScale;
    ctx.fillStyle = COLORS.cream;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2 * layoutScale;
    roundedRect(ctx, left + 5 * layoutScale, top + 5 * layoutScale, labelWidth, labelHeight, 2 * layoutScale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(card.name, left + 5 * layoutScale + labelWidth / 2, top + 5 * layoutScale + labelHeight / 2);
    ctx.globalAlpha = priorAlpha;
    ctx.restore();
  }

  private handSlots(layout = this.tableLayout()): CardSlot[] {
    const { width, height, hand, selectedTokens = [] } = this.state;
    if (hand.length === 0) return [];
    const selected = new Set(selectedTokens);
    const cardWidth = CARD_WIDTH * layout.scale;
    const cardHeight = CARD_HEIGHT * layout.scale;
    const center = (hand.length - 1) / 2;
    const spread = Math.min(48 * layout.scale, (230 * layout.scale) / Math.max(1, hand.length - 1));
    const angleStep = Math.min(4, 28 / Math.max(1, hand.length - 1)) * Math.PI / 180;
    const top = Math.max(height - 205 * layout.scale, layout.handTop + 65 * layout.scale);
    return hand.map((card, index) => {
      const isSelected = selected.has(card.token);
      return {
        card,
        x: width / 2 - cardWidth / 2 + (index - center) * spread,
        y: top - (isSelected ? SELECTED_LIFT * layout.scale : 0),
        width: cardWidth,
        height: cardHeight,
        rotation: isSelected ? 0 : (index - center) * angleStep,
        scale: isSelected ? SELECTED_SCALE : 1,
        selected: isSelected,
        layoutScale: layout.scale,
      };
    });
  }

  private paintOrder(slots: CardSlot[]): CardSlot[] {
    return [...slots.filter((slot) => !slot.selected), ...slots.filter((slot) => slot.selected)];
  }

  private setFont(size: number, weight: number, display: boolean): void {
    const family = display && this.state.fontFamily ? `"${this.state.fontFamily}"` : "sans-serif";
    this.ctx.font = `${weight} ${size}px ${family}`;
  }
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

function isReady(image: HTMLImageElement | undefined): image is HTMLImageElement {
  if (!image) return false;
  return (image.width || image.naturalWidth) > 0 && (image.height || image.naturalHeight) > 0;
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
