import { normalizeProductView } from "../../src/ui/normalize";
import { ALL_SCREEN_IDS, buildScreen, type SceneContext } from "../../src/ui/sceneRegistry";
import type { ScreenId, ScreenModel } from "../../src/ui/model";
import { renderScene } from "../../src/ui/rendering/rendererRegistry";
import type { RenderSceneOptions } from "../../src/ui/rendering/types";
import { SCREEN_FIXTURES, SCREEN_ORDER } from "./fixtures";
import { VIEWPORTS, type ViewportProfile } from "./viewports";

const DISPLAY_FONT_SENTINEL = "__MINIGAME_DISPLAY_FONT_COVERAGE__";
const DESIGN_WIDTH = 390;
const NO_BACK = new Set<ScreenId>(["login", "home", "response", "explosion", "eliminated", "network"]);
const TEXT_TAG = /<text\b[^>]*>/gu;
const CLASS_ATTRIBUTE = /\bclass="([^"]*)"/u;
const VALUE_ATTRIBUTE = /\bvalue="([^"]*)"/u;

/**
 * Deterministic strings that the real production renderers paint with the
 * packaged display font. Runtime player names remain allowed to fall back;
 * this list guards product copy and controlled regression states.
 */
export function collectDisplayFontStrings(): readonly string[] {
  const strings = new Set<string>();
  const models = [...Object.values(SCREEN_FIXTURES), ...productionScreenModels()];

  for (const model of models) {
    for (const viewport of Object.values(VIEWPORTS)) {
      collectRenderedDisplayText(model, viewport, strings);
    }
    collectTableDisplayText(model, strings);
  }

  return [...strings].filter(Boolean).sort(compareText);
}

function collectRenderedDisplayText(
  model: ScreenModel,
  viewport: ViewportProfile,
  strings: Set<string>,
): void {
  const rendered = renderScene(model, renderOptions(model, viewport));
  for (const match of rendered.template.matchAll(TEXT_TAG)) {
    const tag = match[0];
    const classes = CLASS_ATTRIBUTE.exec(tag)?.[1]?.split(/\s+/u).filter(Boolean) ?? [];
    const value = VALUE_ATTRIBUTE.exec(tag)?.[1];
    if (value === undefined) continue;
    const usesDisplayFont = classes.some((className) => (
      rendered.styles[className]?.fontFamily === DISPLAY_FONT_SENTINEL
    ));
    if (usesDisplayFont) strings.add(decodeMarkup(value));
  }
}

function collectTableDisplayText(model: ScreenModel, strings: Set<string>): void {
  if (!model.table) return;
  const { hand, myTurn, turnsOwed } = model.table;
  strings.add(myTurn
    ? turnsOwed > 1 ? `你还欠 ${turnsOwed} 个回合！` : "轮到你了"
    : model.subtitle ?? model.title ?? "等待其他玩家行动…");
  strings.add(!myTurn ? "现在不是你的回合" : turnsOwed > 1 ? "抽牌 · 完成 1 回合" : "抽一张");
  for (const card of hand) strings.add(card.name);
}

function productionScreenModels(): ScreenModel[] {
  const raw = {
    phase: "MATCH",
    authenticated: true,
    viewerId: "viewer",
    matchId: "display-font-coverage",
    room: { code: "482913", ownerId: "viewer", maxPlayers: 5, allowBots: true },
    players: [
      { id: "viewer", name: "蓝耳队长", avatarUrl: "assets/cats/player.png", ready: true, host: true },
      { id: "aju", name: "阿橘", avatarUrl: "assets/cats/a-ju.png", ready: true },
    ],
    you: {
      id: "viewer",
      name: "蓝耳队长",
      alive: true,
      hand: [
        { token: "attack", type: "ATTACK" },
        { token: "skip", type: "SKIP" },
        { token: "defuse", type: "DEFUSE" },
      ],
    },
    turn: { id: "turn-8", playerId: "viewer", number: 8, remaining: 2 },
    legalActions: [{ type: "Draw", turnId: "turn-8" }, { type: "Concede" }],
  } as const;
  const views = [
    normalizeProductView(raw, "local"),
    normalizeProductView(raw, "online"),
    normalizeProductView(raw, "connecting"),
  ];
  const contexts: SceneContext[] = views.flatMap((view) => [
    { view, now: 12_000, settings: { sound: true, vibration: true } },
    {
      view,
      now: 12_000,
      settings: { sound: false, vibration: false },
      joinCode: "482913",
      roomDraft: { maxPlayers: 5, turnSeconds: 60, allowBots: false },
      selectedTargetId: "aju",
      selectedTokens: ["attack"],
      declaredCardType: "ATTACK",
      insertionPosition: 1,
    },
  ]);
  const models: ScreenModel[] = [];
  for (const context of contexts) {
    for (const id of ALL_SCREEN_IDS) models.push(buildScreen(id, context));
    for (let tutorialStep = 0; tutorialStep < 3; tutorialStep += 1) {
      models.push(buildScreen("tutorial", { ...context, tutorialStep }));
    }
    for (let selectedCard = 0; selectedCard < 12; selectedCard += 1) {
      models.push(buildScreen("card-detail", { ...context, selectedCard }));
    }
  }
  return models;
}

function renderOptions(model: ScreenModel, viewport: ViewportProfile): RenderSceneOptions {
  const scale = viewport.width / DESIGN_WIDTH;
  const { left, top, right, bottom } = viewport.capsule;
  return {
    height: viewport.height / scale,
    safeTop: viewport.safeTop / scale,
    safeBottom: viewport.safeBottom / scale,
    capsule: {
      left: left / scale,
      top: top / scale,
      right: right / scale,
      bottom: bottom / scale,
      width: (right - left) / scale,
      height: (bottom - top) / scale,
    },
    canGoBack: !NO_BACK.has(model.id),
    selectedTokens: model.id === "give-card" ? ["attack"] : [],
    error: null,
    viewerId: "viewer",
    displayFont: DISPLAY_FONT_SENTINEL,
  };
}

function decodeMarkup(value: string): string {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (SCREEN_ORDER.length !== ALL_SCREEN_IDS.length) {
  throw new Error("DISPLAY_FONT_SCREEN_MATRIX_MISMATCH");
}
