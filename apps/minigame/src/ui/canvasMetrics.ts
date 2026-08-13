import type { WxLike } from "../platform";

export const DESIGN_WIDTH = 390;
export const DESIGN_HEIGHT = 844;

type SystemInfo = ReturnType<WxLike["getSystemInfoSync"]>;

export type CanvasMetrics = Readonly<{
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
  backingWidth: number;
  backingHeight: number;
  layoutScale: number;
  renderScale: number;
  viewport: Readonly<{ x: number; y: number; width: number; height: number }>;
  safeInsets: Readonly<{ top: number; right: number; bottom: number; left: number }>;
}>;

export function resolveCanvasMetrics(info: SystemInfo): CanvasMetrics {
  const cssWidth = positive(info.windowWidth, DESIGN_WIDTH);
  const cssHeight = positive(info.windowHeight, DESIGN_HEIGHT);
  const browserRatio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  const pixelRatio = positive(info.pixelRatio, positive(browserRatio, 1));
  const layoutScale = Math.min(cssWidth / DESIGN_WIDTH, cssHeight / DESIGN_HEIGHT);
  const viewportWidth = DESIGN_WIDTH * layoutScale;
  const viewportHeight = DESIGN_HEIGHT * layoutScale;
  const viewport = {
    x: (cssWidth - viewportWidth) / 2,
    y: (cssHeight - viewportHeight) / 2,
    width: viewportWidth,
    height: viewportHeight,
  };
  const safe = safeRect(info.safeArea, cssWidth, cssHeight);

  return {
    cssWidth,
    cssHeight,
    pixelRatio,
    backingWidth: Math.max(1, Math.round(cssWidth * pixelRatio)),
    backingHeight: Math.max(1, Math.round(cssHeight * pixelRatio)),
    layoutScale,
    renderScale: pixelRatio * layoutScale,
    viewport,
    safeInsets: {
      top: overlap(safe.top - viewport.y, viewport.height) / layoutScale,
      right: overlap(viewport.x + viewport.width - safe.right, viewport.width) / layoutScale,
      bottom: overlap(viewport.y + viewport.height - safe.bottom, viewport.height) / layoutScale,
      left: overlap(safe.left - viewport.x, viewport.width) / layoutScale,
    },
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

export function extractCssPoint(event: unknown): { x: number; y: number } | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const changed = Array.isArray(record.changedTouches) ? record.changedTouches[0] as Record<string, unknown> | undefined : undefined;
  const active = Array.isArray(record.touches) ? record.touches[0] as Record<string, unknown> | undefined : undefined;
  const point = changed ?? active ?? record;
  const x = Number(point.pageX ?? point.clientX ?? point.x);
  const y = Number(point.pageY ?? point.clientY ?? point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
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

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function overlap(value: number, maximum: number): number {
  return clamp(value, 0, maximum);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
