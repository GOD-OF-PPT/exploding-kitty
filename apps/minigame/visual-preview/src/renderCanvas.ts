import Layout, { type Canvas as LayoutCanvas } from "../../src/ui/layoutEngine";
import { CardTableSurface } from "../../src/ui/cardTableSurface";
import type { ScreenId, ScreenModel } from "../../src/ui/model";
import { registerFitImage } from "../../src/ui/rendering/fitImage";
import { renderScene } from "../../src/ui/rendering/rendererRegistry";
import type { CapsuleRect, RenderSceneOptions } from "../../src/ui/rendering/types";
import { waitForDecodedImages } from "./readiness";
import type { ViewportProfile } from "./viewports";
import {
  assertCaptureStateTarget,
  type CaptureDpr,
  type CaptureStateTarget,
  type ScrollCaptureMetadata,
} from "./capturePlan";
import { configureCaptureCanvas } from "./renderDpr";

export { VIEWPORT_KEYS, VIEWPORTS } from "./viewports";
export type { ViewportKey, ViewportProfile } from "./viewports";

export const DISPLAY_FONT = "ZCOOL KuaiLe";
const NO_BACK = new Set<ScreenId>(["login", "home", "response", "explosion", "eliminated", "network"]);
const IMAGE_SOURCE = /\bsrc="([^"]+)"/g;

let tableSurface: CardTableSurface | null = null;
registerFitImage(Layout);

export async function renderFixtureCanvas(
  canvas: HTMLCanvasElement,
  model: ScreenModel,
  viewport: ViewportProfile,
  renderDpr: CaptureDpr = 1,
): Promise<void> {
  const { designScale: scale, backingScale } = configureCaptureCanvas(canvas, viewport, renderDpr);
  const logicalHeight = viewport.height / scale;
  const options: RenderSceneOptions = {
    height: logicalHeight,
    safeTop: viewport.safeTop / scale,
    safeBottom: viewport.safeBottom / scale,
    capsule: capsuleInDesignUnits(viewport, scale),
    canGoBack: !NO_BACK.has(model.id),
    selectedTokens: selectedTokensFor(model.id),
    error: null,
    viewerId: "viewer",
    displayFont: DISPLAY_FONT,
  };
  const scene = renderScene(model, options);
  const imageSources = sourcesFrom(scene.template, model);

  Layout.clear();
  tableSurface = null;
  const rendererImages = await Layout.loadImgs(imageSources);
  await waitForDecodedImages(rendererImages, "VISUAL_PREVIEW_RENDERER_IMAGE_FAILED");
  Layout.init(scene.template, scene.styles);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("VISUAL_PREVIEW_CANVAS_2D_UNAVAILABLE");
  context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
  Layout.updateViewPort({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  Layout.layout(context);

  if (model.table) {
    await attachTableSurface(model, options.selectedTokens, options.displayFont, renderDpr);
  }

  await nextPaint();
  await nextPaint();
}

type CaptureScrollView = Readonly<{
  type: "ScrollView";
  layoutBox: Readonly<{ height: number }>;
  scrollHeight: number;
  scrollTop: number;
  scrollTo(left: number, top: number, animate: boolean): void;
}>;

type ScrollLayoutLike = Readonly<{
  getElementById(id: string): unknown;
}>;

export async function applyCaptureState(
  target: CaptureStateTarget,
  layout: ScrollLayoutLike = Layout,
  waitForPaint: () => Promise<void> = nextPaint,
): Promise<Readonly<{ captureState: CaptureStateTarget["captureState"]; scroll?: ScrollCaptureMetadata }>> {
  assertCaptureStateTarget(target);
  if (target.captureState === "initial") return { captureState: target.captureState };
  const scroll = layout.getElementById("scene-scroll");
  if (!isCaptureScrollView(scroll)) {
    throw new Error("VISUAL_PREVIEW_SCROLL_STATE_TARGET_MISSING:#scene-scroll");
  }
  const viewportHeight = Number(scroll.layoutBox.height);
  const contentHeight = Number(scroll.scrollHeight);
  const maxScrollTop = contentHeight - viewportHeight;
  if (
    !Number.isFinite(viewportHeight)
    || !Number.isFinite(contentHeight)
    || viewportHeight <= 0
    || contentHeight <= viewportHeight
    || maxScrollTop <= 0
  ) throw new Error("VISUAL_PREVIEW_SCROLL_STATE_NOT_SCROLLABLE:#scene-scroll");

  scroll.scrollTo(0, maxScrollTop, false);
  await waitForPaint();
  await waitForPaint();
  const scrollTop = Number(scroll.scrollTop);
  if (!Number.isFinite(scrollTop) || Math.abs(scrollTop - maxScrollTop) > 0.01) {
    throw new Error(`VISUAL_PREVIEW_SCROLL_STATE_NOT_AT_END:${scrollTop}:${maxScrollTop}`);
  }
  return {
    captureState: target.captureState,
    scroll: {
      selector: "#scene-scroll",
      coordinateSpace: "renderer-logical-px",
      viewportHeight,
      contentHeight,
      maxScrollTop,
      scrollTop,
    },
  };
}

function isCaptureScrollView(value: unknown): value is CaptureScrollView {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CaptureScrollView>;
  return candidate.type === "ScrollView"
    && typeof candidate.layoutBox === "object"
    && candidate.layoutBox !== null
    && typeof candidate.scrollTo === "function";
}

function capsuleInDesignUnits(viewport: ViewportProfile, scale: number): CapsuleRect {
  const { left, top, right, bottom } = viewport.capsule;
  return {
    left: left / scale,
    top: top / scale,
    right: right / scale,
    bottom: bottom / scale,
    width: (right - left) / scale,
    height: (bottom - top) / scale,
  };
}

function selectedTokensFor(id: ScreenId): readonly string[] {
  if (id === "give-card") return ["attack-01"];
  return [];
}

function sourcesFrom(template: string, model: ScreenModel): string[] {
  const sources = new Set<string>();
  for (const match of template.matchAll(IMAGE_SOURCE)) {
    const source = match[1];
    if (source) sources.add(source);
  }
  if (model.table) {
    sources.add("assets/ui/backgrounds/comic-bg-390x844.jpg");
    sources.add("assets/cards/card-back.png");
    if (model.table.discard?.image) sources.add(model.table.discard.image);
    for (const card of model.table.hand) sources.add(card.image);
  }
  return [...sources].sort();
}

async function attachTableSurface(
  model: ScreenModel,
  selectedTokens: readonly string[],
  displayFont: string,
  renderDpr: CaptureDpr,
): Promise<void> {
  if (!model.table) return;
  const component = Layout.getElementById("tableCanvas") as LayoutCanvas | null;
  if (!component) throw new Error(`VISUAL_PREVIEW_TABLE_CANVAS_MISSING:${model.id}`);
  const width = layoutSize(component.layoutBox.width, 368);
  const height = layoutSize(component.layoutBox.height, 520);

  const trackedImages: HTMLImageElement[] = [];
  const pendingImages: Promise<void>[] = [];
  const createTrackedImage = (): HTMLImageElement => {
    const image = new Image();
    trackedImages.push(image);
    pendingImages.push(new Promise((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error(`VISUAL_PREVIEW_TABLE_IMAGE_FAILED:${image.src}`)), { once: true });
    }));
    return image;
  };

  const state = {
    width,
    height,
    renderScale: renderDpr,
    deckCount: model.table.deckCount,
    discard: model.table.discard,
    hand: model.table.hand,
    players: model.table.players,
    myTurn: model.table.myTurn,
    turnsOwed: model.table.turnsOwed,
    waitingLabel: model.subtitle ?? model.title,
    selectedTokens,
    fontFamily: displayFont,
  };
  const surface = new CardTableSurface(
    () => document.createElement("canvas"),
    createTrackedImage,
    state,
  );
  tableSurface = surface;
  component.canvas = surface.element;
  const unsubscribe = surface.subscribeInvalidation(() => component.update());
  try {
    await Promise.all(pendingImages);
    await waitForDecodedImages(trackedImages, "VISUAL_PREVIEW_TABLE_IMAGE_FAILED");
    surface.update(state);
    component.update();
    await nextPaint();
  } finally {
    unsubscribe();
  }
}

function layoutSize(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : fallback;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
