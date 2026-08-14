import type { IStyle } from "minigame-canvas-engine";
import type { ScreenModel } from "../model";
import { layoutDensity, type RenderSceneOptions } from "./types";

export const PALETTE = {
  ink: "#171512",
  black: "#070706",
  cream: "#fff1c7",
  paper: "#fff8df",
  yellow: "#ffc928",
  red: "#f23b20",
  redDark: "#a71913",
  cyan: "#16bfd2",
  purple: "#8f55ce",
  muted: "#9d8d7a",
  white: "#ffffff",
} as const;

const DISPLAY_FONT = "ZCOOL KuaiLe";
const BODY_FONT = "Noto Sans SC";
const CAPSULE_GAP = 8;
const MIN_TOUCH_SIZE = 47;
const ACTION_DOCK_PADDING_TOP = 6;
const ACTION_MARGIN_TOP = 7;

/** Styles intentionally use a tiny CSS-like extension supported by the layout engine. */
function css(value: Record<string, unknown>): IStyle {
  return value as IStyle;
}

export function createSceneStyles(model: ScreenModel, options: RenderSceneOptions): Record<string, IStyle> {
  const density = layoutDensity(options.height);
  const short = density === "short";
  const compact = density === "compact";
  const safeTop = Math.max(8, options.safeTop, (options.capsule?.bottom ?? 0) + CAPSULE_GAP);
  const safeBottomInset = Math.max(0, options.safeBottom);
  const footerHeight = model.id === "login" ? 26 : model.id === "home" ? 22 : 0;
  const safeBottom = Math.max(12, safeBottomInset + 12 + footerHeight);
  const capsuleReserve = options.capsule
    ? Math.max(50, Math.min(138, 390 - options.capsule.left + 10))
    : 50;
  const headerHeight = short ? 54 : 64;
  const titleWidth = Math.max(166, 390 - 50 - capsuleReserve - 28);
  const heroHeight = short ? 132 : compact ? 188 : 240;
  const dockButtonHeight = short ? 48 : 54;
  const bodyPad = short ? 12 : 18;
  const actionCount = model.actions?.length ?? 0;
  const stackDockHeight = actionCount === 0 ? 0 : safeBottom + actionCount * (dockButtonHeight + 8) + 4;
  const linksDockHeight = actionCount === 0
    ? 0
    : safeBottom + ACTION_DOCK_PADDING_TOP + ACTION_MARGIN_TOP + dockButtonHeight
      + Math.max(0, actionCount - 1) * (MIN_TOUCH_SIZE + ACTION_MARGIN_TOP);
  const gridDockRows = actionCount === 0 ? 0 : 1 + Math.ceil(Math.max(0, actionCount - 1) / 2);
  const gridDockHeight = actionCount === 0
    ? 0
    : safeBottom + ACTION_DOCK_PADDING_TOP + gridDockRows * (dockButtonHeight + ACTION_MARGIN_TOP);
  const homeDockHeight = actionCount === 0
    ? 0
    : safeBottom + ACTION_DOCK_PADDING_TOP
      + Math.min(actionCount, 2) * (dockButtonHeight + ACTION_MARGIN_TOP)
      + (actionCount > 2 ? (short ? 45 : 50) + ACTION_MARGIN_TOP : 0);
  const tableDockBottom = safeBottom - 8;
  const tableDockRows = wrappedTableActionRows(model.actions);
  const tableDockHeight = actionCount === 0
    ? 0
    : Math.max(dockButtonHeight + 8, tableDockRows * (dockButtonHeight + ACTION_MARGIN_TOP));
  const tableDockReserve = tableDockBottom + tableDockHeight;
  const responseTop = Math.max(safeTop + 54, short ? 62 : 112);
  const responsePreferredHeight = short ? 470 : compact ? 570 : 596;
  const responseHeight = Math.max(0, Math.min(
    responsePreferredHeight,
    options.height - responseTop - linksDockHeight - 8,
  ));

  return {
    scene: css({ width: 390, height: options.height, position: "relative", flexDirection: "column", overflow: "hidden", backgroundColor: PALETTE.ink }),
    sceneLogin: css({ backgroundColor: PALETTE.redDark }),
    sceneHome: css({ backgroundColor: PALETTE.ink }),
    sceneTable: css({ backgroundColor: "#100f0d" }),
    sceneResponse: css({ backgroundColor: "#100f0d" }),
    sceneExplosion: css({ backgroundColor: PALETTE.redDark }),
    sceneEliminated: css({ backgroundColor: "#64120e" }),
    sceneResult: css({ backgroundColor: PALETTE.ink }),
    sceneNetwork: css({ backgroundColor: PALETTE.ink }),
    sceneBackground: css({ position: "absolute", left: 0, top: 0, width: 390, height: options.height }),
    sceneTint: css({ position: "absolute", left: 0, top: 0, width: 390, height: options.height }),
    sceneTintInk: css({ backgroundColor: "rgba(7,7,6,.76)" }),
    sceneTintRed: css({ backgroundColor: "rgba(111,13,8,.58)" }),

    safeTop: css({ width: 390, height: safeTop, flexShrink: 0 }),
    screenHeader: css({ width: 390, height: headerHeight, paddingLeft: 18, flexDirection: "row", alignItems: "flex-start", flexShrink: 0 }),
    headerLeftSpacer: css({ width: MIN_TOUCH_SIZE, height: MIN_TOUCH_SIZE, flexShrink: 0 }),
    headerCopy: css({ width: titleWidth, height: headerHeight, flexDirection: "column", alignItems: "center", flexShrink: 0 }),
    headerRight: css({ width: capsuleReserve, height: 48, paddingLeft: 4, flexDirection: "row", alignItems: "center", flexShrink: 0 }),
    iconButton: css({ width: MIN_TOUCH_SIZE, height: MIN_TOUCH_SIZE, padding: 7, backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, borderRadius: 24, ':active': { transform: "translate(3, 3)" } }),
    backButton: css({ flexShrink: 0 }),
    icon: css({ width: 24, height: 24 }),
    eyebrow: css({ width: titleWidth, height: 18, lineHeight: 18, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: short ? 8 : 9, fontWeight: "bold", letterSpacing: 1.4, textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
    screenTitle: css({ width: titleWidth, height: short ? 34 : 40, lineHeight: short ? 31 : 36, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 24 : 28, fontWeight: "bold", textAlign: "center", textStrokeWidth: 2, textStrokeColor: PALETTE.ink, textShadow: "3px 3px 0px #000000", whiteSpace: "nowrap", textOverflow: "ellipsis" }),

    sceneBody: css({ width: 390, flex: 1, minHeight: 0, paddingLeft: bodyPad, paddingRight: bodyPad, flexDirection: "column", position: "relative" }),
    scrollBody: css({ flex: 1, minHeight: 0 }),
    subtitle: css({ width: 354, minHeight: short ? 34 : 44, lineHeight: short ? 18 : 21, paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 5, color: "#cbbba6", fontFamily: BODY_FONT, fontSize: short ? 11 : 12, textAlign: "center", whiteSpace: "normal", wordBreak: "break-all" }),
    hero: css({ width: 354, height: heroHeight, position: "relative", alignItems: "center", justifyContent: "center", flexShrink: 0 }),
    heroImage: css({ width: short ? 174 : compact ? 220 : 260, height: heroHeight }),
    heroLabel: css({ position: "absolute", right: 10, top: short ? 8 : 20, width: 126, height: 52, lineHeight: 50, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: short ? 28 : 35, fontWeight: "bold", textAlign: "center", textStrokeWidth: 3, textStrokeColor: PALETTE.ink, textShadow: "5px 5px 0px #000000", transform: "rotate(-7deg)" }),

    actionDock: css({ width: 390, minHeight: actionCount ? dockButtonHeight + safeBottom : 0, paddingLeft: 22, paddingRight: 22, paddingTop: ACTION_DOCK_PADDING_TOP, paddingBottom: safeBottom, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0, position: "relative" }),
    actionDockEmpty: css({ height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0 }),
    actionDockStack: css({ minHeight: Math.min(stackDockHeight, short ? 190 : 278) }),
    actionDockHome: css({ minHeight: homeDockHeight }),
    actionDockGrid: css({ minHeight: gridDockHeight }),
    actionDockTable: css({ position: "absolute", left: 12, right: 12, bottom: tableDockBottom, width: 366, minHeight: dockButtonHeight + 8, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 }),
    actionDockLinks: css({ minHeight: linksDockHeight }),
    actionButton: css({ height: dockButtonHeight, marginTop: 7, paddingLeft: 12, paddingRight: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 7, borderBottomWidth: 7, ':active': { transform: "translate(3, 3)" } }),
    actionWide: css({ width: 346 }),
    actionHalf: css({ width: 169 }),
    actionSmall: css({ height: short ? 45 : 50 }),
    actionLink: css({ width: 346, height: MIN_TOUCH_SIZE, backgroundColor: "rgba(7,7,6,.72)", borderWidth: 1, borderColor: "#6c4d40", borderRightWidth: 1, borderBottomWidth: 1 }),
    actionTablePrimary: css({ width: actionCount <= 2 ? 270 : 230, backgroundColor: PALETTE.yellow }),
    actionTableUtility: css({ width: actionCount <= 2 ? 88 : 62, backgroundColor: "#211d18", borderColor: "#645346" }),
    actionToneYellow: css({ backgroundColor: PALETTE.yellow, color: PALETTE.ink }),
    actionToneCream: css({ backgroundColor: PALETTE.cream, color: PALETTE.ink }),
    actionToneCyan: css({ backgroundColor: PALETTE.cyan, color: PALETTE.ink }),
    actionToneRed: css({ backgroundColor: PALETTE.red, color: PALETTE.white }),
    actionToneInk: css({ backgroundColor: "#211d18", color: PALETTE.cream, borderColor: "#645346" }),
    actionIcon: css({ width: short ? 20 : 23, height: short ? 20 : 23, marginRight: 8, flexShrink: 0 }),
    actionLabel: css({ maxWidth: 290, height: dockButtonHeight - 12, lineHeight: dockButtonHeight - 12, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 17 : 20, fontWeight: "bold", textAlign: "center", whiteSpace: "nowrap", textOverflow: "ellipsis" }),

    rowList: css({ width: 354, paddingTop: 5, paddingBottom: 10, flexDirection: "column", flexShrink: 0 }),
    rowListSeat: css({ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }),
    row: css({ width: 348, minHeight: short ? 62 : 76, marginLeft: 3, marginBottom: 10, padding: 9, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6 }),
    rowInteractive: css({ ':active': { transform: "translate(2, 2)" } }),
    rowPaper: css({ backgroundColor: PALETTE.cream }),
    rowSeat: css({ width: short ? 169 : 169, height: short ? 120 : compact ? 154 : 180, padding: 8, marginLeft: 0, flexDirection: "column", justifyContent: "center", alignItems: "center", transform: "rotate(-1deg)" }),
    rowTimeline: css({ minHeight: short ? 68 : 92, marginBottom: 0, paddingLeft: 35, backgroundColor: "rgba(24,20,16,.92)", borderWidth: 0, borderBottomWidth: 1, borderBottomColor: "#5b493b" }),
    rowMenu: css({ minHeight: short ? 58 : 70 }),
    rowSetting: css({ minHeight: short ? 54 : 62 }),
    rowRank: css({ minHeight: short ? 56 : 68, marginBottom: 7 }),
    rowFact: css({ minHeight: 54 }),
    rowImage: css({ width: 58, height: 72, marginRight: 10, borderWidth: 2, borderColor: PALETTE.ink, flexShrink: 0 }),
    seatAvatar: css({ width: short ? 66 : compact ? 86 : 104, height: short ? 66 : compact ? 86 : 104, flexShrink: 0 }),
    rankAvatar: css({ width: 50, height: 54, marginRight: 8, flexShrink: 0 }),
    rowIcon: css({ width: 27, height: 27, marginRight: 11, flexShrink: 0 }),
    timelineIcon: css({ width: 17, height: 17 }),
    rowCopy: css({ flex: 1, minWidth: 0, flexDirection: "column", justifyContent: "center" }),
    rowTitle: css({ width: short ? 190 : 214, minHeight: 25, lineHeight: 23, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 16 : 18, fontWeight: "bold", whiteSpace: "normal", wordBreak: "break-all" }),
    rowDetail: css({ width: short ? 190 : 214, minHeight: 20, lineHeight: 16, color: "#6b5f50", fontFamily: BODY_FONT, fontSize: short ? 9 : 10, whiteSpace: "normal", wordBreak: "break-all" }),
    rowBadge: css({ minWidth: 44, maxWidth: 72, minHeight: 27, lineHeight: 27, paddingLeft: 5, paddingRight: 5, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 15, fontFamily: BODY_FONT, fontSize: 9, fontWeight: "bold", textAlign: "center", flexShrink: 0 }),
    rowCaret: css({ width: 20, height: 20, marginLeft: 4, flexShrink: 0 }),
    timelineRail: css({ position: "absolute", left: 7, top: 0, width: 22, height: short ? 68 : 92, borderLeftWidth: 3, borderLeftColor: "#8d715c", alignItems: "center" }),
    timelineMarker: css({ position: "absolute", left: -8, top: 16, width: 14, height: 14, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, transform: "rotate(45deg)" }),

    cardList: css({ width: 354, paddingTop: 6, paddingBottom: 10, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", flexShrink: 0 }),
    cardListGrid: css({ minHeight: short ? 232 : 330 }),
    cardListOrdered: css({ flexDirection: "column" }),
    cardItem: css({ position: "relative", flexDirection: "column", alignItems: "center", backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6 }),
    cardItemGrid: css({ width: short ? 166 : 169, height: short ? 144 : 174, marginBottom: 10 }),
    cardItemOrdered: css({ width: 348, height: short ? 82 : 100, marginBottom: 10, padding: 5, flexDirection: "row" }),
    cardSelected: css({ backgroundColor: PALETTE.yellow, borderWidth: 5, borderColor: PALETTE.cyan }),
    cardImage: css({ width: short ? 98 : 116, height: short ? 110 : 140, flexShrink: 0 }),
    cardName: css({ position: "absolute", left: 6, top: 6, minWidth: 52, height: 25, lineHeight: 25, paddingLeft: 5, paddingRight: 5, color: PALETTE.ink, backgroundColor: PALETTE.cream, borderWidth: 2, borderColor: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 13, textAlign: "center" }),
    cardOrder: css({ width: 32, height: 74, lineHeight: 74, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 26, textAlign: "center", flexShrink: 0 }),
    orderedCardCopy: css({ flex: 1, minWidth: 0, flexDirection: "column", justifyContent: "center", paddingLeft: 10 }),
    orderedCardName: css({ width: 160, height: 28, lineHeight: 28, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 19, fontWeight: "bold" }),
    orderedCardDetail: css({ width: 160, height: 20, lineHeight: 20, color: "#6b5f50", fontFamily: BODY_FONT, fontSize: 9 }),

    brandBody: css({ alignItems: "center", paddingLeft: 18, paddingRight: 18 }),
    brandLogo: css({ width: 320, height: short ? 100 : compact ? 135 : 165, alignItems: "center", justifyContent: "center", transform: "rotate(-3deg)", flexShrink: 0 }),
    brandLogoTop: css({ width: 300, height: short ? 44 : 60, lineHeight: short ? 42 : 58, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 46 : compact ? 58 : 67, fontWeight: "bold", textAlign: "center", textStrokeWidth: 3, textStrokeColor: PALETTE.ink, textShadow: "5px 5px 0px #000000" }),
    brandLogoBottom: css({ width: 300, height: short ? 44 : 60, lineHeight: short ? 42 : 58, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: short ? 46 : compact ? 58 : 67, fontWeight: "bold", textAlign: "center", textStrokeWidth: 3, textStrokeColor: PALETTE.ink, textShadow: "5px 5px 0px #000000" }),
    brandOriginal: css({ width: 300, height: 20, lineHeight: 20, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 9, fontWeight: "bold", letterSpacing: 2, textAlign: "center" }),
    loginCast: css({ width: 390, height: short ? 150 : compact ? 210 : 285, flexShrink: 0 }),
    loginBurst: css({ alignSelf: "flex-start", width: 118, minHeight: 58, marginLeft: 8, marginTop: short ? -28 : -36, padding: 8, color: PALETTE.ink, backgroundColor: PALETTE.cyan, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, fontFamily: DISPLAY_FONT, fontSize: short ? 18 : 22, fontWeight: "bold", textAlign: "center", transform: "rotate(-7deg)" }),
    loginLegal: css({ position: "absolute", left: 25, bottom: safeBottomInset, width: 340, height: 26, lineHeight: 16, color: "#b9a894", fontFamily: BODY_FONT, fontSize: 8, textAlign: "center", whiteSpace: "normal" }),
    homeToolRow: css({ width: 390, height: short ? MIN_TOUCH_SIZE : 52, paddingLeft: 18, paddingRight: capsuleReserve, flexDirection: "row", justifyContent: "flex-end", flexShrink: 0 }),
    homeSettings: css({ width: MIN_TOUCH_SIZE, height: MIN_TOUCH_SIZE, padding: 8, borderRadius: 24, backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6 }),
    homeBody: css({ alignItems: "center", paddingTop: short ? 0 : 4 }),
    homeKicker: css({ width: 190, height: 30, lineHeight: 30, color: PALETTE.ink, backgroundColor: PALETTE.cyan, borderWidth: 2, borderColor: PALETTE.ink, fontFamily: BODY_FONT, fontSize: 10, fontWeight: "bold", textAlign: "center", transform: "rotate(-2deg)", flexShrink: 0 }),
    homeLogo: css({ width: 300, height: short ? 102 : compact ? 132 : 158, marginTop: 2, flexDirection: "column", alignItems: "center", flexShrink: 0 }),
    homeHero: css({ width: 354, height: short ? 145 : compact ? 205 : 275, position: "relative", alignItems: "center", flexShrink: 0 }),
    homeHeroImage: css({ width: short ? 190 : compact ? 244 : 310, height: short ? 145 : compact ? 205 : 275 }),
    homeBoom: css({ position: "absolute", right: 5, top: short ? 10 : 35, width: 112, height: 44, lineHeight: 44, color: PALETTE.red, fontFamily: DISPLAY_FONT, fontSize: short ? 24 : 31, fontWeight: "bold", textStrokeWidth: 2, textStrokeColor: PALETTE.ink, transform: "rotate(9deg)" }),
    versionTag: css({ position: "absolute", left: 25, bottom: safeBottomInset, width: 340, height: 22, lineHeight: 22, color: "#8d7c69", fontFamily: BODY_FONT, fontSize: 8, letterSpacing: 1, textAlign: "center" }),

    modeHero: css({ width: 354, height: short ? 120 : compact ? 190 : 255, position: "relative", alignItems: "center", flexShrink: 0 }),
    modeHeroImage: css({ width: short ? 150 : compact ? 220 : 270, height: short ? 120 : compact ? 190 : 255 }),
    modeSticker: css({ position: "absolute", right: 23, bottom: 10, width: 116, height: 34, lineHeight: 34, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, fontFamily: DISPLAY_FONT, fontSize: 15, textAlign: "center", transform: "rotate(5deg)" }),
    modeChoices: css({ width: 354, flexDirection: "column", paddingTop: 5 }),
    modeChoice: css({ width: 348, minHeight: short ? 78 : 105, marginLeft: 3, marginBottom: 12, padding: 10, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 7, borderBottomWidth: 7 }),
    modeChoicePrimary: css({ backgroundColor: PALETTE.yellow, transform: "rotate(-1deg)" }),
    modeChoiceIconBox: css({ width: 48, height: 48, padding: 9, marginRight: 12, backgroundColor: PALETTE.red, borderWidth: 3, borderColor: PALETTE.ink, flexShrink: 0 }),
    modeChoiceCopy: css({ flex: 1, minWidth: 0, flexDirection: "column" }),
    modeChoiceTitle: css({ width: 220, height: 28, lineHeight: 27, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 18 : 22, fontWeight: "bold" }),
    modeChoiceDetail: css({ width: 220, minHeight: 24, lineHeight: 15, color: "#6b5f50", fontFamily: BODY_FONT, fontSize: 9, whiteSpace: "normal" }),
    modeTip: css({ width: 350, minHeight: 28, lineHeight: 20, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 9, textAlign: "center" }),
    formBody: css({ paddingTop: 5 }),
    formRows: css({ width: 354, flexDirection: "column" }),
    formRow: css({ width: 348, minHeight: short ? 66 : 92, marginLeft: 3, marginBottom: 12, padding: 12, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6 }),
    formRowDark: css({ backgroundColor: "#211d18", borderColor: "#080706" }),
    formRowStamp: css({ minHeight: 54, backgroundColor: "rgba(7,7,6,.8)", borderWidth: 1, borderColor: "#806d5c" }),
    formCopy: css({ flex: 1, minWidth: 0, flexDirection: "column" }),
    formTitle: css({ width: 210, height: 26, lineHeight: 25, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 17, fontWeight: "bold" }),
    formTitleDark: css({ color: PALETTE.cream }),
    formDetail: css({ width: 210, minHeight: 22, lineHeight: 16, color: "#6b5f50", fontFamily: BODY_FONT, fontSize: 9, whiteSpace: "normal" }),
    formDetailDark: css({ color: "#aa9984" }),
    formBadge: css({ minWidth: 76, height: 38, lineHeight: 38, paddingLeft: 8, paddingRight: 8, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 2, borderColor: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 16, textAlign: "center" }),
    joinHero: css({ width: 354, height: short ? 104 : compact ? 168 : 228, alignItems: "center", flexShrink: 0 }),
    joinHeroImage: css({ width: short ? 130 : 215, height: short ? 104 : compact ? 168 : 228 }),
    joinPrompt: css({ width: 350, height: short ? 52 : 72, flexDirection: "column", alignItems: "center", flexShrink: 0 }),
    joinPromptTitle: css({ width: 340, height: 34, lineHeight: 32, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 22 : 27, fontWeight: "bold", textAlign: "center", textStrokeWidth: 2, textStrokeColor: PALETTE.ink }),
    joinPromptDetail: css({ width: 340, height: 22, lineHeight: 22, color: "#c3b39f", fontFamily: BODY_FONT, fontSize: 11, textAlign: "center" }),
    codeBox: css({ width: 338, minHeight: short ? 70 : 92, marginLeft: 8, marginTop: 8, padding: 12, backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 7, borderBottomWidth: 7, flexDirection: "column" }),
    codeLabel: css({ width: 300, height: 20, lineHeight: 20, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 9, fontWeight: "bold", letterSpacing: 1 }),
    codeValue: css({ width: 310, height: short ? 38 : 50, lineHeight: short ? 36 : 48, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 28 : 36, letterSpacing: 5, textAlign: "center" }),

    lobbyCode: css({ width: 348, height: short ? 54 : 68, marginLeft: 3, marginBottom: 10, paddingLeft: 12, paddingRight: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6 }),
    lobbyCodeLabel: css({ width: 92, height: 36, lineHeight: 18, color: PALETTE.ink, fontFamily: BODY_FONT, fontSize: 9, fontWeight: "bold", whiteSpace: "normal" }),
    lobbyCodeValue: css({ width: 214, height: 46, lineHeight: 46, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 25 : 31, textAlign: "right", letterSpacing: 2 }),
    lobbyHostStrip: css({ width: 348, minHeight: 58, marginLeft: 3, marginBottom: 10, padding: 8, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(23,20,16,.9)", borderWidth: 1, borderColor: "#665346" }),
    lobbyHostIcon: css({ width: 40, height: 40, marginRight: 10 }),
    lobbyHostText: css({ width: 270, minHeight: 42, lineHeight: 20, color: PALETTE.yellow, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", whiteSpace: "normal" }),
    lobbyNote: css({ width: 350, minHeight: 30, lineHeight: 18, color: "#a79883", fontFamily: BODY_FONT, fontSize: 9, textAlign: "center", whiteSpace: "normal" }),

    tableBody: css({ width: 390, flex: 1, minHeight: 0, paddingLeft: 11, paddingRight: 11, paddingBottom: tableDockReserve, flexDirection: "column", position: "relative" }),
    tableTopbar: css({ width: 368, height: short ? 28 : 34, flexDirection: "row", alignItems: "center", justifyContent: "center", flexShrink: 0 }),
    tableTopText: css({ width: 330, height: 28, lineHeight: 28, color: "#bcae9a", fontFamily: BODY_FONT, fontSize: 9, textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
    opponentStrip: css({ width: 368, height: short ? 64 : compact ? 79 : 92, flexDirection: "row", justifyContent: "space-around", alignItems: "flex-start", flexShrink: 0 }),
    opponent: css({ width: 78, height: short ? 62 : 86, alignItems: "center", position: "relative", flexShrink: 0 }),
    opponentAvatar: css({ width: short ? 43 : 58, height: short ? 43 : 58, borderWidth: 3, borderColor: PALETTE.cream, borderRadius: 32, backgroundColor: PALETTE.cream }),
    opponentName: css({ width: 76, height: 21, lineHeight: 21, color: PALETTE.cream, backgroundColor: PALETTE.black, fontFamily: DISPLAY_FONT, fontSize: 10, textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
    opponentCount: css({ position: "absolute", right: 2, top: 0, width: 23, height: 23, lineHeight: 23, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 13, fontFamily: BODY_FONT, fontSize: 10, fontWeight: "bold", textAlign: "center" }),
    tableCanvas: css({ width: 368, flex: 1, minHeight: short ? 320 : compact ? 430 : 500, maxHeight: options.height }),
    tableHint: css({ position: "absolute", left: 20, top: short ? 92 : 126, width: 350, minHeight: 54, padding: 8, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6 }),
    tableHintTitle: css({ width: 322, height: 24, lineHeight: 24, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 16, textAlign: "center" }),
    tableHintDetail: css({ width: 322, minHeight: 20, lineHeight: 15, color: "#5f5244", fontFamily: BODY_FONT, fontSize: 9, textAlign: "center", whiteSpace: "normal" }),
    debtStamp: css({ position: "absolute", right: 17, top: short ? 132 : 190, width: 112, minHeight: 58, padding: 7, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, transform: "rotate(5deg)" }),
    debtText: css({ width: 92, minHeight: 42, lineHeight: 21, color: PALETTE.red, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),

    responseBackdrop: css({ width: 390, flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", opacity: 0.28 }),
    responseBackdropCard: css({ width: 112, height: 162, borderWidth: 4, borderColor: PALETTE.cream, transform: "rotate(-5deg)" }),
    responseSheet: css({ position: "absolute", left: 16, top: responseTop, width: 358, height: responseHeight, padding: short ? 15 : 22, alignItems: "center", backgroundColor: PALETTE.cream, borderWidth: 4, borderColor: PALETTE.ink, borderRightWidth: 9, borderBottomWidth: 10 }),
    responseHero: css({ width: short ? 92 : 136, height: short ? 78 : 116, flexShrink: 0 }),
    responseKicker: css({ width: 310, height: 20, lineHeight: 20, color: "#6c6052", fontFamily: BODY_FONT, fontSize: 9, fontWeight: "bold", letterSpacing: 1, textAlign: "center" }),
    responseTitle: css({ width: 320, minHeight: short ? 40 : 54, lineHeight: short ? 36 : 48, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 27 : 33, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    responseSubtitle: css({ width: 310, minHeight: short ? 42 : 58, lineHeight: short ? 17 : 20, color: "#6c6052", fontFamily: BODY_FONT, fontSize: short ? 9 : 10, textAlign: "center", whiteSpace: "normal" }),
    countdown: css({ width: short ? 94 : 136, height: short ? 94 : 136, marginTop: 6, marginBottom: 8, alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.ink, borderWidth: short ? 8 : 11, borderColor: PALETTE.cyan, borderRadius: 74, flexShrink: 0 }),
    countdownText: css({ width: short ? 74 : 110, height: short ? 64 : 88, lineHeight: short ? 60 : 82, color: PALETTE.red, fontFamily: DISPLAY_FONT, fontSize: short ? 44 : 62, textAlign: "center" }),
    responseActions: css({ width: 318, paddingBottom: 0 }),
    choiceBody: css({ alignItems: "center" }),
    choiceHero: css({ width: short ? 114 : 154, height: short ? 132 : 190, marginTop: 5, marginBottom: 6, borderWidth: 3, borderColor: PALETTE.cream, borderRightWidth: 7, borderBottomWidth: 7, transform: "rotate(2deg)", flexShrink: 0 }),
    choicePrompt: css({ width: 350, minHeight: short ? 56 : 78, alignItems: "center", flexShrink: 0 }),
    choicePromptTitle: css({ width: 340, minHeight: 34, lineHeight: 31, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 22 : 28, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    choicePromptDetail: css({ width: 330, minHeight: 24, lineHeight: 18, color: "#c4b39e", fontFamily: BODY_FONT, fontSize: 10, textAlign: "center", whiteSpace: "normal" }),
    privacyRow: css({ width: 344, minHeight: 29, flexDirection: "row", alignItems: "center", justifyContent: "center" }),
    privacyIcon: css({ width: 17, height: 17, marginRight: 6, flexShrink: 0 }),
    privacyNote: css({ maxWidth: 315, minHeight: 29, lineHeight: 20, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 9, textAlign: "center", whiteSpace: "normal" }),
    giveBanner: css({ width: 348, minHeight: short ? 94 : 140, marginLeft: 3, marginTop: 4, marginBottom: 12, padding: 8, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 7, borderBottomWidth: 7 }),
    giveHero: css({ width: short ? 82 : 116, height: short ? 78 : 116, marginRight: 10, flexShrink: 0 }),
    giveCopy: css({ flex: 1, minWidth: 0, flexDirection: "column" }),
    giveTitle: css({ width: short ? 220 : 210, minHeight: 32, lineHeight: 29, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 19 : 23, whiteSpace: "normal" }),
    giveDetail: css({ width: short ? 220 : 210, minHeight: 28, lineHeight: 16, color: "#675949", fontFamily: BODY_FONT, fontSize: 9, whiteSpace: "normal" }),
    defuseStack: css({ width: 330, height: short ? 132 : 220, marginTop: 8, padding: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,7,6,.75)", borderWidth: 2, borderColor: "#584638", flexShrink: 0 }),
    stackCard: css({ width: short ? 150 : 180, height: short ? 11 : 16, marginBottom: 1, backgroundColor: "#2b251f", borderWidth: 2, borderColor: PALETTE.cream }),
    stackDanger: css({ height: short ? 17 : 24, backgroundColor: PALETTE.red, borderColor: PALETTE.yellow, borderWidth: 4 }),
    insertionBadge: css({ width: 230, minHeight: MIN_TOUCH_SIZE, lineHeight: 25, marginTop: 8, padding: 4, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: 16, textAlign: "center" }),

    outcomeBody: css({ alignItems: "center" }),
    explosionWord: css({ width: 350, height: short ? 58 : 92, lineHeight: short ? 56 : 88, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: short ? 54 : 80, fontWeight: "bold", textAlign: "center", textStrokeWidth: 4, textStrokeColor: PALETTE.ink, textShadow: "7px 7px 0px #000000", transform: "rotate(-5deg)", flexShrink: 0 }),
    explosionHero: css({ width: short ? 148 : compact ? 188 : 218, height: short ? 214 : compact ? 290 : 350, borderWidth: 6, borderColor: PALETTE.cream, borderRightWidth: 10, borderBottomWidth: 11, transform: "rotate(3deg)", flexShrink: 0 }),
    outcomeTitle: css({ width: 350, minHeight: short ? 44 : 58, lineHeight: short ? 40 : 52, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 31 : 40, fontWeight: "bold", textAlign: "center", textStrokeWidth: 2, textStrokeColor: PALETTE.ink }),
    outcomeSubtitle: css({ width: 330, minHeight: 32, lineHeight: 18, color: "#d0bea8", fontFamily: BODY_FONT, fontSize: 10, textAlign: "center", whiteSpace: "normal" }),
    eliminatedStamp: css({ width: 82, height: 42, lineHeight: 38, marginTop: 4, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 24, textAlign: "center", transform: "rotate(-6deg)" }),
    eliminatedHero: css({ width: short ? 180 : compact ? 235 : 282, height: short ? 154 : compact ? 220 : 285, flexShrink: 0 }),
    placementCard: css({ width: 240, minHeight: short ? 70 : 86, padding: 10, alignItems: "center", backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 7, borderBottomWidth: 7, flexShrink: 0 }),
    placementTitle: css({ width: 210, minHeight: 36, lineHeight: 34, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 27, textAlign: "center" }),
    placementDetail: css({ width: 210, minHeight: 22, lineHeight: 18, color: "#756755", fontFamily: BODY_FONT, fontSize: 9, textAlign: "center" }),
    winnerHero: css({ width: 354, height: short ? 130 : compact ? 190 : 246, alignItems: "center", flexShrink: 0 }),
    winnerImage: css({ width: short ? 132 : 190, height: short ? 102 : compact ? 150 : 184 }),
    winnerLabel: css({ width: 240, height: 27, lineHeight: 27, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: 22, textAlign: "center", letterSpacing: 2 }),

    tutorialBody: css({ alignItems: "center" }),
    tutorialBurst: css({ width: short ? 174 : compact ? 214 : 248, height: short ? 188 : compact ? 238 : 282, padding: 8, marginTop: 4, backgroundColor: PALETTE.yellow, borderWidth: 4, borderColor: PALETTE.ink, transform: "rotate(2deg)", flexShrink: 0 }),
    tutorialImage: css({ width: short ? 158 : compact ? 198 : 232, height: short ? 172 : compact ? 222 : 266 }),
    tutorialCopy: css({ width: 350, minHeight: short ? 105 : 150, paddingTop: 9, alignItems: "center" }),
    tutorialStep: css({ width: 320, height: 24, lineHeight: 24, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 9, fontWeight: "bold", letterSpacing: 2, textAlign: "center" }),
    tutorialTitle: css({ width: 340, minHeight: 39, lineHeight: 36, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 24 : 30, textAlign: "center", whiteSpace: "normal" }),
    tutorialDetail: css({ width: 328, minHeight: 48, lineHeight: 20, color: "#c8b8a3", fontFamily: BODY_FONT, fontSize: 11, textAlign: "center", whiteSpace: "normal" }),
    tutorialDots: css({ width: 180, height: 24, lineHeight: 24, color: PALETTE.yellow, fontFamily: BODY_FONT, fontSize: 17, letterSpacing: 4, textAlign: "center" }),
    ruleTabs: css({ width: 350, height: 40, marginLeft: 2, marginTop: 4, marginBottom: 10, flexDirection: "row", backgroundColor: PALETTE.black, borderWidth: 2, borderColor: PALETTE.ink, flexShrink: 0 }),
    ruleTab: css({ width: 87, height: 36, lineHeight: 36, color: "#b7a690", fontFamily: BODY_FONT, fontSize: 10, fontWeight: "bold", textAlign: "center" }),
    ruleTabActive: css({ color: PALETTE.ink, backgroundColor: PALETTE.yellow }),
    detailHero: css({ width: short ? 150 : compact ? 184 : 208, height: short ? 226 : compact ? 292 : 346, marginTop: 8, marginBottom: 12, borderWidth: 5, borderColor: PALETTE.cream, borderRightWidth: 9, borderBottomWidth: 10, transform: "rotate(-2deg)", alignSelf: "center", flexShrink: 0 }),
    detailCopy: css({ width: 350, minHeight: short ? 70 : 104, marginBottom: 8, padding: 13, backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6 }),
    detailTitle: css({ width: 318, minHeight: 31, lineHeight: 28, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 18 : 21, whiteSpace: "normal" }),
    detailText: css({ width: 318, minHeight: 34, lineHeight: 17, color: "#675c4d", fontFamily: BODY_FONT, fontSize: 10, whiteSpace: "normal" }),
    historyTip: css({ width: 350, minHeight: 48, marginTop: 16, padding: 10, color: "#a39380", borderWidth: 1, borderColor: "#74604f", fontFamily: BODY_FONT, fontSize: 9, textAlign: "center", whiteSpace: "normal" }),

    menuHero: css({ width: 354, height: short ? 92 : compact ? 145 : 190, alignItems: "center", flexShrink: 0 }),
    menuHeroImage: css({ width: short ? 128 : 190, height: short ? 92 : compact ? 145 : 190 }),
    dangerNote: css({ width: 350, minHeight: 44, lineHeight: 22, marginTop: 10, color: "#ff8b7a", borderWidth: 1, borderColor: "#a53a2c", fontFamily: BODY_FONT, fontSize: 10, textAlign: "center" }),
    networkBody: css({ width: 390, flex: 1, minHeight: 0, paddingTop: Math.max(safeTop, short ? 70 : options.height * 0.2), paddingLeft: 28, paddingRight: 28, alignItems: "center" }),
    networkIcon: css({ width: short ? 72 : 106, height: short ? 72 : 106, marginBottom: 12 }),
    networkKicker: css({ width: 320, height: 24, lineHeight: 24, color: "#9e8d79", fontFamily: BODY_FONT, fontSize: 9, textAlign: "center" }),
    networkTitle: css({ width: 334, minHeight: 54, lineHeight: 48, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 27 : 35, textAlign: "center", whiteSpace: "normal" }),
    networkSubtitle: css({ width: 310, minHeight: 62, lineHeight: 20, color: "#b9aa97", fontFamily: BODY_FONT, fontSize: 11, textAlign: "center", whiteSpace: "normal" }),
    syncTrack: css({ width: 240, height: 10, marginTop: 12, marginBottom: 12, backgroundColor: "#40342a", borderWidth: 2, borderColor: PALETTE.ink }),
    syncFill: css({ width: 132, height: 6, backgroundColor: PALETTE.yellow }),
    settingsProfile: css({ width: 350, minHeight: short ? 94 : 132, marginTop: 7, marginBottom: 14, padding: 8, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 7, borderBottomWidth: 7, flexShrink: 0 }),
    settingsAvatar: css({ width: short ? 78 : 108, height: short ? 78 : 108, marginRight: 10, flexShrink: 0 }),
    settingsCopy: css({ flex: 1, minWidth: 0, flexDirection: "column" }),
    settingsName: css({ width: 200, height: 34, lineHeight: 34, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 20 : 24 }),
    settingsDetail: css({ width: 200, minHeight: 26, lineHeight: 18, color: "#665847", fontFamily: BODY_FONT, fontSize: 9, whiteSpace: "normal" }),
    legalNote: css({ width: 350, minHeight: 42, lineHeight: 18, marginTop: 16, marginBottom: safeBottom, color: "#796a59", fontFamily: BODY_FONT, fontSize: 8, textAlign: "center", whiteSpace: "normal" }),
    error: css({ position: "absolute", left: 20, top: safeTop + headerHeight + 4, width: 350, minHeight: 44, lineHeight: 20, padding: 10, color: PALETTE.white, backgroundColor: PALETTE.red, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
  };
}

function wrappedTableActionRows(actions: ScreenModel["actions"]): number {
  const count = actions?.length ?? 0;
  if (count === 0) return 0;
  const primaryWidth = count <= 2 ? 270 : 230;
  const utilityWidth = count <= 2 ? 88 : 62;
  let rows = 1;
  let used = 0;
  for (const action of actions ?? []) {
    const width = action.tone === "ink" ? utilityWidth : primaryWidth;
    if (used > 0 && used + width > 366) {
      rows += 1;
      used = width;
    } else {
      used += width;
    }
  }
  return rows;
}
