import type { ScreenId, ScreenModel, ScreenRow } from "../model";
import {
  actions,
  body,
  cards,
  escapeMarkup,
  fitForSource,
  fitImage,
  frame,
  header,
  icon,
  rowIcon,
  rows,
  subtitle,
} from "./primitives";
import { createSceneStyles } from "./styles";
import type { RenderedScene, RenderSceneOptions, SceneRenderer, SceneRendererRegistry } from "./types";

const loginRenderer: SceneRenderer = (model, options) => {
  const [first, second] = splitBrand(model.title);
  const loginBurstLines = model.subtitle === "今晚谁先炸？" ? ["今晚", "谁先炸？"] : model.subtitle ? [model.subtitle] : [];
  const loginBurst = loginBurstLines.length
    ? `<view class="loginBurst">${loginBurstLines.map((line) => `<text class="loginBurstLine" value="${escapeMarkup(line)}"></text>`).join("")}</view>`
    : "";
  const cast = model.heroImage ? fitImage(model.heroImage, "loginCast", "contain", "center center") : "";
  const content = `<view class="safeTop"></view>${body(
    `<view class="brandLogo"><text class="brandLogoTop" value="${escapeMarkup(first)}"></text><text class="brandLogoBottom" value="${escapeMarkup(second)}"></text><text class="brandOriginal" value="${escapeMarkup(model.eyebrow ?? "原创回合制卡牌游戏")}"></text></view>${cast}${loginBurst}`,
    false,
    "sceneBody brandBody",
  )}${actions(model.actions, "stack")}<text class="loginLegal" value="登录即表示同意《用户协议》与《隐私政策》"></text>`;
  return frame(content, options, "red", "sceneLogin");
};

const homeRenderer: SceneRenderer = (model, options) => {
  const [first, second] = splitBrand(model.title);
  const tools = (model.rows ?? []).map((row, index) => `<button id="row-${index}" class="homeSettings">${icon(row.id === "settings" ? "gear" : "info")}</button>`).join("");
  const heroImage = model.heroImage ? fitImage(model.heroImage, "homeHeroImage", "contain", "center bottom") : "";
  const content = `<view class="safeTop"></view><view class="homeToolRow">${tools}</view>${body(
    `<text class="homeKicker" value="${escapeMarkup(model.eyebrow ?? "危险！毛茸茸！还会炸！")}"></text><view class="homeLogo"><text class="brandLogoTop" value="${escapeMarkup(first)}"></text><text class="brandLogoBottom" value="${escapeMarkup(second)}"></text></view><view class="homeHero">${heroImage}${model.heroLabel ? `<text class="homeBoom" value="${escapeMarkup(model.heroLabel)}"></text>` : ""}</view>`,
    false,
    "sceneBody homeBody",
  )}${actions(model.actions, "home")}<text class="versionTag" value="原创美术概念 · ORIGINAL-2025@1"></text>`;
  return frame(content, options, "ink", "sceneHome");
};

const playModeRenderer: SceneRenderer = (model, options) => {
  const image = model.heroImage ? fitImage(model.heroImage, "modeHeroImage", "contain", "center center") : "";
  const choices = (model.rows ?? []).map((row, index) => {
    const primary = index === 0 ? " modeChoicePrimary" : "";
    const symbol = index === 0 ? "plus" : "hash";
    return `<button id="row-${index}" class="modeChoice${primary}"><view class="modeChoiceIconBox">${icon(symbol, "cream")}</view><view class="modeChoiceCopy"><text class="modeChoiceTitle" value="${escapeMarkup(row.title)}"></text><text class="modeChoiceDetail" value="${escapeMarkup(row.detail ?? "")}"></text></view>${icon("caret-right", "ink", "rowCaret")}</button>`;
  }).join("");
  const content = `${header(model, options)}${body(`<view class="modeHero">${image}<text class="modeSticker" value="召集猫友！"></text></view><view class="modeChoices">${choices}</view><text class="modeTip" value="首版支持 2–5 人邀请房"></text>`, true)}${actions(model.actions, "links")}`;
  return frame(content, options);
};

const createRenderer: SceneRenderer = (model, options) => {
  const indexedRows = new Map((model.rows ?? []).map((row, index) => [row.id, { row, index }]));
  const players = indexedRows.get("players");
  const timer = indexedRows.get("timer");
  const bots = indexedRows.get("bots");
  const ruleset = indexedRows.get("ruleset");
  const playersValue = players?.row.control?.kind === "stepper"
    ? players.row.control.value
    : players?.row.badge ?? "4 人";
  const timerValue = timer?.row.control?.kind === "stepper"
    ? timer.row.control.value
    : timer?.row.badge ?? "45 秒";
  const botsEnabled = bots?.row.control?.kind === "toggle"
    ? bots.row.control.checked
    : bots?.row.badge
      ? bots.row.badge.includes("开启") || bots.row.badge.includes("允许")
      : true;
  const primary = model.actions?.[0];
  const primaryMarkup = options.sending
    ? `<view class="createPrimary createPrimaryDisabled"><fitimage class="createPrimaryBackground" src="assets/ui/create/cta-bg.webp" data-fit="contain" data-position="center center"></fitimage><view class="createPrimaryCopy"><text class="createPrimaryLabel" value="处理中…"></text><text class="createPrimaryHint" value="正在创建私人房间"></text></view></view>`
    : `<button id="action-0" class="createPrimary"><fitimage class="createPrimaryBackground" src="assets/ui/create/cta-bg.webp" data-fit="contain" data-position="center center"></fitimage><view class="createPrimaryCopy"><text class="createPrimaryLabel" value="${escapeMarkup(primary?.label ?? "创建房间")}"></text><text class="createPrimaryHint" value="创建后即可邀请好友"></text></view></button>`;
  const stepperCard = (entry: typeof players, fallbackIndex: number, value: string) => {
    const index = entry?.index ?? fallbackIndex;
    return `<view id="row-${index}" class="formRow rowInteractive"><view class="createControlCard"><view class="createControlCopy"><text class="createControlTitle" value="${escapeMarkup(entry?.row.title ?? "设置")}"></text><text class="createControlDetail" value="${escapeMarkup(entry?.row.detail ?? "")}"></text></view><text class="createControlValue" value="${escapeMarkup(value)}"></text><view class="createStepper"><button id="row-${index}-down" class="createStepperButton" value="−"></button><text class="createStepperCurrent" value="${escapeMarkup(value)}"></text><button id="row-${index}-up" class="createStepperButton" value="+"></button></view></view><text class="formDetail" value="${escapeMarkup(entry?.row.detail ?? "")}"></text><view class="formStepper"></view></view>`;
  };
  const reviewRow = (label: string) => `<view class="createReviewRow"><fitimage class="createReviewBullet" src="assets/ui/create/burst.png" data-fit="contain" data-position="center center"></fitimage><text class="createReviewText" value="${escapeMarkup(label)}"></text></view>`;
  const actionAliases = (model.actions ?? []).slice(1).map((_, index) => `<button id="action-${index + 1}" class="createActionAlias"></button>`).join("");
  const content = `<view class="safeTop"></view><view class="createHeader"><button id="back" class="createBack">${icon("arrow-left", "cream", "createBackIcon")}</button><view class="createHeaderCopy"><fitimage class="createHeaderAccent" src="assets/ui/create/header-accent.webp" data-fit="contain" data-position="center center"></fitimage><text class="createEyebrow" value="${escapeMarkup(model.eyebrow ?? "PRIVATE ROOM")}"></text><text class="createHeaderTitle" value="${escapeMarkup(model.title)}"></text></view><view class="createHeaderSpacer"></view></view><view class="createControlGrid">${stepperCard(players, 0, playersValue)}${stepperCard(timer, 1, timerValue)}</view><button id="row-${bots?.index ?? 2}" class="formRow formRowDark rowInteractive"><view class="createBotCard createBotCardNested"><view class="createBotCopy"><text class="createBotTitle" value="${escapeMarkup(bots?.row.title ?? "机器人补位")}"></text><text class="createBotDetail" value="${escapeMarkup(bots?.row.detail ?? "人数不足时自动补位")}"></text></view><view class="createBotToggle${botsEnabled ? " createBotToggleOn" : ""}"><text class="createBotToggleLabel${botsEnabled ? " createBotToggleLabelOn" : " createBotToggleLabelOff"}" value="${botsEnabled ? "已开启" : "已关闭"}"></text><view class="createBotThumb"></view></view></view><text class="formDetail" value="${escapeMarkup(bots?.row.detail ?? "")}"></text><view class="toggleSwitch${botsEnabled ? " toggleSwitchOn" : ""}"></view></button><view id="row-${ruleset?.index ?? 3}" class="formRow formRowStamp"><view class="createReview createReviewNested"><view class="createReviewHeader">${icon("book-open", "cream", "createReviewIcon")}<text class="createReviewTitle" value="${escapeMarkup(ruleset?.row.title ?? "原创规则 · 2025 基础版")}"></text></view>${reviewRow(`${playersValue}对局`)}${reviewRow(`每回合 ${timerValue}`)}${reviewRow(botsEnabled ? "允许机器人补位" : "不允许机器人补位")}</view><text class="formDetail" value="${escapeMarkup(ruleset?.row.detail ?? "")}"></text></view><view class="createActionDock">${primaryMarkup}</view>${actionAliases}`;
  return frame(content, options, "ink", "sceneCreate");
};

const joinRenderer: SceneRenderer = (model, options) => {
  const image = model.heroImage ? fitImage(model.heroImage, "joinHeroImage", "contain", "center center") : "";
  const codeRows = (model.rows ?? []).map((row, index) => {
    const code = row.detail?.trim() ?? "";
    const valueClass = code ? "codeValue" : "codeValue codePlaceholder";
    return `<button id="row-${index}" class="codeBox"><text class="codeLabel" value="${escapeMarkup(row.title)}"></text><text class="${valueClass}" value="${escapeMarkup(code || "· · · · · ·")}"></text></button>`;
  }).join("");
  const code = model.rows?.find((row) => row.id === "room-code")?.detail?.trim() ?? "";
  const content = `${header(model, options)}${body(`<view class="joinHero">${image}</view><view class="joinPrompt"><text class="joinPromptTitle" value="找到那群猫了吗？"></text>${subtitle(model.subtitle, "joinPromptDetail")}</view>${codeRows}`, true)}${joinActions(model, /^\d{6}$/.test(code))}`;
  return frame(content, options);
};

const lobbyRenderer: SceneRenderer = (model, options) => {
  const roomCode = roomCodeFrom(model.eyebrow);
  const host = model.rows?.find((row) => row.title.includes("房主"));
  const hostName = host?.title.replace(/\s*·\s*房主\s*$/u, "").trim();
  const lead = model.id === "lobby-host"
    ? `<view class="lobbyCode"><text class="lobbyCodeLabel" value="房间码\n分享给好友"></text><text class="lobbyCodeValue" value="${escapeMarkup(formatRoomCode(roomCode))}"></text></view>`
    : `<view class="lobbyHostStrip">${fitImage(host?.image ?? "assets/cats/a-ju.png", "lobbyHostIcon", "contain")}<text class="lobbyHostText" value="${escapeMarkup(`${hostName ? `${hostName} · ` : ""}${model.subtitle ?? "房主正在调整规则"}`)}"></text></view>`;
  const seats = lobbySeats(model.rows, options.viewerId, model.id);
  const content = `${header(model, options)}${body(`${lead}${seats}<text class="lobbyNote" value="${escapeMarkup(model.id === "lobby-host" ? model.subtitle ?? "所有人准备后即可开始" : "基础版 2025 · 轻松计时 · 允许机器人")}"></text>`, true)}${actions(model.actions, "grid")}`;
  return frame(content, options);
};

const tableRenderer: SceneRenderer = (model, options) => {
  if (!model.table) throw new Error(`TABLE_MODEL_REQUIRED:${model.id}`);
  const activeName = model.id === "other-turn" ? activePlayerName(model.subtitle) : null;
  const opponents = opponentMarkup(model, options, activeName);
  const hints = (model.rows ?? []).map((row, index) => `<button id="row-${index}" class="tableHint"><text class="tableHintTitle" value="${escapeMarkup(row.title)}"></text><text class="tableHintDetail" value="${escapeMarkup(row.detail ?? "")}"></text></button>`).join("");
  const debt = model.id === "attack" || (model.table.myTurn && model.table.turnsOwed > 1)
    ? `<view class="debtStamp warningCallout"><text class="debtText" value="${escapeMarkup(model.heroLabel || `×${model.table.turnsOwed}\n欠回合`)}"></text></view>`
    : "";
  const seconds = countdownFrom(model.eyebrow);
  const timer = seconds === "…" ? "" : `<view class="tableTurnTimer"><text class="tableTurnTimerLabel" value="${escapeMarkup(seconds)} 秒"></text></view>`;
  const turnStatus = model.id === "other-turn" ? model.subtitle ?? model.title : model.title;
  const context = model.eyebrow?.replace(/\s*·?\s*\d+\s*秒\s*$/, "") ?? "";
  const content = `<view class="safeTop"></view><view class="tableBody"><view class="tableTopbar"><text class="tableTurnStatus" value="${escapeMarkup(turnStatus)}"></text>${timer}</view>${context ? `<text class="tableTopText" value="${escapeMarkup(context)}"></text>` : ""}<view class="opponentStrip">${opponents}</view><canvas id="tableCanvas" class="tableCanvas" width="358" height="520"></canvas>${hints}${debt}</view>${actions(model.actions, "table")}`;
  return frame(content, options, "ink", "sceneTable");
};

const responseRenderer: SceneRenderer = (model, options) => {
  const actor = fitImage(model.heroImage ?? "assets/cats/a-ju.png", "responseHero", "contain", "center bottom");
  const backdrop = model.table
    ? `<view class="responseTableContext"><view class="opponentStrip">${opponentMarkup(model, options)}</view><canvas id="tableCanvas" class="tableCanvas" width="358" height="520"></canvas></view><view class="responseBackdropScrim"></view>`
    : `<view class="responseBackdrop">${fitImage("assets/cards/card-back.png", "responseBackdropCard", "contain")}</view>`;
  const seconds = countdownFrom(model.eyebrow);
  const passIndex = model.actions?.findIndex((action) => action.id === "pass" || action.intent?.type === "PassResponse") ?? -1;
  const close = passIndex < 0 && options.canGoBack
      ? `<button id="back" class="responseClose" aria-label="关闭">${icon("plus", "ink", "responseCloseIcon")}</button>`
      : "";
  const sheet = `<view class="responseModal"><view class="modalSurface responseSheet">${actor}<text class="responseKicker" value="所有存活玩家都可以响应"></text><text class="responseTitle" value="${escapeMarkup(model.title)}"></text><view class="countdown"><text class="countdownText" value="${escapeMarkup(seconds)}"></text><text class="countdownUnit" value="秒"></text></view>${subtitle(model.subtitle, "responseSubtitle")}</view>${close}</view>`;
  return frame(`<view class="safeTop"></view>${backdrop}${sheet}${responseActionDock(model)}`, options, "ink", "sceneResponse");
};

const favorRenderer: SceneRenderer = (model, options) => {
  const image = model.heroImage ? fitImage(model.heroImage, "choiceHero", "contain", "center center") : "";
  const content = `${header(model, options)}${body(`${image}<view class="choicePrompt"><text class="choicePromptTitle" value="谁来成为这次的目标？"></text>${subtitle(model.subtitle, "choicePromptDetail")}</view>${choiceTargetRows(model.rows)}`, true, "sceneBody choiceBody")}${actions(model.actions, "links")}`;
  return frame(content, options);
};

const giveCardRenderer: SceneRenderer = (model, options) => {
  const heroSource = model.heroImage ?? "assets/cats/tuan-zi.png";
  const recipient = giveRecipientFrom(model);
  const banner = `<view class="giveBanner">${fitImage(heroSource, "giveHero", fitForSource(heroSource), "center center")}<view class="giveCopy"><text class="giveTitle" value="${escapeMarkup(model.title)}"></text>${subtitle(model.subtitle, "giveDetail")}</view></view>`;
  const recipientBar = `<view class="giveRecipient"><text class="giveRecipientLabel" value="${escapeMarkup(recipient)}"></text></view>`;
  const privacy = `<view class="privacyRow">${icon("lock", "cream", "privacyIcon")}<text class="privacyNote" value="超时后服务器会随机选择一张"></text></view>`;
  const content = `${header(model, options)}${body(`${banner}${recipientBar}${cards(model.cards, options.selectedTokens, "give")}${privacy}`, true)}${actions(model.actions, "stack")}`;
  return frame(content, options);
};

const futureRenderer: SceneRenderer = (model, options) => {
  const eyeSource = model.heroImage ?? "assets/cards/peek.png";
  const content = `${header(model, options)}${body(`${fitImage(eyeSource, "choiceHero", "contain", "center center")}${cards(model.cards, options.selectedTokens, "ordered")}<text class="privacyNote" value="顺序不会改变，其他人看不到"></text>`, true, "sceneBody choiceBody")}${actions(model.actions, "stack")}`;
  return frame(content, options);
};

const defuseRenderer: SceneRenderer = (model, options) => {
  const source = model.heroImage ?? "assets/cards/defuse.png";
  const deckCount = Number(deckCountFrom(model.subtitle) ?? 0);
  const rows = model.rows ?? [];
  const previousIndex = rows.findIndex((row) => row.id === "position-prev");
  const currentIndex = rows.findIndex((row) => row.id === "position-current");
  const nextIndex = rows.findIndex((row) => row.id === "position-next");
  const current = rows[currentIndex >= 0 ? currentIndex : 0];
  const label = current?.badge ?? current?.title ?? "当前位置";
  const previous = previousIndex >= 0
    ? `<button id="row-${previousIndex}" class="defuseStepButton">${icon("arrow-left", "ink", "defuseStepIcon")}<text class="defuseStepLabel" value="向牌堆顶"></text></button>`
    : "";
  const position = `<view id="row-${currentIndex >= 0 ? currentIndex : 0}" class="defusePosition defusePositionSelected"><text class="defusePositionLabel" value="${escapeMarkup(label)}"></text><text class="defusePositionDetail" value="${escapeMarkup(current?.detail ?? "当前可选位置")}"></text></view>`;
  const next = nextIndex >= 0
    ? `<button id="row-${nextIndex}" class="defuseStepButton"><text class="defuseStepLabel" value="向牌堆底"></text>${icon("caret-right", "ink", "defuseStepIcon")}</button>`
    : "";
  const selector = `<view class="defuseSelector"><text class="defuseEndpoint" value="牌堆顶 · 第 1 个位置"></text><view class="defuseTrack"><view class="defuseStepper">${previous}${position}${next}</view></view><text class="defuseEndpoint" value="${escapeMarkup(deckCount > 0 ? `牌堆底 · 第 ${deckCount + 1} 个位置` : "牌堆底")}"></text></view>`;
  const content = `${header(model, options)}${body(`${fitImage(source, "choiceHero", "contain", "center center")}<view class="choicePrompt"><text class="choicePromptTitle" value="偷偷放回牌堆"></text>${subtitle(model.subtitle, "choicePromptDetail")}</view>${selector}`, true, "sceneBody choiceBody")}${actions(model.actions, "stack")}`;
  return frame(content, options);
};

const explosionRenderer: SceneRenderer = (model, options) => {
  const source = model.heroImage ?? "assets/cards/danger.png";
  const content = `<view class="safeTop"></view>${body(`<text class="explosionWord" value="${escapeMarkup(model.heroLabel || "砰！")}"></text>${fitImage(source, "explosionHero", "contain", "center center")}<text class="outcomeTitle" value="${escapeMarkup(model.title)}"></text>${subtitle(model.subtitle, "outcomeSubtitle")}`, true, "sceneBody outcomeBody")}${actions(model.actions, "links")}`;
  return frame(content, options, "red", "sceneExplosion");
};

const eliminatedRenderer: SceneRenderer = (model, options) => {
  const source = model.heroImage ?? "assets/cats/player.png";
  const placement = (model.rows ?? []).map((row, index) => `<button id="row-${index}" class="placementCard"><text class="placementDetail placementKicker" value="${escapeMarkup(row.title)}"></text><text class="placementTitle" value="${escapeMarkup(row.badge ?? "已淘汰")}"></text><text class="placementDetail placementReason" value="${escapeMarkup(row.detail ?? "")}"></text></button>`).join("");
  const content = `<view class="safeTop"></view>${body(`<text class="eliminatedStamp" value="砰！"></text><text class="outcomeTitle" value="${escapeMarkup(model.title)}"></text>${subtitle(model.subtitle, "outcomeSubtitle")}${fitImage(source, "eliminatedHero", "contain", "center bottom")}${placement}`, true, "sceneBody outcomeBody")}${actions(model.actions, "links")}`;
  return frame(content, options, "red", "sceneEliminated");
};

const resultRenderer: SceneRenderer = (model, options) => {
  const winner = model.heroImage ?? "assets/cats/tuan-zi.png";
  const content = `${header(model, options)}${body(`<view class="winnerHero"><text class="winnerLabel" value="${escapeMarkup(model.heroLabel || "WINNER")}"></text><view class="winnerAura">${fitImage(winner, "winnerImage", "contain", "center bottom")}</view>${subtitle(model.subtitle, "choicePromptDetail winnerDetail")}</view>${resultRanking(model.rows, options.viewerId)}`, true)}${actions(model.actions, "links")}`;
  return frame(content, options, "ink", "sceneResult");
};

const tutorialRenderer: SceneRenderer = (model, options) => {
  const source = model.heroImage ?? "assets/cats/player.png";
  const step = localizedTutorialStep(model.heroLabel ?? model.eyebrow);
  const tutorialRows = (model.rows ?? []).map((row, index) => `<button id="row-${index}" class="tutorialCopy"><text class="tutorialStep" value="${escapeMarkup(step)}"></text><text class="tutorialTitle" value="${escapeMarkup(row.title)}"></text><text class="tutorialDetail" value="${escapeMarkup(model.subtitle ?? row.detail ?? "")}"></text><text class="tutorialDots" value="${escapeMarkup(row.detail ?? "")}"></text></button>`).join("");
  const content = `${header(model, options)}${body(`<view class="tutorialBurst">${fitImage(source, "tutorialImage", fitForSource(source), "center center")}</view>${tutorialRows}`, true, "sceneBody tutorialBody")}${actions(model.actions, "links")}`;
  return frame(content, options);
};

const rulesRenderer: SceneRenderer = (model, options) => {
  const tabs = `<view class="ruleTabs"><text class="ruleTab ruleTabActive" value="卡牌"></text><text class="ruleTab" value="组合技"></text><text class="ruleTab" value="回合流程"></text><text class="ruleTab" value="平台"></text></view>`;
  const repairedRows = model.rows?.map((row) => ({
    ...row,
    title: repairRuleCopy(row.title),
    ...(row.detail ? { detail: repairRuleCopy(row.detail) } : {}),
  }));
  const content = `${header(model, options)}${body(`${tabs}${rows(repairedRows, "paper")}<view class="rulesBottomSpacer"></view>`, true)}${actions(model.actions, "links")}`;
  return frame(content, options);
};

const cardDetailRenderer: SceneRenderer = (model, options) => {
  const source = model.heroImage ?? "assets/cards/attack.png";
  const coreRule = model.subtitle ? `<text class="detailRule" value="${escapeMarkup(`核心牌效 · ${repairRuleCopy(model.subtitle)}`)}"></text>` : "";
  const content = `${header(model, options)}${body(`${fitImage(source, "detailHero", "contain", "center center")}<view class="detailCopy"><text class="detailTitle" value="${escapeMarkup(model.title)}"></text></view>${coreRule}${rows(model.rows, "fact")}`, true)}${actions(model.actions, "links")}`;
  return frame(content, options);
};

const historyRenderer: SceneRenderer = (model, options) => {
  const content = `${header(model, options)}${body(`${rows(model.rows, "timeline")}<text class="historyTip" value="私密手牌和牌堆顺序不会公开"></text>`, true)}${actions(model.actions, "links")}`;
  return frame(content, options);
};

const gameMenuRenderer: SceneRenderer = (model, options) => {
  const source = model.heroImage ?? "assets/cats/player.png";
  const hasConcede = model.actions?.some((action) => action.intent?.type === "Concede") ?? false;
  const warningCopy = model.subtitle?.startsWith("警告：")
    ? model.subtitle
    : `警告：${model.subtitle ?? "认输会立即结束你在本局的操作；你仍可继续观战。"}`;
  const warning = hasConcede
    ? `<text class="dangerNote warningCallout" value="${escapeMarkup(warningCopy)}"></text>`
    : "";
  const content = `${header(model, options)}${body(`<view class="menuHero">${fitImage(source, "menuHeroImage", "contain", "center bottom")}</view>${rows(model.rows, "menu")}${warning}`, true)}${actions(model.actions, "links")}`;
  return frame(content, options);
};

const networkRenderer: SceneRenderer = (model, options) => {
  const local = /^(?:LOCAL|本机)$/i.test(model.heroLabel?.trim() ?? "") || model.title === "本地状态正常";
  const online = /^(?:ONLINE|已连接|在线)$/i.test(model.heroLabel?.trim() ?? "") || model.title === "连接稳定";
  const progress = local
    ? "状态来源：当前回合与私有状态来自本机演示会话"
    : online
      ? "同步状态：当前回合与私有状态已是最新"
      : "恢复状态：正在同步当前回合与最新私有状态";
  const localizedRows = model.rows?.map((row) => ({ ...row, ...(row.badge ? { badge: localizedConnectionState(row.badge) } : {}) }));
  const progressTrack = local ? "" : `<view class="syncTrack"><view class="syncFill${online ? " syncFillOnline" : ""}"></view></view>`;
  const networkHero = fitImage(
    `assets/ui/icons/cream/${online ? "check-hero" : "device-mobile-hero"}.png`,
    "networkIcon",
    "contain",
  );
  const content = `<scrollview id="scene-scroll" class="networkBody scrollBody" scrollY="true">${networkHero}<text class="networkKicker" value="${escapeMarkup(model.eyebrow ?? "对局仍在服务器继续")}"></text><text class="networkTitle" value="${escapeMarkup(model.title)}"></text>${subtitle(model.subtitle, "networkSubtitle")}<text class="networkProgressLabel" value="${progress}"></text>${progressTrack}${rows(localizedRows, "fact")}</scrollview>${actions(model.actions, "links")}`;
  return frame(content, options, "ink", "sceneNetwork");
};

const settingsRenderer: SceneRenderer = (model, options) => {
  const localizedModel = model.eyebrow === "THIS DEVICE" ? { ...model, eyebrow: "当前设备" } : model;
  const ultraShort = options.height <= 520;
  const back = options.canGoBack
    ? `<button id="back" class="createBack">${icon("arrow-left", "cream", "createBackIcon")}</button>`
    : `<view class="createHeaderSpacer"></view>`;
  const profileKicker = ultraShort ? "" : `<text class="settingsProfileKicker" value="DEVICE PROFILE"></text>`;
  const profileDetail = ultraShort ? "自动保存" : "调整后立即生效并自动保存";
  const profile = `<view class="settingsProfile">${fitImage(model.heroImage ?? "assets/ui/home/settings.png", "settingsAvatar", "contain", "center center")}<view class="settingsCopy">${profileKicker}<text class="settingsName" value="${escapeMarkup(model.heroLabel ?? "本机偏好")}"></text><text class="settingsDetail" value="${profileDetail}"></text></view><view class="settingsProfileBadge">${icon("check", "ink", "settingsProfileBadgeIcon")}<text class="settingsProfileBadgeText" value="仅本机"></text></view></view>`;
  const primary = model.actions?.[0];
  const primaryMarkup = primary
    ? `<button id="action-0" class="settingsPrimary">${fitImage("assets/ui/create/cta-bg.webp", "settingsPrimaryBackground", "contain", "center center")}<view class="settingsPrimaryCopy"><text class="settingsPrimaryLabel" value="${escapeMarkup(primary.label)}"></text></view></button>`
    : "";
  const actionAliases = (model.actions ?? []).slice(1).map((_, index) => `<button id="action-${index + 1}" class="createActionAlias"></button>`).join("");
  const content = `<view class="safeTop"></view><view class="createHeader settingsHeader">${back}<view class="createHeaderCopy settingsHeaderCopy">${fitImage("assets/ui/create/header-accent.webp", "createHeaderAccent", "contain", "center center")}<text class="eyebrow" value="${escapeMarkup(localizedModel.eyebrow ?? "当前设备")}"></text><text class="settingsHeaderTitle" value="${escapeMarkup(localizedModel.title)}"></text></view><view class="createHeaderSpacer"></view></view><scrollview id="scene-scroll" class="settingsBody scrollBody" scrollY="true">${profile}${settingsRows(model.rows, ultraShort)}</scrollview><view class="actionDock settingsActionDock">${primaryMarkup}</view>${actionAliases}`;
  return frame(content, options, "ink", "sceneSettings");
};

export const SCENE_RENDERERS: SceneRendererRegistry = {
  login: loginRenderer,
  home: homeRenderer,
  "play-mode": playModeRenderer,
  create: createRenderer,
  join: joinRenderer,
  "lobby-host": lobbyRenderer,
  "lobby-member": lobbyRenderer,
  game: tableRenderer,
  "other-turn": tableRenderer,
  attack: tableRenderer,
  response: responseRenderer,
  favor: favorRenderer,
  "give-card": giveCardRenderer,
  future: futureRenderer,
  explosion: explosionRenderer,
  defuse: defuseRenderer,
  eliminated: eliminatedRenderer,
  result: resultRenderer,
  tutorial: tutorialRenderer,
  rules: rulesRenderer,
  "card-detail": cardDetailRenderer,
  history: historyRenderer,
  "game-menu": gameMenuRenderer,
  network: networkRenderer,
  settings: settingsRenderer,
};

export function renderScene(model: ScreenModel, options: RenderSceneOptions): RenderedScene {
  const renderer = SCENE_RENDERERS[model.id];
  if (!renderer) throw new Error(`SCENE_RENDERER_MISSING:${String(model.id)}`);
  return {
    template: renderer(model, options),
    styles: createSceneStyles(model, options),
  };
}

function splitBrand(title: string): [string, string] {
  const normalized = title.trim();
  if (normalized.length >= 4) {
    const middle = Math.ceil(normalized.length / 2);
    return [normalized.slice(0, middle), normalized.slice(middle)];
  }
  return [normalized, "危机"];
}

function roomCodeFrom(value: string | undefined): string {
  return value?.match(/\d{6}/)?.[0] ?? "------";
}

function lobbySeats(
  values: readonly ScreenRow[] | undefined,
  viewerId: string,
  lobbyId: ScreenModel["id"],
): string {
  if (!values?.length) return "";
  return `<view class="rowList rowListSeat">${values.map((row, index) => {
    if (row.id === "invite") {
      const interactive = row.action ? " rowInteractive" : "";
      return `<button id="row-${index}" class="row rowSeat rowSelected${interactive}"><view class="modeChoiceIconBox">${icon("share-network", "cream")}</view><view class="rowCopy rowCopySeat"><text class="rowTitle rowTitleSeat" value="${escapeMarkup(row.title)}"></text>${row.detail ? `<text class="rowDetail rowDetailSeat" value="${escapeMarkup(row.detail)}"></text>` : ""}</view></button>`;
    }
    const isSelf = row.id === viewerId;
    const interactive = row.action ? " rowInteractive" : "";
    const selfClass = isSelf ? " selfSeat" : "";
    const avatar = row.image ? fitImage(row.image, "seatAvatar", fitForSource(row.image), "center center") : "";
    const state = isSelf
      ? row.detail === "已准备"
        ? lobbyId === "lobby-member" ? "正在准备" : "已准备"
        : row.detail === "等待准备" ? "尚未准备" : row.detail ?? "准备状态未知"
      : row.detail ?? "";
    return `<button id="row-${index}" class="row rowSeat${selfClass}${interactive}">${avatar}${isSelf ? `<text class="selfBadge" value="你"></text>` : ""}<view class="rowCopy rowCopySeat"><text class="rowTitle rowTitleSeat" value="${escapeMarkup(row.title)}"></text>${state ? `<text class="rowDetail rowDetailSeat" value="${escapeMarkup(state)}"></text>` : ""}</view>${row.badge ? `<text class="rowBadge" value="${escapeMarkup(row.badge)}"></text>` : ""}</button>`;
  }).join("")}</view>`;
}

function resultRanking(values: readonly ScreenRow[] | undefined, viewerId: string): string {
  if (!values?.length) return "";
  return `<view class="rowList rowListRank">${values.map((row, index) => {
    const avatar = row.image ? fitImage(row.image, "rankAvatar", fitForSource(row.image), "center center") : "";
    const isViewer = row.id === viewerId;
    const you = isViewer ? `<text class="winnerYou" value="YOU"></text>` : "";
    const badge = isViewer ? row.badge?.replace(/^YOU\s*·\s*/i, "") : row.badge;
    return `<button id="row-${index}" class="row rowRank">${avatar}<view class="rowCopy rowCopyRank"><text class="rowTitle rowTitleRank" value="${escapeMarkup(row.title)}"></text>${row.detail ? `<text class="rowDetail rowDetailRank" value="${escapeMarkup(row.detail)}"></text>` : ""}</view>${you}${badge ? `<text class="rowBadge" value="${escapeMarkup(badge)}"></text>` : ""}</button>`;
  }).join("")}</view>`;
}

function settingsRows(values: readonly ScreenRow[] | undefined, ultraShort = false): string {
  if (!values?.length) return "";
  const toggles: string[] = [];
  const links: string[] = [];
  let privacy = "";
  values.forEach((row, index) => {
    const controlAction = row.control?.kind === "toggle" ? row.control.action : undefined;
    const interactive = row.action || controlAction ? " rowInteractive" : "";
    if (row.id === "sound" || row.id === "vibration") {
      const badgeValue = row.badge?.trim().toLowerCase() ?? "";
      const enabled = row.control?.kind === "toggle"
        ? row.control.checked
        : badgeValue === "开" || badgeValue === "on" || (badgeValue.includes("开启") && !badgeValue.includes("关闭"));
      const switchClass = enabled ? "toggleSwitch settingsToggle toggleSwitchOn settingsToggleOn" : "toggleSwitch settingsToggle";
      const iconToneClass = row.id === "sound" ? " settingsControlIconSound" : " settingsControlIconVibration";
      const controlIcon = row.id === "vibration" ? "device-mobile" : rowIcon(row);
      const state = ultraShort ? "" : `<text class="settingsControlState${enabled ? " settingsControlStateOn" : ""}" value="${enabled ? "当前已开启" : "当前已关闭"}"></text>`;
      toggles.push(`<button id="row-${index}" class="row rowSetting settingsControl${interactive}"><view class="settingsControlIconBox${iconToneClass}">${icon(controlIcon, "cream", "settingsControlIcon")}</view><view class="rowCopy rowCopySetting settingsControlCopy"><text class="rowTitle rowTitleSetting settingsControlTitle" value="${escapeMarkup(row.title)}"></text><text class="rowDetail rowDetailSetting settingsControlDetail" value="${escapeMarkup(row.detail ?? "只影响当前设备")}"></text>${state}</view><view class="${switchClass}"><view class="toggleKnob settingsToggleKnob${enabled ? " toggleKnobOn settingsToggleKnobOn" : ""}"></view><text class="settingsToggleLabel${enabled ? " settingsToggleLabelOn" : ""}" value="${enabled ? "开" : "关"}"></text></view></button>`);
      return;
    }
    if (row.id === "privacy") {
      const privacyRow = (label: string) => `<view class="settingsPrivacyRow">${fitImage("assets/ui/create/burst.png", "settingsPrivacyBullet", "contain", "center center")}<text class="settingsPrivacyText" value="${escapeMarkup(label)}"></text></view>`;
      privacy = `<view id="row-${index}" class="row rowSetting settingsPrivacy"><view class="settingsPrivacyHeader">${icon("lock", "cream", "settingsPrivacyIcon")}<view class="settingsPrivacyCopy"><text class="settingsPrivacyTitle" value="${escapeMarkup(row.title)}"></text><text class="settingsPrivacyDetail" value="${escapeMarkup(row.detail ?? "仅保存恢复牌局所需信息")}"></text></view></view>${privacyRow("声音与触感偏好只保存在本机")}${privacyRow("只保留恢复牌局所需的会话信息")}</view>`;
      return;
    }
    const image = icon(rowIcon(row), "ink", "rowIcon");
    const copy = `<view class="rowCopy rowCopySetting"><text class="rowTitle rowTitleSetting" value="${escapeMarkup(row.title)}"></text>${row.detail ? `<text class="rowDetail rowDetailSetting" value="${escapeMarkup(row.detail)}"></text>` : ""}</view>`;
    const caret = row.action ? icon("caret-right", "ink", "rowCaret") : "";
    links.push(`<button id="row-${index}" class="row rowSetting settingsLink${interactive}">${image}${copy}${row.badge ? `<text class="rowBadge" value="${escapeMarkup(row.badge)}"></text>` : ""}${caret}</button>`);
  });
  return `<view class="rowList rowListSetting settingsControlList">${toggles.join("")}${privacy}<view class="settingsLinks">${links.join("")}</view></view>`;
}

function choiceTargetRows(values: readonly ScreenRow[] | undefined): string {
  if (!values?.length) return "";
  return `<view class="rowList rowListPaper">${values.map((row, index) => {
    const selected = row.badge === "已选择";
    const selectedClass = selected ? " rowSelected" : "";
    const interactive = row.action ? " rowInteractive" : "";
    const image = row.image ? fitImage(row.image, "rowImage", fitForSource(row.image), "center center") : icon(rowIcon(row), "ink", "rowIcon");
    const badge = selected
      ? `<text class="selectionMark" value="✓ 已选择"></text>`
      : row.badge ? `<text class="rowBadge" value="${escapeMarkup(row.badge)}"></text>` : "";
    const caret = row.action && !selected ? icon("caret-right", "ink", "rowCaret") : "";
    const title = selected ? row.title.replace(/^✓\s*/, "") : row.title;
    return `<button id="row-${index}" class="row rowPaper${selectedClass}${interactive}">${image}<view class="rowCopy rowCopyPaper"><text class="rowTitle rowTitlePaper" value="${escapeMarkup(title)}"></text>${row.detail ? `<text class="rowDetail rowDetailPaper" value="${escapeMarkup(row.detail)}"></text>` : ""}</view>${badge}${caret}</button>`;
  }).join("")}</view>`;
}

function joinActions(model: ScreenModel, validCode: boolean): string {
  if (validCode) return actions(model.actions, "links");
  const joinIndex = model.actions?.findIndex((action) => action.id === "join" || action.intent?.type === "JoinRoom") ?? -1;
  if (joinIndex < 0) return actions(model.actions, "links");
  const disabledActions = model.actions?.map((action, index) => index === joinIndex
    ? { id: action.id, label: action.label, ...(action.tone ? { tone: action.tone } : {}) }
    : action);
  return actions(disabledActions, "links");
}

function localizedConnectionState(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "online":
    case "connected":
      return "已连接";
    case "offline":
      return "离线重连中";
    case "reconnecting":
    case "sync":
    case "syncing":
      return "正在重连";
    default:
      return value;
  }
}

function giveRecipientFrom(model: ScreenModel): string {
  const label = model.heroLabel?.trim();
  if (label) return label.startsWith("接收者") ? label : `接收者：${label}`;
  const name = model.title.match(/^交给(.+?)一张牌/)?.[1]?.trim();
  return name && name !== "对方" ? `接收者：${name}` : "接收者：对方玩家";
}

function localizedTutorialStep(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (/^第\s*\d+\s*步$/.test(normalized)) return normalized.replace(/\s+/g, " ");
  const number = normalized.match(/\d+/)?.[0];
  return number ? `第 ${number} 步` : "教学步骤";
}

function repairRuleCopy(value: string): string {
  return value.replaceAll("当前次回合", "当前回合");
}

function formatRoomCode(value: string): string {
  return /^\d{6}$/.test(value) ? `${value.slice(0, 3)} ${value.slice(3)}` : value;
}

function countdownFrom(value: string | undefined): string {
  return value?.match(/(\d+)\s*秒/)?.[1] ?? value?.match(/\d+/)?.[0] ?? "…";
}

function deckCountFrom(value: string | undefined): string | null {
  return value?.match(/(\d+)\s*张/)?.[1] ?? null;
}

function opponentMarkup(model: ScreenModel, options: RenderSceneOptions, activeName: string | null = null): string {
  if (!model.table) return "";
  return model.table.players
    .filter((player) => player.id !== options.viewerId)
    .map((player) => {
      const active = player.name === activeName;
      return `<view class="opponent${active ? " tableCurrentPlayer" : ""}">${fitImage(player.avatar, "opponentAvatar", "contain", "center center")}<text class="opponentName" value="${escapeMarkup(player.name)}"></text><text class="opponentCount" value="${player.handCount}"></text>${active ? `<text class="tableCurrentMark" value="当前"></text>` : ""}</view>`;
    })
    .join("");
}

function activePlayerName(value: string | undefined): string | null {
  return value?.match(/^等待\s*(.+?)\s*行动/)?.[1]?.trim() ?? null;
}

function responseActionDock(model: ScreenModel): string {
  const buttons = (model.actions ?? []).map((action, index) => {
    const tone = action.tone ?? "yellow";
    const toneName = tone.charAt(0).toUpperCase() + tone.slice(1);
    const secondary = index > 0;
    const iconTone = secondary || tone === "red" || tone === "ink" ? "cream" : "ink";
    const hierarchy = secondary ? "actionLink" : "cutCornerCard actionWide";
    const danger = secondary && tone === "red" ? " actionLinkDanger" : "";
    const linkLabel = secondary ? " actionLabelLink" : "";
    const actionIcon = action.id === "pass" || action.intent?.type === "PassResponse"
      ? icon("check", iconTone, "actionIcon")
      : icon("plus", iconTone, "actionIcon responseNopeIcon");
    const notch = secondary ? "" : '<view class="cutCornerNotch"></view>';
    return `<button id="action-${index}" class="actionButton actionTone${toneName} ${hierarchy}${danger}">${notch}${actionIcon}<text class="actionLabel actionLabel${toneName}${linkLabel}" value="${escapeMarkup(action.label)}"></text></button>`;
  }).join("");
  return buttons ? `<view class="actionDock actionDockLinks responseActions">${buttons}</view>` : `<view class="actionDock actionDockEmpty"></view>`;
}

export type { RenderSceneOptions, RenderedScene } from "./types";
export type { ScreenId };
