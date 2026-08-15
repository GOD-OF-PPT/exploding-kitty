import { CAPTURE_DPRS, type CaptureDpr } from "./capturePlan";
import type { ViewportProfile } from "./viewports";

const DESIGN_WIDTH = 390;

export type CaptureCanvasConfiguration = Readonly<{
  renderDpr: CaptureDpr;
  designScale: number;
  backingScale: number;
  intrinsic: Readonly<{ width: number; height: number }>;
}>;

export function parseCaptureDpr(value: string | null, mode: "canvas" | "compare"): CaptureDpr {
  const normalized = value === null || value === "" ? "1" : value;
  const renderDpr = Number(normalized);
  if (!CAPTURE_DPRS.includes(renderDpr as CaptureDpr) || String(renderDpr) !== normalized) {
    throw new Error(`VISUAL_PREVIEW_RENDER_DPR_UNKNOWN:${normalized}`);
  }
  if (mode === "compare" && renderDpr !== 1) {
    throw new Error(`VISUAL_PREVIEW_COMPARISON_DPR_INVALID:${renderDpr}`);
  }
  return renderDpr as CaptureDpr;
}

export function configureCaptureCanvas(
  canvas: Pick<HTMLCanvasElement, "width" | "height" | "style">,
  viewport: ViewportProfile,
  renderDpr: CaptureDpr,
): CaptureCanvasConfiguration {
  if (!CAPTURE_DPRS.includes(renderDpr)) {
    throw new Error(`VISUAL_PREVIEW_RENDER_DPR_INVALID:${String(renderDpr)}`);
  }
  const designScale = viewport.width / DESIGN_WIDTH;
  const intrinsic = {
    width: viewport.width * renderDpr,
    height: viewport.height * renderDpr,
  };
  canvas.width = intrinsic.width;
  canvas.height = intrinsic.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  return {
    renderDpr,
    designScale,
    backingScale: designScale * renderDpr,
    intrinsic,
  };
}
