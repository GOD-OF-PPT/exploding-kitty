import Layout, { type Canvas as LayoutCanvas } from "../../src/ui/layoutEngine";
import { CardTableSurface } from "../../src/ui/cardTableSurface";
import type { ScreenId, ScreenModel } from "../../src/ui/model";
import { registerFitImage } from "../../src/ui/rendering/fitImage";
import { renderScene } from "../../src/ui/rendering/rendererRegistry";
import type { CapsuleRect, RenderSceneOptions } from "../../src/ui/rendering/types";

export const VIEWPORT_KEYS = ["390x844", "372x749", "389x584"] as const;
export type ViewportKey = (typeof VIEWPORT_KEYS)[number];

export type ViewportProfile = Readonly<{
  key: ViewportKey;
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  capsule: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}>;

export const VIEWPORTS: Readonly<Record<ViewportKey, ViewportProfile>> = {
  "390x844": {
    key: "390x844",
    width: 390,
    height: 844,
    safeTop: 47,
    safeBottom: 34,
    capsule: { left: 298, top: 13, right: 385, bottom: 45 },
  },
  "372x749": {
    key: "372x749",
    width: 372,
    height: 749,
    safeTop: 44,
    safeBottom: 34,
    capsule: { left: 280, top: 12, right: 367, bottom: 44 },
  },
  "389x584": {
    key: "389x584",
    width: 389,
    height: 584,
    safeTop: 24,
    safeBottom: 0,
    capsule: { left: 296, top: 7, right: 384, bottom: 39 },
  },
};

const DESIGN_WIDTH = 390;
const NO_BACK = new Set<ScreenId>(["login", "home", "response", "explosion", "eliminated", "network"]);
const IMAGE_SOURCE = /\bsrc="([^"]+)"/g;

let tableSurface: CardTableSurface | null = null;
registerFitImage(Layout);

export async function renderFixtureCanvas(
  canvas: HTMLCanvasElement,
  model: ScreenModel,
  viewport: ViewportProfile,
): Promise<void> {
  const scale = viewport.width / DESIGN_WIDTH;
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
  };
  const scene = renderScene(model, options);
  const imageSources = sourcesFrom(scene.template, model);

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  Layout.clear();
  tableSurface = null;
  await Layout.loadImgs(imageSources);
  Layout.init(scene.template, scene.styles);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("VISUAL_PREVIEW_CANVAS_2D_UNAVAILABLE");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  Layout.updateViewPort({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  Layout.layout(context);

  if (model.table) {
    await attachTableSurface(model, options.selectedTokens);
  }

  await nextPaint();
  await nextPaint();
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
  if (id === "give-card") return ["skip-01"];
  if (id === "game") return ["future-01"];
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

async function attachTableSurface(model: ScreenModel, selectedTokens: readonly string[]): Promise<void> {
  if (!model.table) return;
  const component = Layout.getElementById("tableCanvas") as LayoutCanvas | null;
  if (!component) throw new Error(`VISUAL_PREVIEW_TABLE_CANVAS_MISSING:${model.id}`);

  const pendingImages: Promise<void>[] = [];
  const createTrackedImage = (): HTMLImageElement => {
    const image = new Image();
    pendingImages.push(new Promise((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error(`VISUAL_PREVIEW_TABLE_IMAGE_FAILED:${image.src}`)), { once: true });
    }));
    return image;
  };

  tableSurface = new CardTableSurface(
    () => document.createElement("canvas"),
    createTrackedImage,
    {
      width: 358,
      height: 520,
      deckCount: model.table.deckCount,
      discard: model.table.discard,
      hand: model.table.hand,
      players: model.table.players,
      myTurn: model.table.myTurn,
      turnsOwed: model.table.turnsOwed,
      selectedTokens,
      fontFamily: "ZCOOL KuaiLe",
    },
  );
  await Promise.all(pendingImages);
  tableSurface.update({
    width: 358,
    height: 520,
    deckCount: model.table.deckCount,
    discard: model.table.discard,
    hand: model.table.hand,
    players: model.table.players,
    myTurn: model.table.myTurn,
    turnsOwed: model.table.turnsOwed,
    selectedTokens,
    fontFamily: "ZCOOL KuaiLe",
  });
  component.canvas = tableSurface.element;
  component.update();
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
