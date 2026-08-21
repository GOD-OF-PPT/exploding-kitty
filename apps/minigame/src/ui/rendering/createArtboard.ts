import type { ScreenModel } from "../model";
import { escapeMarkup } from "./primitives";

export type CreateArtboardOptions = Readonly<{
  sending?: boolean;
  error?: string | null;
}>;

/**
 * One source of truth for the create-room scene. The supplied artboard owns the
 * default visual state; transparent controls preserve the real interaction
 * model, while small patches expose every non-default state.
 */
export function createArtboardContent(model: ScreenModel, options: CreateArtboardOptions = {}): string {
  const rows = new Map((model.rows ?? []).map((row, index) => [row.id, { row, index }]));
  const players = rows.get("players");
  const timer = rows.get("timer");
  const bots = rows.get("bots");
  const playersValue = players?.row.control?.kind === "stepper" ? players.row.control.value : "4 人";
  const timerValue = timer?.row.control?.kind === "stepper" ? timer.row.control.value : "45 秒";
  const botsEnabled = bots?.row.control?.kind === "toggle" ? bots.row.control.checked : true;
  const playerCount = Number.parseInt(playersValue, 10) || 4;
  const timerSeconds = Number.parseInt(timerValue, 10) || 45;
  const unavailable = options.sending ? " createHotDisabled" : "";
  const statePatches = [
    playersValue === "4 人" ? "" : createValuePatches("Player", playersValue),
    timerValue === "45 秒" ? "" : createValuePatches("Timer", timerValue),
    botsEnabled ? "" : `<view class="createBotStatePatch"><view class="createBotStateToggle"><text class="createBotStateLabel" value="已关闭"></text><view class="createBotStateThumb"></view></view></view>`,
    playersValue === "4 人" ? "" : `<text class="createReviewStateRow createReviewPlayersPatch" value="${escapeMarkup(`${playersValue}对局`)}"></text>`,
    timerValue === "45 秒" ? "" : `<text class="createReviewStateRow createReviewTimerPatch" value="${escapeMarkup(`每回合 ${timerValue}`)}"></text>`,
    botsEnabled ? "" : `<text class="createReviewStateRow createReviewBotsPatch" value="不允许机器人补位"></text>`,
    options.sending
      ? `<view class="createPrimarySendingShade"><text class="createPrimarySendingLabel" value="处理中…"></text><text class="createPrimarySendingHint" value="正在创建私人房间"></text></view>`
      : options.error
        ? `<text class="createPrimaryErrorPatch" value="${escapeMarkup(options.error)}"></text>`
        : "",
  ].join("");
  const actionAliases = (model.actions ?? []).slice(1).map((_, index) => `<button id="action-${index + 1}" class="createActionAlias"></button>`).join("");
  return `<scrollview id="scene-scroll" class="createScroll" scrollY="true"><view class="createCanvas"><image class="createArtboard" src="assets/ui/create/create-artboard.webp"></image>${statePatches}<button id="back" class="createHot createBackHot${unavailable}"></button><view id="row-${players?.index ?? 0}" class="createRowHit"></view><button id="row-${players?.index ?? 0}-down" class="createHot createPlayerDown${playerCount <= 2 ? " createHotDisabled" : unavailable}"></button><button id="row-${players?.index ?? 0}-up" class="createHot createPlayerUp${playerCount >= 5 ? " createHotDisabled" : unavailable}"></button><view id="row-${timer?.index ?? 1}" class="createRowHit"></view><button id="row-${timer?.index ?? 1}-down" class="createHot createTimerDown${timerSeconds <= 30 ? " createHotDisabled" : unavailable}"></button><button id="row-${timer?.index ?? 1}-up" class="createHot createTimerUp${timerSeconds >= 60 ? " createHotDisabled" : unavailable}"></button><button id="row-${bots?.index ?? 2}" class="createHot createBotHot${unavailable}"></button><view id="row-${rows.get("ruleset")?.index ?? 3}" class="createRulesHit"></view><button id="action-0" class="createHot createPrimaryHot${unavailable}"></button>${actionAliases}</view></scrollview>`;
}

function createValuePatches(kind: "Player" | "Timer", value: string): string {
  const [number = value, unit = ""] = value.split(" ");
  return `<view class="createStatePaperPatch create${kind}LargePatch"><text class="createStateNumber" value="${escapeMarkup(number)}"></text><text class="createStateUnit" value="${escapeMarkup(unit)}"></text></view><text class="createStateCurrent create${kind}CurrentPatch" value="${escapeMarkup(value)}"></text>`;
}
