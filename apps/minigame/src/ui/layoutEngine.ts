import LayoutImport from "minigame-canvas-engine";

type LayoutEngine = typeof LayoutImport;

function isLayoutEngine(value: unknown): value is LayoutEngine {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.clear === "function"
    && typeof candidate.clearAll === "function"
    && typeof candidate.init === "function"
    && typeof candidate.layout === "function";
}

function resolveLayoutEngine(value: unknown): LayoutEngine {
  if (isLayoutEngine(value)) return value;
  const nestedDefault = (value as { default?: unknown } | null)?.default;
  if (isLayoutEngine(nestedDefault)) return nestedDefault;
  throw new Error("LAYOUT_ENGINE_EXPORT_INVALID");
}

export default resolveLayoutEngine(LayoutImport);
export type { Canvas, Element, Text } from "minigame-canvas-engine";
