import type { CardModel, PlayerModel } from "./model";

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
}>;

export class CardTableSurface {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private state: TableSurfaceState;
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(createCanvas: () => HTMLCanvasElement, createImage: (() => HTMLImageElement) | undefined, state: TableSurfaceState) {
    this.canvas = createCanvas();
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_2D_UNAVAILABLE");
    this.ctx = context;
    this.state = state;
    this.resize(state.width, state.height);
    if (createImage) this.preload(createImage, state);
    this.draw();
  }

  get element(): HTMLCanvasElement { return this.canvas; }

  update(state: TableSurfaceState): void {
    this.state = state;
    if (this.canvas.width !== state.width || this.canvas.height !== state.height) this.resize(state.width, state.height);
    this.draw();
  }

  cardAt(x: number, y: number): CardModel | null {
    const { hand, height, width } = this.state;
    if (y < height - 145 || hand.length === 0) return null;
    const spread = Math.min(48, (width - 80) / Math.max(1, hand.length - 1));
    const firstX = width / 2 - ((hand.length - 1) * spread) / 2 - 38;
    for (let index = hand.length - 1; index >= 0; index -= 1) {
      const card = hand[index]!;
      const cardX = firstX + index * spread;
      if (x >= cardX && x <= cardX + 76) return card;
    }
    return null;
  }

  private resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private preload(createImage: () => HTMLImageElement, state: TableSurfaceState): void {
    const sources = ["assets/cards/card-back.png", state.discard?.image, ...state.hand.map((card) => card.image)].filter((value): value is string => Boolean(value));
    for (const source of new Set(sources)) {
      const image = createImage();
      image.onload = () => this.draw();
      image.src = source;
      this.images.set(source, image);
    }
  }

  private draw(): void {
    const { ctx } = this;
    const { width, height, hand, deckCount, discard, myTurn, turnsOwed, selectedTokens = [] } = this.state;
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#24211f");
    gradient.addColorStop(1, "#151312");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,225,26,.18)";
    ctx.lineWidth = 1;
    for (let x = -height; x < width; x += 18) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height, height); ctx.stroke();
    }

    ctx.fillStyle = myTurn ? "#ffe11a" : "#fff1c8";
    ctx.font = "900 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(myTurn ? (turnsOwed > 1 ? `你还欠 ${turnsOwed} 个回合！` : "轮到你了") : "等待其他玩家行动…", width / 2, 44);

    this.card(76, 92, 86, 116, "assets/cards/card-back.png", `牌堆 ${deckCount}`, -0.04);
    this.card(width - 162, 92, 86, 116, discard?.image, discard?.name ?? "弃牌堆", 0.04);

    const spread = Math.min(48, (width - 80) / Math.max(1, hand.length - 1));
    const firstX = width / 2 - ((hand.length - 1) * spread) / 2 - 38;
    hand.forEach((card, index) => {
      const center = (hand.length - 1) / 2;
      const angle = (index - center) * 0.065;
      const selected = selectedTokens.includes(card.token);
      this.card(firstX + index * spread, height - 132 - (selected ? 18 : 0), 76, 104, card.image, card.name, angle, selected);
    });
  }

  private card(x: number, y: number, width: number, height: number, source: string | undefined, label: string, rotation = 0, selected = false): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(rotation);
    ctx.fillStyle = selected ? "#00b8c4" : "#fff1c8";
    ctx.strokeStyle = "#0f0e0d";
    ctx.lineWidth = selected ? 5 : 3;
    roundedRect(ctx, -width / 2, -height / 2, width, height, 7);
    ctx.fill(); ctx.stroke();
    const image = source ? this.images.get(source) : undefined;
    if (image && image.width > 0) {
      ctx.save();
      roundedRect(ctx, -width / 2 + 4, -height / 2 + 4, width - 8, height - 28, 4);
      ctx.clip();
      ctx.drawImage(image, -width / 2 + 4, -height / 2 + 4, width - 8, height - 28);
      ctx.restore();
    } else {
      ctx.fillStyle = source?.includes("card-back") ? "#ef3d2b" : "#ffe11a";
      ctx.fillRect(-width / 2 + 6, -height / 2 + 6, width - 12, height - 32);
      ctx.fillStyle = "#171514";
      ctx.font = "900 18px sans-serif";
      ctx.fillText(source?.includes("card-back") ? "?" : "!", 0, 0);
    }
    ctx.fillStyle = "#171514";
    ctx.font = "900 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, height / 2 - 8);
    ctx.restore();
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
