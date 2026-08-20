type LayoutEngine = typeof import("minigame-canvas-engine")["default"];
type LayoutImageConstructor = typeof import("minigame-canvas-engine")["Image"];
type BaseImageOptions = ConstructorParameters<LayoutImageConstructor>[0];
type RawFitImageOptions = BaseImageOptions & Readonly<Record<string, unknown>>;

export type ImageFit = "contain" | "cover";

export type ImagePosition = Readonly<{
  x: number;
  y: number;
}>;

export type ImageDraw = Readonly<{
  source: Readonly<{ x: number; y: number; width: number; height: number }>;
  destination: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

/**
 * `minigame-canvas-engine` only supports stretching, nine-slicing and tiling.
 * This extension adds browser-like contain/cover drawing without bypassing the
 * engine's transform, rounded clipping, background or border behaviour.
 *
 * Template usage:
 * `<fitimage src="assets/cat-cast.png" data-fit="contain" data-position="center bottom" />`
 */
export function createFitImageClass(BaseImage: LayoutImageConstructor) {
  return class FitImage extends BaseImage {
    private readonly fit: ImageFit;
    private readonly position: ImagePosition;

    constructor(options: RawFitImageOptions) {
      super(options);
      const attributes = options as Readonly<Record<string, unknown>>;
      const dataset = (options.dataset ?? {}) as Readonly<Record<string, unknown>>;
      this.fit = normalizeFit(attributes.fit ?? dataset.fit);
      const shorthand = parsePosition(attributes.position ?? dataset.position);
      this.position = {
        x: parseAxis(
          attributes.positionX ?? attributes["position-x"] ?? dataset.positionX ?? dataset["position-x"],
          "x",
          shorthand.x,
        ),
        y: parseAxis(
          attributes.positionY ?? attributes["position-y"] ?? dataset.positionY ?? dataset["position-y"],
          "y",
          shorthand.y,
        ),
      };
      this.type = "FitImage";
    }

    render(): void {
      const image = this.img;
      const context = this.ctx;
      if (!image || !image.complete || !context || image.width <= 0 || image.height <= 0) return;

      context.save();
      const { needStroke, needClip, originX, originY, drawX, drawY, width, height } = this.baseRender();
      const draw = resolveImageDraw(
        image.width,
        image.height,
        drawX - originX,
        drawY - originY,
        width,
        height,
        this.fit,
        this.position,
      );
      context.drawImage(
        image,
        draw.source.x,
        draw.source.y,
        draw.source.width,
        draw.source.height,
        draw.destination.x,
        draw.destination.y,
        draw.destination.width,
        draw.destination.height,
      );
      if (needClip) this.renderBorder(context, originX, originY);
      if (needStroke) context.stroke();
      context.translate(-originX, -originY);
      context.restore();
    }
  };
}

const registeredLayouts = new WeakSet<object>();

export function registerFitImage(layout: Pick<LayoutEngine, "Image" | "registerComponent">): void {
  if (registeredLayouts.has(layout)) return;
  layout.registerComponent("fitimage", createFitImageClass(layout.Image));
  registeredLayouts.add(layout);
}

export function resolveImageDraw(
  sourceWidth: number,
  sourceHeight: number,
  destinationX: number,
  destinationY: number,
  destinationWidth: number,
  destinationHeight: number,
  fit: ImageFit,
  position: ImagePosition = { x: 0.5, y: 0.5 },
): ImageDraw {
  const source = {
    width: positive(sourceWidth),
    height: positive(sourceHeight),
  };
  const destination = {
    x: finite(destinationX),
    y: finite(destinationY),
    width: positive(destinationWidth),
    height: positive(destinationHeight),
  };
  const x = clamp(position.x);
  const y = clamp(position.y);

  if (fit === "cover") {
    const sourceRatio = source.width / source.height;
    const destinationRatio = destination.width / destination.height;
    if (sourceRatio > destinationRatio) {
      const width = source.height * destinationRatio;
      return {
        source: { x: (source.width - width) * x, y: 0, width, height: source.height },
        destination,
      };
    }
    const height = source.width / destinationRatio;
    return {
      source: { x: 0, y: (source.height - height) * y, width: source.width, height },
      destination,
    };
  }

  const scale = Math.min(destination.width / source.width, destination.height / source.height);
  const width = Math.min(destination.width, source.width * scale);
  const height = Math.min(destination.height, source.height * scale);
  return {
    source: { x: 0, y: 0, width: source.width, height: source.height },
    destination: {
      x: destination.x + (destination.width - width) * x,
      y: destination.y + (destination.height - height) * y,
      width,
      height,
    },
  };
}

function normalizeFit(value: unknown): ImageFit {
  return String(value ?? "contain").toLowerCase() === "cover" ? "cover" : "contain";
}

function parsePosition(value: unknown): ImagePosition {
  const tokens = String(value ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { x: 0.5, y: 0.5 };
  if (tokens.length === 1) {
    const token = tokens[0]!;
    const vertical = axisKeyword(token, "y");
    return vertical === null
      ? { x: parseAxis(token, "x", 0.5), y: 0.5 }
      : { x: 0.5, y: vertical };
  }

  const first = tokens[0]!;
  const second = tokens[1]!;
  const firstVertical = axisKeyword(first, "y");
  const secondHorizontal = axisKeyword(second, "x");
  if (firstVertical !== null && secondHorizontal !== null) {
    return { x: secondHorizontal, y: firstVertical };
  }
  return {
    x: parseAxis(first, "x", 0.5),
    y: parseAxis(second, "y", 0.5),
  };
}

function parseAxis(value: unknown, axis: "x" | "y", fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  const keyword = axisKeyword(normalized, axis);
  if (keyword !== null) return keyword;
  if (normalized.endsWith("%")) {
    const percentage = Number.parseFloat(normalized.slice(0, -1));
    return Number.isFinite(percentage) ? clamp(percentage / 100) : fallback;
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(numeric > 1 ? numeric / 100 : numeric);
}

function axisKeyword(value: string, axis: "x" | "y"): number | null {
  if (value === "center") return 0.5;
  if (axis === "x" && value === "left") return 0;
  if (axis === "x" && value === "right") return 1;
  if (axis === "y" && value === "top") return 0;
  if (axis === "y" && value === "bottom") return 1;
  return null;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
