import {
  PROTOTYPE_REFERENCE_FILES,
  SCREEN_FIXTURES,
  SCREEN_ORDER,
  SHORT_SCREEN_FAMILY_REPRESENTATIVES,
} from "./fixtures";
import {
  DISPLAY_FONT,
  applyCaptureState,
  renderFixtureCanvas,
  VIEWPORT_KEYS,
  VIEWPORTS,
  type ViewportKey,
} from "./renderCanvas";
import {
  captureStablePng,
  hashCanvasPixels,
  hashImagePixels,
  hashResourceBytes,
  loadCaptureImage,
  waitForPreviewReady,
  waitForStableCanvas,
  type CanvasCaptureRecord,
  type StablePngCapture,
} from "./capture";
import {
  CAPTURE_PLAN,
  type CaptureDpr,
  type CapturePlanEntry,
  type CaptureState,
  type ScrollCaptureMetadata,
} from "./capturePlan";
import { waitForCanvasStability, waitForDisplayFont } from "./readiness";
import { parseCaptureDpr } from "./renderDpr";

type PreviewMode = "compare" | "canvas";
type FixtureScreenId = (typeof SCREEN_ORDER)[number];

declare global {
  interface Window {
    __VISUAL_PREVIEW_READY__?: boolean;
    __VISUAL_PREVIEW__?: Readonly<{
      screen: FixtureScreenId;
      viewport: ViewportKey;
      mode: PreviewMode;
      fixtureCount: number;
      canvasHash: string;
      stabilitySamples: number;
      comparisonSource?: "live-canvas" | "accepted-current-png";
      captureState: CaptureState;
      renderDpr: CaptureDpr;
      scroll?: ScrollCaptureMetadata;
    }>;
    __VISUAL_PREVIEW_CAPTURE__?: Readonly<{
      schemaVersion: 2;
      plan: readonly CapturePlanEntry[];
      stabilize: (selector?: string) => Promise<CanvasCaptureRecord>;
      capturePng: (selector?: string) => Promise<StablePngCapture>;
      composeAcceptedCurrentPng: (source: string) => Promise<AcceptedComparisonCaptureRecord>;
    }>;
  }
}

type AcceptedComparisonCaptureRecord = CanvasCaptureRecord & Readonly<{
  comparisonSource: "accepted-current-png";
  acceptedCurrent: Readonly<{
    sourceByteSha256: string;
    decodedPixelHash: string;
    composedRegionPixelHash: string;
    width: number;
    height: number;
  }>;
}>;

const params = new URLSearchParams(window.location.search);
const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("VISUAL_PREVIEW_ROOT_MISSING");

let screen: FixtureScreenId;
let viewportKey: ViewportKey;
let mode: PreviewMode;
let captureState: CaptureState;
let renderDpr: CaptureDpr;
try {
  screen = screenParam(params.get("screen"));
  viewportKey = viewportParam(params.get("viewport"));
  mode = modeParam(params.get("mode"));
  renderDpr = parseCaptureDpr(params.get("dpr"), mode);
  captureState = captureStateParam(params.get("state"), mode);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.ready = "error";
  root.innerHTML = `<main class="fatal-error"><h1>Visual preview error</h1><code>${escapeHtml(message)}</code></main>`;
  throw error;
}
const evidenceCapture = mode === "compare" && params.get("capture") === "evidence";
const viewport = VIEWPORTS[viewportKey];

document.title = `${screen} · ${viewportKey} · DPR${renderDpr} Canvas visual preview`;
document.body.dataset.mode = mode;
document.body.dataset.screen = screen;
document.body.dataset.viewport = viewportKey;
document.body.dataset.capture = evidenceCapture ? "evidence" : "interactive";
document.body.dataset.state = captureState;
document.body.dataset.dpr = String(renderDpr);

root.innerHTML = mode === "canvas"
  ? captureMarkup(viewport.width, viewport.height)
  : evidenceCapture
    ? evidenceComparisonMarkup(screen)
    : comparisonMarkup(screen, viewportKey);

const canvas = document.querySelector<HTMLCanvasElement>("#preview-canvas");
if (!canvas) throw new Error("VISUAL_PREVIEW_CANVAS_MISSING");
const previewCanvas = canvas;
let comparisonSource: "live-canvas" | "accepted-current-png" | undefined;
let scrollCapture: ScrollCaptureMetadata | undefined;

window.__VISUAL_PREVIEW_CAPTURE__ = {
  schemaVersion: 2,
  plan: CAPTURE_PLAN,
  stabilize: async (selector = evidenceCapture ? "#evidence-frame" : "#preview-canvas") => {
    if (selector === "#evidence-frame" && evidenceCapture && comparisonSource !== "accepted-current-png") {
      throw new Error("VISUAL_PREVIEW_ACCEPTED_CURRENT_REQUIRED");
    }
    await waitForPreviewReady();
    return waitForStableCanvas(selector, captureContext());
  },
  capturePng: async (selector = evidenceCapture ? "#evidence-frame" : "#preview-canvas") => {
    if (selector === "#evidence-frame" && evidenceCapture && comparisonSource !== "accepted-current-png") {
      throw new Error("VISUAL_PREVIEW_ACCEPTED_CURRENT_REQUIRED");
    }
    await waitForPreviewReady();
    return captureStablePng(selector, captureContext());
  },
  composeAcceptedCurrentPng,
};

window.__VISUAL_PREVIEW_READY__ = false;
document.documentElement.dataset.ready = "rendering";
void start();

async function start(): Promise<void> {
  try {
    await waitForDisplayFont(document.fonts, DISPLAY_FONT);
    await referenceReady();
    await renderFixtureCanvas(previewCanvas, SCREEN_FIXTURES[screen], viewport, renderDpr);
    const appliedState = await applyCaptureState({
      screen,
      viewport: viewportKey,
      mode,
      captureState,
    });
    scrollCapture = appliedState.scroll;
    const stability = await waitForCanvasStability(previewCanvas);
    if (evidenceCapture) {
      composeEvidenceFrame(previewCanvas);
      comparisonSource = "live-canvas";
    }
    window.__VISUAL_PREVIEW__ = {
      screen,
      viewport: viewportKey,
      mode,
      fixtureCount: SCREEN_ORDER.length,
      canvasHash: stability.hash,
      stabilitySamples: stability.stableSamples,
      captureState,
      renderDpr,
      ...(scrollCapture ? { scroll: scrollCapture } : {}),
      ...(comparisonSource ? { comparisonSource } : {}),
    };
    window.__VISUAL_PREVIEW_READY__ = true;
    document.documentElement.dataset.ready = "true";
    document.documentElement.dataset.canvasHash = stability.hash;
    document.querySelector<HTMLElement>("#render-status")?.replaceChildren("Canvas ready");
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    window.__VISUAL_PREVIEW_READY__ = false;
    document.documentElement.dataset.ready = "error";
    document.querySelector<HTMLElement>("#render-status")?.replaceChildren(message);
    throw error;
  }
}

function captureMarkup(width: number, height: number): string {
  return `<main id="capture" style="width:${width}px;height:${height}px"><canvas id="preview-canvas" aria-label="${escapeHtml(screen)} ${escapeHtml(viewportKey)} Canvas fixture"></canvas><span id="render-status" class="sr-only">Rendering</span></main>`;
}

function evidenceComparisonMarkup(id: FixtureScreenId): string {
  const reference = `references/${PROTOTYPE_REFERENCE_FILES[id]}`;
  return `<main id="evidence-capture"><img class="reference-image evidence-source" src="${reference}" width="390" height="844" alt="Prototype reference for ${escapeHtml(id)}"><canvas id="preview-canvas" class="evidence-source" aria-label="${escapeHtml(id)} 390x844 Canvas fixture"></canvas><canvas id="evidence-frame" width="964" height="964" aria-label="${escapeHtml(id)} prototype and Canvas evidence frame"></canvas></main>`;
}

function composeEvidenceFrame(source: CanvasImageSource): void {
  const frame = document.querySelector<HTMLCanvasElement>("#evidence-frame");
  const reference = document.querySelector<HTMLImageElement>(".reference-image");
  const context = frame?.getContext("2d");
  if (!frame || !reference || !context) throw new Error("VISUAL_PREVIEW_EVIDENCE_FRAME_MISSING");

  context.fillStyle = "#0b0a09";
  context.fillRect(0, 0, frame.width, frame.height);
  drawEvidencePanel(context, 28, "Prototype audit / current / after", reference);
  drawEvidencePanel(context, 468, "Mini Game Canvas renderer", source);
}

async function composeAcceptedCurrentPng(source: string): Promise<AcceptedComparisonCaptureRecord> {
  if (!evidenceCapture || viewportKey !== "390x844") {
    throw new Error("VISUAL_PREVIEW_ACCEPTED_CURRENT_UNAVAILABLE");
  }
  await waitForPreviewReady();
  const [image, sourceByteSha256] = await Promise.all([
    loadCaptureImage(source),
    hashResourceBytes(source),
  ]);
  if (image.naturalWidth !== viewport.width || image.naturalHeight !== viewport.height) {
    throw new Error(
      `VISUAL_PREVIEW_ACCEPTED_CURRENT_SIZE:${image.naturalWidth}x${image.naturalHeight}`,
    );
  }

  const decodedPixelHash = await hashImagePixels(image);
  composeEvidenceFrame(image);
  const frame = document.querySelector<HTMLCanvasElement>("#evidence-frame");
  if (!frame) throw new Error("VISUAL_PREVIEW_EVIDENCE_FRAME_MISSING");
  const composedRegionPixelHash = await hashCanvasPixels(frame, {
    x: 479,
    y: 81,
    width: viewport.width,
    height: viewport.height,
  });
  if (decodedPixelHash !== composedRegionPixelHash) {
    throw new Error(
      `VISUAL_PREVIEW_ACCEPTED_CURRENT_PIXEL_MISMATCH:${decodedPixelHash}:${composedRegionPixelHash}`,
    );
  }

  comparisonSource = "accepted-current-png";
  document.documentElement.dataset.comparisonSource = comparisonSource;
  if (window.__VISUAL_PREVIEW__) {
    window.__VISUAL_PREVIEW__ = { ...window.__VISUAL_PREVIEW__, comparisonSource };
  }
  const stable = await waitForStableCanvas("#evidence-frame", captureContext());
  return {
    ...stable,
    comparisonSource,
    acceptedCurrent: {
      sourceByteSha256,
      decodedPixelHash,
      composedRegionPixelHash,
      width: image.naturalWidth,
      height: image.naturalHeight,
    },
  };
}

function captureContext() {
  return {
    screen,
    viewport: viewportKey,
    mode,
    renderViewport: viewport,
    renderDpr,
    captureState,
    ...(scrollCapture ? { scroll: scrollCapture } : {}),
    ...(comparisonSource ? { comparisonSource } : {}),
  } as const;
}

function drawEvidencePanel(
  context: CanvasRenderingContext2D,
  x: number,
  label: string,
  image: CanvasImageSource,
): void {
  context.fillStyle = "#171411";
  context.fillRect(x, 28, 412, 908);
  context.strokeStyle = "#655445";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, 28.5, 411, 907);
  context.font = '11px "Segoe UI", "Noto Sans SC", sans-serif';
  context.textBaseline = "middle";
  context.fillStyle = "#aa9984";
  context.fillText(label, x + 11, 60);
  context.font = '700 11px ui-monospace, "Cascadia Mono", monospace';
  context.fillStyle = "#fff1c7";
  context.textAlign = "right";
  context.fillText("390 × 844", x + 401, 60);
  context.textAlign = "left";
  context.drawImage(image, x + 11, 81, 390, 844);
}

function comparisonMarkup(id: FixtureScreenId, selectedViewport: ViewportKey): string {
  const reference = `references/${PROTOTYPE_REFERENCE_FILES[id]}`;
  const isReferenceViewport = selectedViewport === "390x844";
  const referencePanel = isReferenceViewport
    ? `<figure class="evidence-panel"><figcaption><span>Prototype audit / current / after</span><strong>390 × 844</strong></figcaption><img class="reference-image" src="${reference}" width="390" height="844" alt="Prototype reference for ${escapeHtml(id)}"></figure>`
    : `<figure class="evidence-panel evidence-panel--unavailable"><figcaption><span>Prototype reference</span><strong>390 × 844 only</strong></figcaption><div class="reference-note">短屏没有独立设计稿；以同一 renderer 的宽度优先重排作为回归证据。</div></figure>`;

  return `<header class="toolbar">
    <div><p class="kicker">Exploding Kitty · renderer registry</p><h1>Canvas visual regression</h1><p id="render-status">Rendering</p></div>
    <nav aria-label="Viewport">
      ${VIEWPORT_KEYS.map((key) => linkFor(id, key, key === selectedViewport, key)).join("")}
    </nav>
  </header>
  <main class="workspace">
    <aside class="screen-index"><h2>25 fixtures</h2><ol>${SCREEN_ORDER.map((fixtureId) => `<li>${linkFor(fixtureId, selectedViewport, fixtureId === id)}${familyBadge(fixtureId)}</li>`).join("")}</ol></aside>
    <section class="comparison" id="comparison">
      ${referencePanel}
      <figure class="evidence-panel"><figcaption><span>Mini Game Canvas renderer</span><strong>${escapeHtml(selectedViewport)}</strong></figcaption><canvas id="preview-canvas" aria-label="${escapeHtml(id)} ${escapeHtml(selectedViewport)} Canvas fixture"></canvas></figure>
    </section>
  </main>`;
}

function familyBadge(id: FixtureScreenId): string {
  const family = Object.entries(SHORT_SCREEN_FAMILY_REPRESENTATIVES).find(([, screenId]) => screenId === id)?.[0];
  return family ? `<small>${escapeHtml(family)}</small>` : "";
}

function linkFor(id: FixtureScreenId, selectedViewport: ViewportKey, active: boolean, label: string = id): string {
  const url = new URL(window.location.href);
  url.searchParams.set("screen", id);
  url.searchParams.set("viewport", selectedViewport);
  url.searchParams.set("mode", "compare");
  return `<a href="${escapeHtml(url.search)}"${active ? " aria-current=\"page\"" : ""}>${escapeHtml(label)}</a>`;
}

function screenParam(value: string | null): FixtureScreenId {
  if (value === null || value === "") return "login";
  if (SCREEN_ORDER.includes(value as FixtureScreenId)) return value as FixtureScreenId;
  throw new Error(`VISUAL_PREVIEW_SCREEN_UNKNOWN:${value}`);
}

function viewportParam(value: string | null): ViewportKey {
  if (value === null || value === "") return "390x844";
  if (VIEWPORT_KEYS.includes(value as ViewportKey)) return value as ViewportKey;
  throw new Error(`VISUAL_PREVIEW_VIEWPORT_UNKNOWN:${value}`);
}

function modeParam(value: string | null): PreviewMode {
  if (value === null || value === "") return "compare";
  if (value === "canvas" || value === "compare") return value;
  throw new Error(`VISUAL_PREVIEW_MODE_UNKNOWN:${value}`);
}

function captureStateParam(value: string | null, selectedMode: PreviewMode): CaptureState {
  const captureState = value === null || value === "" ? "initial" : value;
  if (captureState !== "initial" && captureState !== "scroll-end") {
    throw new Error(`VISUAL_PREVIEW_CAPTURE_STATE_UNKNOWN:${captureState}`);
  }
  if (selectedMode === "compare" && captureState !== "initial") {
    throw new Error(`VISUAL_PREVIEW_COMPARISON_STATE_INVALID:${captureState}`);
  }
  return captureState;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function referenceReady(): Promise<void> {
  const image = document.querySelector<HTMLImageElement>(".reference-image");
  if (!image) return;
  if (!(image.complete && image.naturalWidth > 0)) {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error(`VISUAL_PREVIEW_REFERENCE_FAILED:${image.src}`)), { once: true });
    });
  }
  if (image.decode) await image.decode();
  if (image.naturalWidth <= 0) throw new Error(`VISUAL_PREVIEW_REFERENCE_FAILED:${image.src}`);
}
