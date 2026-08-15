import {
  SCREEN_ORDER,
  SHORT_SCREEN_FAMILY_REPRESENTATIVES,
} from "./fixtures";
import {
  VIEWPORT_KEYS,
  VIEWPORTS,
  type ViewportKey,
  type ViewportProfile,
} from "./viewports";

export const CAPTURE_METHOD = "CDP Runtime.evaluate -> HTMLCanvasElement.toDataURL(format=png)";
export const CAPTURE_BROWSER_VIEWPORT = Object.freeze({ width: 389, height: 584 });
export const CAPTURE_DPRS = Object.freeze([1, 2, 3] as const);
export type CaptureDpr = (typeof CAPTURE_DPRS)[number];
export type CaptureState = "initial" | "scroll-end";
export type ScrollCaptureMetadata = Readonly<{
  selector: "#scene-scroll";
  coordinateSpace: "renderer-logical-px";
  viewportHeight: number;
  contentHeight: number;
  maxScrollTop: number;
  scrollTop: number;
}>;

export type CaptureStateTarget = Readonly<{
  screen: (typeof SCREEN_ORDER)[number];
  viewport: ViewportKey;
  mode: "canvas" | "compare";
  captureState: CaptureState;
}>;

export type CapturePlanEntry = Readonly<{
  id: string;
  kind: "current-standard" | "current-short" | "current-probe" | "interaction" | "density" | "comparison";
  screen: (typeof SCREEN_ORDER)[number];
  viewport: ViewportKey;
  mode: "canvas" | "compare";
  query: string;
  selector: "#preview-canvas" | "#evidence-frame";
  browserViewport: Readonly<{ width: number; height: number }>;
  renderViewport: ViewportProfile;
  renderDpr: CaptureDpr;
  intrinsic: Readonly<{ width: number; height: number }>;
  outputPath: string;
  captureMethod: typeof CAPTURE_METHOD;
  captureState: CaptureState;
  acceptedCurrentPath?: string;
  initialCapturePath?: string;
  requiresAcceptedCurrentPng: boolean;
}>;

const standardCurrent = SCREEN_ORDER.map((screen): CapturePlanEntry => currentEntry(
  "current-standard",
  screen,
  "390x844",
));

const shortCurrent = Object.values(SHORT_SCREEN_FAMILY_REPRESENTATIVES).flatMap((screen) => (
  ["372x749", "389x584"] as const
).map((viewport): CapturePlanEntry => currentEntry("current-short", screen, viewport)));

const additionalCurrent = [currentEntry("current-probe", "network", "372x749")];

const interactionCaptures = [
  interactionEntry("network", "372x749", "scroll-end"),
  interactionEntry("rules", "389x584", "scroll-end"),
];

const densityCaptures = SCREEN_ORDER.flatMap((screen) => (
  [2, 3] as const
).map((renderDpr): CapturePlanEntry => densityEntry(screen, renderDpr)));

const SCROLL_END_TARGETS = new Set<string>([
  captureTargetKey("network", "372x749"),
  captureTargetKey("rules", "389x584"),
]);

const comparisons = SCREEN_ORDER.map((screen): CapturePlanEntry => {
  const viewport = "390x844" as const;
  return {
    id: `comparison:${screen}:${viewport}`,
    kind: "comparison",
    screen,
    viewport,
    mode: "compare",
    query: queryFor(screen, viewport, "compare", true),
    selector: "#evidence-frame",
    browserViewport: CAPTURE_BROWSER_VIEWPORT,
    renderViewport: VIEWPORTS[viewport],
    renderDpr: 1,
    intrinsic: { width: 964, height: 964 },
    outputPath: `evidence/comparisons/compare-${screen}-prototype-vs-canvas-${viewport}.png`,
    captureMethod: CAPTURE_METHOD,
    captureState: "initial",
    acceptedCurrentPath: `evidence/current/canvas-${screen}-${viewport}.png`,
    requiresAcceptedCurrentPng: true,
  };
});

export const CAPTURE_PLAN = Object.freeze([
  ...standardCurrent,
  ...shortCurrent,
  ...additionalCurrent,
  ...interactionCaptures,
  ...densityCaptures,
  ...comparisons,
] satisfies readonly CapturePlanEntry[]);

export const CAPTURE_PLAN_COUNTS = Object.freeze({
  standard: standardCurrent.length,
  short: shortCurrent.length,
  probes: additionalCurrent.length,
  interactions: interactionCaptures.length,
  density: densityCaptures.length,
  comparisons: comparisons.length,
  total: CAPTURE_PLAN.length,
});

export function assertCaptureStateTarget(target: CaptureStateTarget): void {
  const state = String(target.captureState);
  if (state !== "initial" && state !== "scroll-end") {
    throw new Error(`VISUAL_PREVIEW_CAPTURE_STATE_UNKNOWN:${state}`);
  }
  const screenKnown = SCREEN_ORDER.includes(target.screen);
  const viewportKnown = VIEWPORT_KEYS.includes(target.viewport);
  const modeKnown = target.mode === "canvas" || target.mode === "compare";
  if (!screenKnown || !viewportKnown || !modeKnown) {
    throw invalidCaptureTarget(target, state);
  }
  if (state === "initial") return;
  if (
    target.mode !== "canvas"
    || !SCROLL_END_TARGETS.has(captureTargetKey(target.screen, target.viewport))
  ) throw invalidCaptureTarget(target, state);
}

function currentEntry(
  kind: "current-standard" | "current-short" | "current-probe",
  screen: (typeof SCREEN_ORDER)[number],
  viewport: ViewportKey,
): CapturePlanEntry {
  const renderViewport = VIEWPORTS[viewport];
  return {
    id: `${kind}:${screen}:${viewport}`,
    kind,
    screen,
    viewport,
    mode: "canvas",
    query: queryFor(screen, viewport, "canvas", false),
    selector: "#preview-canvas",
    browserViewport: CAPTURE_BROWSER_VIEWPORT,
    renderViewport,
    renderDpr: 1,
    intrinsic: intrinsicFor(renderViewport, 1),
    outputPath: `evidence/current/canvas-${screen}-${viewport}.png`,
    captureMethod: CAPTURE_METHOD,
    captureState: "initial",
    requiresAcceptedCurrentPng: false,
  };
}

function interactionEntry(
  screen: (typeof SCREEN_ORDER)[number],
  viewport: ViewportKey,
  captureState: Exclude<CaptureState, "initial">,
): CapturePlanEntry {
  const renderViewport = VIEWPORTS[viewport];
  return {
    id: `${screen}-${captureState}-${viewport}`,
    kind: "interaction",
    screen,
    viewport,
    mode: "canvas",
    query: queryFor(screen, viewport, "canvas", false, captureState),
    selector: "#preview-canvas",
    browserViewport: CAPTURE_BROWSER_VIEWPORT,
    renderViewport,
    renderDpr: 1,
    intrinsic: intrinsicFor(renderViewport, 1),
    outputPath: `evidence/focus/focus-${screen}-${captureState}-${viewport}.png`,
    captureMethod: CAPTURE_METHOD,
    captureState,
    initialCapturePath: `evidence/current/canvas-${screen}-${viewport}.png`,
    requiresAcceptedCurrentPng: false,
  };
}

function densityEntry(
  screen: (typeof SCREEN_ORDER)[number],
  renderDpr: Exclude<CaptureDpr, 1>,
): CapturePlanEntry {
  const viewport = "390x844" as const;
  const renderViewport = VIEWPORTS[viewport];
  return {
    id: `density:${screen}:${viewport}:dpr${renderDpr}`,
    kind: "density",
    screen,
    viewport,
    mode: "canvas",
    query: queryFor(screen, viewport, "canvas", false, "initial", renderDpr),
    selector: "#preview-canvas",
    browserViewport: CAPTURE_BROWSER_VIEWPORT,
    renderViewport,
    renderDpr,
    intrinsic: intrinsicFor(renderViewport, renderDpr),
    outputPath: `evidence/density/canvas-${screen}-${viewport}-dpr${renderDpr}.png`,
    captureMethod: CAPTURE_METHOD,
    captureState: "initial",
    requiresAcceptedCurrentPng: false,
  };
}

function queryFor(
  screen: (typeof SCREEN_ORDER)[number],
  viewport: ViewportKey,
  mode: "canvas" | "compare",
  evidence: boolean,
  captureState: CaptureState = "initial",
  renderDpr: CaptureDpr = 1,
): string {
  const params = new URLSearchParams({ screen, viewport, mode, state: captureState });
  if (renderDpr !== 1) params.set("dpr", String(renderDpr));
  if (evidence) params.set("capture", "evidence");
  return `?${params.toString()}`;
}

function intrinsicFor(viewport: ViewportProfile, renderDpr: CaptureDpr): Readonly<{ width: number; height: number }> {
  return {
    width: viewport.width * renderDpr,
    height: viewport.height * renderDpr,
  };
}

function captureTargetKey(
  screen: (typeof SCREEN_ORDER)[number],
  viewport: ViewportKey,
): string {
  return `${screen}:${viewport}`;
}

function invalidCaptureTarget(target: CaptureStateTarget, state: string): Error {
  return new Error(
    `VISUAL_PREVIEW_CAPTURE_STATE_TARGET_INVALID:${state}:${String(target.screen)}:${String(target.viewport)}:${String(target.mode)}`,
  );
}
