import type { WxLike } from "../platform";

export const DESIGN_WIDTH = 390;
export const DESIGN_HEIGHT = 844;

type SystemInfo = ReturnType<WxLike["getSystemInfoSync"]>;

export type Point = Readonly<{ x: number; y: number }>;

export type Rect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}>;

export type CssRect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
  width?: number;
  height?: number;
}>;

export type CanvasMetrics = Readonly<{
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
  backingWidth: number;
  backingHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  layoutScale: number;
  renderScale: number;
  viewport: Readonly<{ x: number; y: number; width: number; height: number }>;
  safeInsets: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  capsuleRect: Rect | null;
}>;

export function resolveCanvasMetrics(info: SystemInfo, capsule?: CssRect | null): CanvasMetrics {
  const cssWidth = positive(info.windowWidth, DESIGN_WIDTH);
  const cssHeight = positive(info.windowHeight, DESIGN_HEIGHT);
  const browserRatio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  const pixelRatio = positive(info.pixelRatio, positive(browserRatio, 1));
  // Mini-game controls must remain physically tappable on short screens. Scale by
  // width only and expose the available height in logical design units instead of
  // uniformly shrinking a fixed 390 x 844 artboard and letterboxing it.
  const layoutScale = cssWidth / DESIGN_WIDTH;
  const logicalHeight = cssHeight / layoutScale;
  const viewport = {
    x: 0,
    y: 0,
    width: cssWidth,
    height: cssHeight,
  };
  const safe = safeRect(info.safeArea, cssWidth, cssHeight);

  return {
    cssWidth,
    cssHeight,
    pixelRatio,
    backingWidth: Math.max(1, Math.round(cssWidth * pixelRatio)),
    backingHeight: Math.max(1, Math.round(cssHeight * pixelRatio)),
    logicalWidth: DESIGN_WIDTH,
    logicalHeight,
    layoutScale,
    renderScale: pixelRatio * layoutScale,
    viewport,
    safeInsets: {
      top: safe.top / layoutScale,
      right: (cssWidth - safe.right) / layoutScale,
      bottom: (cssHeight - safe.bottom) / layoutScale,
      left: safe.left / layoutScale,
    },
    capsuleRect: toLogicalRect(capsule, layoutScale, cssWidth, cssHeight),
  };
}

export function sizeDisplayCanvas(canvas: HTMLCanvasElement, metrics: CanvasMetrics): void {
  if (canvas.width !== metrics.backingWidth) canvas.width = metrics.backingWidth;
  if (canvas.height !== metrics.backingHeight) canvas.height = metrics.backingHeight;
  const style = (canvas as unknown as { style?: { width?: string; height?: string } }).style;
  if (style) {
    style.width = `${metrics.cssWidth}px`;
    style.height = `${metrics.cssHeight}px`;
  }
}

export function applyLayoutTransform(context: CanvasRenderingContext2D, metrics: CanvasMetrics): void {
  context.setTransform(
    metrics.renderScale,
    0,
    0,
    metrics.renderScale,
    metrics.viewport.x * metrics.pixelRatio,
    metrics.viewport.y * metrics.pixelRatio,
  );
}

export function applyCssPixelTransform(context: CanvasRenderingContext2D, metrics: CanvasMetrics): void {
  context.setTransform(metrics.pixelRatio, 0, 0, metrics.pixelRatio, 0, 0);
}

export function extractCssPoint(event: unknown): Point | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const changed = Array.isArray(record.changedTouches) ? record.changedTouches[0] as Record<string, unknown> | undefined : undefined;
  const active = Array.isArray(record.touches) ? record.touches[0] as Record<string, unknown> | undefined : undefined;
  const point = changed ?? active ?? record;
  const x = Number(point.pageX ?? point.clientX ?? point.x);
  const y = Number(point.pageY ?? point.clientY ?? point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function cssPointToDesignPoint(point: Point, metrics: CanvasMetrics): Point {
  return {
    x: (point.x - metrics.viewport.x) / metrics.layoutScale,
    y: (point.y - metrics.viewport.y) / metrics.layoutScale,
  };
}

export function extractDesignPoint(event: unknown, metrics: CanvasMetrics): Point | null {
  const point = extractCssPoint(event);
  return point ? cssPointToDesignPoint(point, metrics) : null;
}

function safeRect(area: SystemInfo["safeArea"], width: number, height: number) {
  if (!area) return { left: 0, top: 0, right: width, bottom: height };
  const left = clamp(finite(area.left, 0), 0, width);
  const top = clamp(finite(area.top, 0), 0, height);
  return {
    left,
    top,
    right: clamp(finite(area.right, width), left, width),
    bottom: clamp(finite(area.bottom, height), top, height),
  };
}

function toLogicalRect(rect: CssRect | null | undefined, scale: number, width: number, height: number): Rect | null {
  if (!rect || ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) return null;
  const left = clamp(rect.left, 0, width);
  const top = clamp(rect.top, 0, height);
  const right = clamp(rect.right, left, width);
  const bottom = clamp(rect.bottom, top, height);
  if (right <= left || bottom <= top) return null;
  return {
    left: left / scale,
    top: top / scale,
    right: right / scale,
    bottom: bottom / scale,
    width: (right - left) / scale,
    height: (bottom - top) / scale,
  };
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
