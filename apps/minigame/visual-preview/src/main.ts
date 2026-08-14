import {
  PROTOTYPE_REFERENCE_FILES,
  SCREEN_FIXTURES,
  SCREEN_ORDER,
  SHORT_SCREEN_FAMILY_REPRESENTATIVES,
} from "./fixtures";
import {
  renderFixtureCanvas,
  VIEWPORT_KEYS,
  VIEWPORTS,
  type ViewportKey,
} from "./renderCanvas";

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
    }>;
  }
}

const params = new URLSearchParams(window.location.search);
const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("VISUAL_PREVIEW_ROOT_MISSING");

let screen: FixtureScreenId;
try {
  screen = screenParam(params.get("screen"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.ready = "error";
  root.innerHTML = `<main class="fatal-error"><h1>Visual preview error</h1><code>${escapeHtml(message)}</code></main>`;
  throw error;
}
const viewportKey = viewportParam(params.get("viewport"));
const mode = params.get("mode") === "canvas" ? "canvas" : "compare";
const viewport = VIEWPORTS[viewportKey];

document.title = `${screen} · ${viewportKey} · Canvas visual preview`;
document.body.dataset.mode = mode;
document.body.dataset.screen = screen;
document.body.dataset.viewport = viewportKey;

root.innerHTML = mode === "canvas"
  ? captureMarkup(viewport.width, viewport.height)
  : comparisonMarkup(screen, viewportKey);

const canvas = document.querySelector<HTMLCanvasElement>("#preview-canvas");
if (!canvas) throw new Error("VISUAL_PREVIEW_CANVAS_MISSING");
const previewCanvas = canvas;

void start();

async function start(): Promise<void> {
  try {
    await document.fonts.ready;
    await referenceReady();
    await renderFixtureCanvas(previewCanvas, SCREEN_FIXTURES[screen], viewport);
    window.__VISUAL_PREVIEW__ = {
      screen,
      viewport: viewportKey,
      mode,
      fixtureCount: SCREEN_ORDER.length,
    };
    window.__VISUAL_PREVIEW_READY__ = true;
    document.documentElement.dataset.ready = "true";
    document.querySelector<HTMLElement>("#render-status")?.replaceChildren("Canvas ready");
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    document.documentElement.dataset.ready = "error";
    document.querySelector<HTMLElement>("#render-status")?.replaceChildren(message);
    throw error;
  }
}

function captureMarkup(width: number, height: number): string {
  return `<main id="capture" style="width:${width}px;height:${height}px"><canvas id="preview-canvas" aria-label="${escapeHtml(screen)} ${escapeHtml(viewportKey)} Canvas fixture"></canvas><span id="render-status" class="sr-only">Rendering</span></main>`;
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
  return VIEWPORT_KEYS.includes(value as ViewportKey) ? value as ViewportKey : "390x844";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function referenceReady(): Promise<void> {
  const image = document.querySelector<HTMLImageElement>(".reference-image");
  if (!image || image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error(`VISUAL_PREVIEW_REFERENCE_FAILED:${image.src}`)), { once: true });
  });
}
