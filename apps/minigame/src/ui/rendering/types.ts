import type { IStyle } from "minigame-canvas-engine";
import type { ScreenId, ScreenModel } from "../model";

export type CapsuleRect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}>;

export type RenderSceneOptions = Readonly<{
  /** Logical canvas height after width-first scaling. */
  height: number;
  safeTop: number;
  safeBottom: number;
  capsule: CapsuleRect | null;
  canGoBack: boolean;
  selectedTokens: readonly string[];
  error: string | null;
  sending?: boolean;
  viewerId: string;
  displayFont: string;
}>;

export type RenderedScene = Readonly<{
  template: string;
  styles: Record<string, IStyle>;
}>;

export type SceneRenderer = (
  model: ScreenModel,
  options: RenderSceneOptions,
) => string;

export type SceneRendererRegistry = Readonly<Record<ScreenId, SceneRenderer>>;

export type LayoutDensity = "short" | "compact" | "tall";

export function layoutDensity(height: number): LayoutDensity {
  if (height < 700) return "short";
  if (height < 800) return "compact";
  return "tall";
}
