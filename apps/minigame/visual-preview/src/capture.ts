import {
  CAPTURE_METHOD,
  CAPTURE_DPRS,
  type CaptureDpr,
  type CaptureState,
  type ScrollCaptureMetadata,
} from "./capturePlan";
import type { ViewportProfile } from "./viewports";

export type CaptureContext = Readonly<{
  screen: string;
  viewport: string;
  mode: "canvas" | "compare";
  renderViewport: ViewportProfile;
  renderDpr: CaptureDpr;
  comparisonSource?: "live-canvas" | "accepted-current-png";
  captureState: CaptureState;
  scroll?: ScrollCaptureMetadata;
}>;

export type StableCanvasOptions = Readonly<{
  timeoutMs?: number;
  requiredStableSamples?: number;
  framesBetweenSamples?: number;
}>;

export type CanvasCaptureRecord = Readonly<{
  schemaVersion: 2;
  screen: string;
  viewport: string;
  mode: "canvas" | "compare";
  selector: string;
  intrinsic: Readonly<{ width: number; height: number }>;
  domRect: Readonly<{
    x: number;
    y: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
  }>;
  browserViewport: Readonly<{
    innerWidth: number;
    innerHeight: number;
    devicePixelRatio: number;
    visualWidth: number | null;
    visualHeight: number | null;
    visualScale: number | null;
  }>;
  renderViewport: ViewportProfile;
  renderDpr: CaptureDpr;
  hashAlgorithm: "SHA-256";
  hashScope: "canvas-rgba8-row-major";
  pixelHash: string;
  sampledHashes: readonly string[];
  stableSamples: number;
  captureMethod: typeof CAPTURE_METHOD;
  comparisonSource?: "live-canvas" | "accepted-current-png";
  captureState: CaptureState;
  scroll?: ScrollCaptureMetadata;
}>;

export type StablePngCapture = Readonly<{
  dataUrl: string;
  pngByteSha256: string;
  record: CanvasCaptureRecord;
}>;

export async function captureStablePng(
  selector: string,
  captureContext: CaptureContext,
  options: StableCanvasOptions = {},
): Promise<StablePngCapture> {
  const record = await waitForStableCanvas(selector, captureContext, options);
  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  if (!canvas) throw new Error(`VISUAL_PREVIEW_CAPTURE_SELECTOR_MISSING:${selector}`);
  const dataUrl = canvas.toDataURL("image/png");
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("VISUAL_PREVIEW_CAPTURE_NOT_PNG");
  }
  const exportedPixelHash = await hashCanvasPixels(canvas);
  if (exportedPixelHash !== record.pixelHash) {
    throw new Error(`VISUAL_PREVIEW_CANVAS_CHANGED_DURING_EXPORT:${record.pixelHash}:${exportedPixelHash}`);
  }
  return {
    dataUrl,
    pngByteSha256: await hashResourceBytes(dataUrl),
    record,
  };
}

export async function waitForStableCanvas(
  selector: string,
  captureContext: CaptureContext,
  options: StableCanvasOptions = {},
): Promise<CanvasCaptureRecord> {
  validateCaptureContext(captureContext);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const requiredStableSamples = options.requiredStableSamples ?? 3;
  const framesBetweenSamples = options.framesBetweenSamples ?? 6;
  if (requiredStableSamples < 2) throw new Error("VISUAL_PREVIEW_STABLE_SAMPLES_TOO_LOW");
  await waitForPreviewReady(timeoutMs);

  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  if (!canvas) throw new Error(`VISUAL_PREVIEW_CAPTURE_SELECTOR_MISSING:${selector}`);
  const deadline = performance.now() + timeoutMs;
  const sampledHashes: string[] = [];
  let previousHash: string | undefined;
  let matchingSamples = 0;

  while (performance.now() <= deadline) {
    await animationFrames(framesBetweenSamples);
    const hash = await hashCanvasPixels(canvas);
    sampledHashes.push(hash);
    matchingSamples = hash === previousHash ? matchingSamples + 1 : 1;
    previousHash = hash;
    if (matchingSamples >= requiredStableSamples) {
      return captureRecord(canvas, selector, captureContext, hash, sampledHashes, matchingSamples);
    }
  }

  throw new Error(
    `VISUAL_PREVIEW_CANVAS_UNSTABLE:${selector}:${sampledHashes.slice(-4).join(",")}`,
  );
}

export async function waitForPreviewReady(timeoutMs = 15_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    if (document.documentElement.dataset.ready === "error") {
      throw new Error("VISUAL_PREVIEW_READY_ERROR");
    }
    if (window.__VISUAL_PREVIEW_READY__ === true && document.documentElement.dataset.ready === "true") {
      await document.fonts.ready;
      return;
    }
    await animationFrames(1);
  }
  throw new Error("VISUAL_PREVIEW_READY_TIMEOUT");
}

export function validateCaptureContext(context: CaptureContext): void {
  if (!CAPTURE_DPRS.includes(context.renderDpr)) {
    throw new Error(`VISUAL_PREVIEW_RENDER_DPR_INVALID:${String(context.renderDpr)}`);
  }
  if (context.mode === "compare" && context.renderDpr !== 1) {
    throw new Error(`VISUAL_PREVIEW_COMPARISON_DPR_INVALID:${context.renderDpr}`);
  }
  if (context.mode === "compare" && context.captureState !== "initial") {
    throw new Error(`VISUAL_PREVIEW_COMPARISON_STATE_INVALID:${String(context.captureState)}`);
  }
  if (context.captureState === "initial") {
    if (context.scroll !== undefined) {
      throw new Error("VISUAL_PREVIEW_INITIAL_SCROLL_METADATA_FORBIDDEN");
    }
    return;
  }
  if (context.captureState !== "scroll-end") {
    throw new Error(`VISUAL_PREVIEW_CAPTURE_STATE_UNKNOWN:${String(context.captureState)}`);
  }
  if (!context.scroll) throw new Error("VISUAL_PREVIEW_SCROLL_METADATA_REQUIRED");
  const {
    selector,
    coordinateSpace,
    viewportHeight,
    contentHeight,
    maxScrollTop,
    scrollTop,
  } = context.scroll;
  const expectedMax = contentHeight - viewportHeight;
  if (
    selector !== "#scene-scroll"
    || coordinateSpace !== "renderer-logical-px"
    || !Number.isFinite(viewportHeight)
    || !Number.isFinite(contentHeight)
    || !Number.isFinite(maxScrollTop)
    || !Number.isFinite(scrollTop)
    || viewportHeight <= 0
    || contentHeight <= viewportHeight
    || maxScrollTop <= 0
    || scrollTop <= 0
    || Math.abs(maxScrollTop - expectedMax) > 0.01
    || Math.abs(scrollTop - maxScrollTop) > 0.01
  ) throw new Error("VISUAL_PREVIEW_SCROLL_METADATA_INVALID");
}

export async function hashCanvasPixels(
  canvas: HTMLCanvasElement,
  region?: Readonly<{ x: number; y: number; width: number; height: number }>,
): Promise<string> {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("VISUAL_PREVIEW_CAPTURE_CONTEXT_MISSING");
  const target = region ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  if (
    target.width <= 0
    || target.height <= 0
    || target.x < 0
    || target.y < 0
    || target.x + target.width > canvas.width
    || target.y + target.height > canvas.height
  ) throw new Error("VISUAL_PREVIEW_CAPTURE_REGION_INVALID");
  const pixels = context.getImageData(target.x, target.y, target.width, target.height).data;
  return sha256Hex(pixels);
}

export async function hashImagePixels(image: HTMLImageElement): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("VISUAL_PREVIEW_IMAGE_HASH_CONTEXT_MISSING");
  context.drawImage(image, 0, 0);
  return hashCanvasPixels(canvas);
}

export async function hashResourceBytes(source: string): Promise<string> {
  if (source.startsWith("data:")) {
    const comma = source.indexOf(",");
    if (comma < 0 || !/;base64$/u.test(source.slice(0, comma))) {
      throw new Error("VISUAL_PREVIEW_CURRENT_PNG_DATA_URL_INVALID");
    }
    const binary = atob(source.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return sha256Hex(bytes);
  }
  if (typeof fetch !== "function") throw new Error("VISUAL_PREVIEW_CURRENT_PNG_FETCH_UNAVAILABLE");
  const response = await fetch(source);
  if (!response.ok) throw new Error(`VISUAL_PREVIEW_CURRENT_PNG_FETCH_FAILED:${response.status}`);
  return sha256Hex(new Uint8Array(await response.arrayBuffer()));
}

export function loadCaptureImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("VISUAL_PREVIEW_CURRENT_PNG_DECODE_FAILED")),
      { once: true },
    );
    image.src = source;
  });
}

async function sha256Hex(bytes: Uint8Array | Uint8ClampedArray): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function captureRecord(
  canvas: HTMLCanvasElement,
  selector: string,
  context: CaptureContext,
  pixelHash: string,
  sampledHashes: readonly string[],
  stableSamples: number,
): CanvasCaptureRecord {
  validateCaptureContext(context);
  const rect = canvas.getBoundingClientRect();
  if (
    context.mode === "canvas"
    && (
      canvas.width !== context.renderViewport.width * context.renderDpr
      || canvas.height !== context.renderViewport.height * context.renderDpr
    )
  ) {
    throw new Error(
      `VISUAL_PREVIEW_CAPTURE_DPR_GEOMETRY_INVALID:${canvas.width}x${canvas.height}:DPR${context.renderDpr}`,
    );
  }
  return {
    schemaVersion: 2,
    screen: context.screen,
    viewport: context.viewport,
    mode: context.mode,
    selector,
    intrinsic: { width: canvas.width, height: canvas.height },
    domRect: {
      x: rect.x,
      y: rect.y,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    browserViewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualWidth: window.visualViewport?.width ?? null,
      visualHeight: window.visualViewport?.height ?? null,
      visualScale: window.visualViewport?.scale ?? null,
    },
    renderViewport: context.renderViewport,
    renderDpr: context.renderDpr,
    hashAlgorithm: "SHA-256",
    hashScope: "canvas-rgba8-row-major",
    pixelHash,
    sampledHashes: [...sampledHashes],
    stableSamples,
    captureMethod: CAPTURE_METHOD,
    captureState: context.captureState,
    ...(context.scroll ? { scroll: { ...context.scroll } } : {}),
    ...(context.comparisonSource ? { comparisonSource: context.comparisonSource } : {}),
  };
}

function animationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = Math.max(1, Math.floor(count));
    const advance = (): void => {
      remaining -= 1;
      if (remaining === 0) resolve();
      else requestAnimationFrame(advance);
    };
    requestAnimationFrame(advance);
  });
}
