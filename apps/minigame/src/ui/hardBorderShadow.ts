type BorderStyle = Readonly<{
  borderWidth?: unknown;
  borderRightWidth?: unknown;
  borderBottomWidth?: unknown;
  borderColor?: unknown;
  borderRightColor?: unknown;
  borderBottomColor?: unknown;
  hardShadowColor?: unknown;
}>;

type LayoutBox = Readonly<{
  absoluteX: number;
  absoluteY: number;
  width: number;
  height: number;
}>;

type ShadowElement = {
  style: BorderStyle;
  layoutBox: LayoutBox;
  baseRender(type?: string): unknown;
  renderBorder(ctx: CanvasRenderingContext2D, originX?: number, originY?: number): unknown;
};

type ElementConstructor = Readonly<{
  prototype: ShadowElement;
}>;

type ShadowState = {
  depth: number;
  painted: boolean;
};

const installed = new WeakSet<object>();
const active = new WeakMap<ShadowElement, ShadowState>();

/**
 * The layout engine lays out per-side border widths but renders only the
 * uniform borderWidth. Scheme 1 uses the extra right/bottom width as a hard
 * comic-book shadow, so draw those exposed strips while baseRender's
 * rotate/scale transform is active. The hook is deliberately scoped to the
 * first renderBorder call inside baseRender: Image/FitImage call renderBorder
 * again after drawing their bitmap and must not paint a second shadow on top.
 */
export function installHardBorderShadow(layout: Readonly<{ Element: ElementConstructor }>): void {
  const prototype = layout.Element.prototype;
  if (installed.has(prototype)) return;

  const originalBaseRender = prototype.baseRender;
  const originalRenderBorder = prototype.renderBorder;

  prototype.baseRender = function patchedBaseRender(this: ShadowElement, type?: string): unknown {
    const current = active.get(this);
    if (current) current.depth += 1;
    else active.set(this, { depth: 1, painted: false });

    try {
      return originalBaseRender.call(this, type);
    } finally {
      const state = active.get(this);
      if (state && state.depth > 1) state.depth -= 1;
      else active.delete(this);
    }
  };

  prototype.renderBorder = function patchedRenderBorder(
    this: ShadowElement,
    ctx: CanvasRenderingContext2D,
    originX = 0,
    originY = 0,
  ): unknown {
    const state = active.get(this);
    if (state && !state.painted) {
      state.painted = true;
      drawHardBorderShadow(ctx, this.style, this.layoutBox, originX, originY);
    }
    return originalRenderBorder.call(this, ctx, originX, originY);
  };

  installed.add(prototype);
}

export function drawHardBorderShadow(
  ctx: CanvasRenderingContext2D,
  style: BorderStyle,
  box: LayoutBox,
  originX = 0,
  originY = 0,
): void {
  const base = nonNegative(style.borderWidth);
  const dx = Math.max(0, nonNegative(style.borderRightWidth, base) - base);
  const dy = Math.max(0, nonNegative(style.borderBottomWidth, base) - base);
  if ((dx === 0 && dy === 0) || !validBox(box)) return;

  const x = box.absoluteX - finite(originX);
  const y = box.absoluteY - finite(originY);
  const color = firstColor(
    style.hardShadowColor,
    style.borderColor,
    style.borderRightColor,
    style.borderBottomColor,
  );

  ctx.save();
  try {
    ctx.fillStyle = color;
    // These are only the portions of a translated rectangle that sit outside
    // the original box. Avoiding the overlapped centre keeps translucent cards
    // and panels from becoming muddy, and avoiding strip overlap keeps alpha
    // uniform at the bottom-right corner.
    if (dx > 0 && box.height > dy) ctx.fillRect(x + box.width, y + dy, dx, box.height - dy);
    if (dy > 0) ctx.fillRect(x + dx, y + box.height, box.width, dy);
  } finally {
    ctx.restore();
    // Canvas paths are not part of save/restore state. Leave the upstream
    // border renderer a clean path even if a custom context changes fillRect.
    ctx.beginPath();
  }
}

function nonNegative(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function validBox(box: LayoutBox): boolean {
  return Number.isFinite(box.absoluteX)
    && Number.isFinite(box.absoluteY)
    && Number.isFinite(box.width)
    && Number.isFinite(box.height)
    && box.width > 0
    && box.height > 0;
}

function firstColor(...values: readonly unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? "#000000";
}
