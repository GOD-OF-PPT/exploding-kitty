import { restoreLayoutEngineEnvironment } from "./layoutEngineEnvironment";
import LayoutImport from "minigame-canvas-engine";
import { installHardBorderShadow } from "./hardBorderShadow";

restoreLayoutEngineEnvironment();

type LayoutEngine = typeof LayoutImport;
type EngineNode = Readonly<{
  parent: EngineNode | null;
  emit(eventName: string, event: unknown): void;
}>;
type TouchLike = Readonly<{ pageX?: number; pageY?: number }>;
type EventLike = Readonly<{
  touches?: readonly TouchLike[];
  changedTouches?: readonly TouchLike[];
  pageX?: number;
  pageY?: number;
}>;
type BubblingLayout = EngineNode & Readonly<{
  eventHandler(eventName: string): (event: unknown) => void;
  getChildByPos(tree: EngineNode, x: number, y: number, list: EngineNode[]): void;
  bindEvents(): void;
  unBindEvents(): void;
}> & {
  eventHandlerData: {
    hasEventBind: boolean;
    handlers: {
      touchStart: (event: unknown) => void;
      touchMove: (event: unknown) => void;
      touchEnd: (event: unknown) => void;
      touchCancel: (event: unknown) => void;
    };
  };
};

function isLayoutEngine(value: unknown): value is LayoutEngine {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.clear === "function"
    && typeof candidate.clearAll === "function"
    && typeof candidate.init === "function"
    && typeof candidate.layout === "function";
}

export function resolveLayoutEngine(value: unknown): LayoutEngine {
  if (isLayoutEngine(value)) return value;
  const nestedDefault = (value as { default?: unknown } | null)?.default;
  if (isLayoutEngine(nestedDefault)) return nestedDefault;
  throw new Error("LAYOUT_ENGINE_EXPORT_INVALID");
}

const layout = resolveLayoutEngine(LayoutImport);
installHardBorderShadow(layout);
installTouchBubbling(layout);

/**
 * The upstream engine dispatches touch events only to the deepest element.
 * ScrollView listens on itself (and on the root for touchend), so a drag that
 * begins on a row, image or label never reaches the scroller. Bubble touch
 * phases through the visual ancestry while leaving the engine's click
 * synthesis untouched; ScreenHost owns semantic click delegation.
 */
export function installTouchBubbling(value: LayoutEngine): void {
  const target = value as unknown as BubblingLayout & { __explodingKittyTouchBubbling?: boolean };
  if (target.__explodingKittyTouchBubbling) return;
  const wasBound = target.eventHandlerData.hasEventBind;
  if (wasBound) target.unBindEvents();
  const baseFactory = target.eventHandler.bind(target);
  (target as { eventHandler(eventName: string): (event: unknown) => void }).eventHandler = (eventName: string) => {
    const baseHandler = baseFactory(eventName);
    if (!isTouchPhase(eventName)) return baseHandler;
    return (event: unknown) => {
      const touch = extractTouch(event);
      const ancestry: EngineNode[] = [];
      if (touch && Number.isFinite(touch.pageX) && Number.isFinite(touch.pageY)) {
        target.getChildByPos(target, Number(touch.pageX), Number(touch.pageY), ancestry);
      }
      baseHandler(event);
      const deepest = ancestry.length ? ancestry[ancestry.length - 1] : undefined;
      let parent = deepest?.parent ?? null;
      while (parent) {
        parent.emit(eventName, event);
        parent = parent.parent;
      }
    };
  };
  target.eventHandlerData.handlers = {
    touchStart: target.eventHandler("touchstart"),
    touchMove: target.eventHandler("touchmove"),
    touchEnd: target.eventHandler("touchend"),
    touchCancel: target.eventHandler("touchcancel"),
  };
  Object.defineProperty(target, "__explodingKittyTouchBubbling", { value: true, configurable: false });
  if (wasBound) target.bindEvents();
}

function extractTouch(event: unknown): TouchLike | null {
  if (!event || typeof event !== "object") return null;
  const value = event as EventLike;
  return value.touches?.[0] ?? value.changedTouches?.[0] ?? value;
}

function isTouchPhase(value: string): boolean {
  return value === "touchstart" || value === "touchmove" || value === "touchend" || value === "touchcancel";
}

export default layout;
export type { Canvas, Element, Text } from "minigame-canvas-engine";
