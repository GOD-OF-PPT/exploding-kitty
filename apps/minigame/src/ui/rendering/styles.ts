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
  cyan: "#46e3ef",
  cyanOnPaper: "#006a78",
  purple: "#8f55ce",
  muted: "#d6c8b3",
  mutedOnDark: "#d6c8b3",
  mutedOnLight: "#574c3f",
  dangerText: "#ff9d90",
  white: "#ffffff",
} as const;

const DEFAULT_DISPLAY_FONT = "ZCOOL KuaiLe";
const BODY_FONT = "Noto Sans SC";
const CAPSULE_GAP = 8;
const MIN_TOUCH_SIZE = 47;
const ACTION_DOCK_PADDING_TOP = 6;
const ACTION_MARGIN_TOP = 7;

function hardShadow(
  borderWidth = 3,
  shadowX = 4,
  shadowY = 4,
): Record<string, unknown> {
  return {
    borderWidth,
    borderColor: PALETTE.ink,
    borderRightWidth: borderWidth + shadowX,
    borderBottomWidth: borderWidth + shadowY,
    borderRadius: 0,
  };
}

/** Styles intentionally use a tiny CSS-like extension supported by the layout engine. */
function css(value: Record<string, unknown>): IStyle {
  return value as IStyle;
}

export function createSceneStyles(model: ScreenModel, options: RenderSceneOptions): Record<string, IStyle> {
  const DISPLAY_FONT = options.displayFont || DEFAULT_DISPLAY_FONT;
  const density = layoutDensity(options.height);
  const short = density === "short";
  const compact = density === "compact";
  const longHeaderTitle = model.title.length >= 8;
  const safeTop = Math.max(8, options.safeTop, (options.capsule?.bottom ?? 0) + CAPSULE_GAP);
  const safeBottomInset = Math.max(0, options.safeBottom);
  const footerHeight = model.id === "login" ? 34 : model.id === "home" ? 24 : 0;
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
  const responseCloseReserve = MIN_TOUCH_SIZE + 8;
  const responseTop = short
    ? safeTop + 8
    : compact
      ? Math.max(safeTop + 18, 78)
      : Math.max(safeTop + 26, 104);
  const responsePreferredHeight = short ? 352 : compact ? 430 : 490;
  const responseHeight = Math.max(0, Math.min(
    responsePreferredHeight,
    options.height - responseTop - linksDockHeight - responseCloseReserve - 8,
  ));
  const responseModalHeight = responseHeight + responseCloseReserve;

  return {
    scene: css({ width: 390, height: options.height, position: "relative", flexDirection: "column", backgroundColor: PALETTE.ink }),
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

    comicSurface: css({ ...hardShadow(), backgroundColor: PALETTE.cream }),
    comicSurfaceDark: css({ ...hardShadow(), color: PALETTE.cream, backgroundColor: "#211d18", borderColor: "#080706" }),
    cutCornerCard: css({ ...hardShadow(), position: "relative" }),
    cutCornerNotch: css({ position: "absolute", right: -9, top: -9, width: 18, height: 18, backgroundColor: PALETTE.ink, transform: "rotate(45deg)" }),
    modalSurface: css({ ...hardShadow(4, 5, 6), backgroundColor: PALETTE.cream }),
    selectedSurface: css({ ...hardShadow(4, 3, 3), backgroundColor: PALETTE.yellow, borderColor: PALETTE.cyan }),
    warningCallout: css({ ...hardShadow(2, 3, 3), minHeight: MIN_TOUCH_SIZE, padding: 10, color: PALETTE.white, backgroundColor: "#7d1914", borderColor: PALETTE.ink, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    actionDisabled: css({ backgroundColor: "#6e6456", borderColor: "#332d27" }),
    disabledControl: css({ opacity: 0.58 }),
    toggleSwitch: css({ width: 82, height: MIN_TOUCH_SIZE, position: "relative", backgroundColor: "#41392e", borderWidth: 3, borderColor: PALETTE.ink, borderRadius: 24, flexShrink: 0 }),
    toggleSwitchOn: css({ backgroundColor: PALETTE.cyan }),
    toggleKnob: css({ position: "absolute", left: 6, top: 6, width: 29, height: 29, backgroundColor: PALETTE.cream, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 16 }),
    toggleKnobOn: css({ left: 41 }),
    timerBadge: css({ minWidth: 92, minHeight: MIN_TOUCH_SIZE, lineHeight: MIN_TOUCH_SIZE, paddingLeft: 10, paddingRight: 10, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRadius: 0, fontFamily: DISPLAY_FONT, fontSize: 16, fontWeight: "bold", textAlign: "center" }),

    safeTop: css({ width: 390, height: safeTop, flexShrink: 0 }),
    screenHeader: css({ width: 390, height: headerHeight, paddingLeft: 18, flexDirection: "row", alignItems: "flex-start", flexShrink: 0 }),
    headerLeftSpacer: css({ width: MIN_TOUCH_SIZE, height: MIN_TOUCH_SIZE, flexShrink: 0 }),
    headerCopy: css({ width: titleWidth, height: headerHeight, flexDirection: "column", alignItems: "center", flexShrink: 0 }),
    headerRight: css({ width: capsuleReserve, height: 48, paddingLeft: 4, flexDirection: "row", alignItems: "center", flexShrink: 0 }),
    iconButton: css({ width: MIN_TOUCH_SIZE, height: MIN_TOUCH_SIZE, padding: 7, backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, borderRadius: 24, ':active': { transform: "scale(0.97, 0.97)" } }),
    backButton: css({ flexShrink: 0 }),
    icon: css({ width: 24, height: 24 }),
    eyebrow: css({ width: titleWidth, height: 20, lineHeight: 20, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", letterSpacing: 1.2, textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
    screenTitle: css({ width: titleWidth, height: short ? 34 : 40, lineHeight: short ? 31 : 36, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: longHeaderTitle ? (short ? 20 : compact ? 24 : 28) : short ? 24 : 28, fontWeight: "bold", textAlign: "center", textStrokeWidth: 2, textStrokeColor: PALETTE.ink, textShadow: "3px 3px 0px #000000", whiteSpace: "nowrap", textOverflow: "ellipsis" }),

    sceneBody: css({ width: 390, flex: 1, minHeight: 0, paddingLeft: bodyPad, paddingRight: bodyPad, flexDirection: "column", position: "relative" }),
    scrollBody: css({ flex: 1, minHeight: 0 }),
    subtitle: css({ width: 354, minHeight: short ? 34 : 44, lineHeight: short ? 18 : 21, paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 5, color: "#cbbba6", fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal", wordBreak: "break-all" }),
    hero: css({ width: 354, height: heroHeight, position: "relative", alignItems: "center", justifyContent: "center", flexShrink: 0 }),
    heroImage: css({ width: short ? 174 : compact ? 220 : 260, height: heroHeight }),
    heroLabel: css({ position: "absolute", right: 10, top: short ? 8 : 20, width: 126, height: 52, lineHeight: 50, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: short ? 28 : 35, fontWeight: "bold", textAlign: "center", textStrokeWidth: 3, textStrokeColor: PALETTE.ink, textShadow: "5px 5px 0px #000000", transform: "rotate(-7deg)" }),

    actionDock: css({ width: 390, minHeight: actionCount ? dockButtonHeight + safeBottom : 0, paddingLeft: 22, paddingRight: 22, paddingTop: ACTION_DOCK_PADDING_TOP, paddingBottom: safeBottom, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0, position: "relative" }),
    actionDockEmpty: css({ height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0 }),
    actionDockStack: css({ minHeight: Math.min(stackDockHeight, short ? 190 : 278) }),
    actionDockHome: css({ minHeight: homeDockHeight }),
    actionDockGrid: css({ minHeight: gridDockHeight }),
    actionDockTable: css({ position: "absolute", left: 12, right: 12, bottom: tableDockBottom, width: 366, minHeight: dockButtonHeight + 8, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 }),
    actionDockLinks: css({ minHeight: linksDockHeight, ...(model.id === "response" && actionCount > 0 ? { position: "absolute", left: 0, bottom: 0, height: linksDockHeight } : {}) }),
    actionButton: css({ ...hardShadow(), height: dockButtonHeight, marginTop: 7, paddingLeft: 12, paddingRight: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.yellow, ':active': { transform: "scale(0.97, 0.97)" } }),
    actionWide: css({ width: 346 }),
    actionHalf: css({ width: 169 }),
    actionSmall: css({ height: short ? 45 : 50 }),
    actionLink: css({ width: 346, height: MIN_TOUCH_SIZE, backgroundColor: "rgba(7,7,6,.72)", borderWidth: 1, borderColor: "#6c4d40", borderRightWidth: 1, borderBottomWidth: 1 }),
    actionLinkDanger: css({ borderColor: PALETTE.red }),
    actionTablePrimary: css({ width: actionCount <= 2 ? 270 : 230, backgroundColor: PALETTE.yellow }),
    actionTableUtility: css({ width: actionCount <= 2 ? 88 : 62, backgroundColor: "#211d18", borderColor: "#645346" }),
    actionToneYellow: css({ backgroundColor: PALETTE.yellow, color: PALETTE.ink }),
    actionToneCream: css({ backgroundColor: PALETTE.cream, color: PALETTE.ink }),
    actionToneCyan: css({ backgroundColor: PALETTE.cyan, color: PALETTE.ink }),
    actionToneRed: css({ backgroundColor: PALETTE.red, color: PALETTE.white }),
    actionToneInk: css({ backgroundColor: "#211d18", color: PALETTE.cream, borderColor: "#645346" }),
    actionIcon: css({ width: short ? 20 : 23, height: short ? 20 : 23, marginRight: 8, flexShrink: 0 }),
    actionLabel: css({ maxWidth: 290, height: dockButtonHeight - 12, lineHeight: dockButtonHeight - 12, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 17 : 20, fontWeight: "bold", textAlign: "center", whiteSpace: "nowrap", textOverflow: "ellipsis" }),
    actionLabelRed: css({ color: PALETTE.white }),
    actionLabelInk: css({ color: PALETTE.cream }),
    actionLabelLink: css({ color: PALETTE.cream }),

    rowList: css({ width: 354, paddingTop: 5, paddingBottom: 10, flexDirection: "column", flexShrink: 0 }),
    rowListSeat: css({ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }),
    rowListRank: css(short ? { paddingTop: 2 } : {}),
    row: css({ ...hardShadow(3, 3, 3), width: 348, minHeight: short ? 62 : 76, marginLeft: 3, marginBottom: 10, padding: 9, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.cream }),
    rowInteractive: css({ ':active': { transform: "scale(0.97, 0.97)" } }),
    rowSelected: css({ backgroundColor: PALETTE.yellow, borderWidth: 4, borderColor: PALETTE.cyan, borderRightWidth: 7, borderBottomWidth: 7, borderRadius: 0, position: "relative" }),
    selectionMark: css({ position: "absolute", right: 5, top: 5, minWidth: 44, height: 28, lineHeight: 28, paddingLeft: 5, paddingRight: 5, color: PALETTE.white, backgroundColor: PALETTE.red, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 0, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center" }),
    rowPaper: css({ backgroundColor: PALETTE.cream, ...(model.id === "rules" ? { minHeight: short ? 88 : 98 } : {}) }),
    rowSeat: css({ width: short ? 169 : 169, height: short ? 120 : compact ? 154 : 180, padding: 8, marginLeft: 0, flexDirection: "column", justifyContent: "center", alignItems: "center", transform: "rotate(-1deg)" }),
    rowTimeline: css({ minHeight: short ? 68 : 78, marginBottom: 0, paddingLeft: 35, backgroundColor: "rgba(24,20,16,.92)", borderWidth: 0, borderBottomWidth: 1, borderBottomColor: "#5b493b" }),
    rowMenu: css({ minHeight: short ? 58 : 70 }),
    rowSetting: css({ minHeight: short ? 54 : 62 }),
    rowRank: css({ minHeight: short ? 48 : 68, marginBottom: short ? 2 : 7, paddingTop: short ? 3 : 9, paddingBottom: short ? 3 : 9 }),
    rowFact: css({ minHeight: 54 }),
    rowImage: css({ width: 58, height: 72, marginRight: 10, borderWidth: 2, borderColor: PALETTE.ink, flexShrink: 0 }),
    ruleCardImage: css({ width: short ? 49 : 56, height: short ? 70 : 80 }),
    seatAvatar: css({ width: short ? 52 : compact ? 72 : 92, height: short ? 52 : compact ? 72 : 92, flexShrink: 0 }),
    rankAvatar: css({ width: short ? 38 : 50, height: short ? 42 : 54, marginRight: 8, flexShrink: 0 }),
    rowIcon: css({ width: 27, height: 27, marginRight: 11, flexShrink: 0 }),
    timelineIcon: css({ width: 17, height: 17 }),
    rowCopy: css({ flex: 1, minWidth: 0, flexDirection: "column", justifyContent: "center" }),
    rowCopySeat: css({ width: 145, minWidth: 0, alignItems: "center" }),
    rowTitle: css({ width: short ? 190 : 214, minHeight: 25, lineHeight: 23, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 16 : 18, fontWeight: "bold", whiteSpace: "normal", wordBreak: "break-all" }),
    rowTitlePaper: css(model.id === "rules" && short ? { width: 214 } : {}),
    rowTitleSeat: css({ width: 145, height: 22, minHeight: 22, lineHeight: 20, fontSize: short ? 14 : 16, textAlign: "center", whiteSpace: "nowrap", textOverflow: "ellipsis" }),
    rowTitleTimeline: css({ width: short ? 252 : 268, color: PALETTE.cream }),
    rowDetail: css({ width: short ? 190 : 214, minHeight: 22, lineHeight: 18, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, whiteSpace: "normal", wordBreak: "break-all" }),
    rowDetailPaper: css(model.id === "rules" && short ? { width: 214 } : {}),
    rowDetailSeat: css({ width: 145, height: 20, minHeight: 20, lineHeight: 19, fontSize: 12, textAlign: "center", whiteSpace: "nowrap", textOverflow: "ellipsis" }),
    rowDetailTimeline: css({ width: short ? 252 : 268, color: PALETTE.mutedOnDark }),
    rowCopyRank: css({ width: 174, minWidth: 0 }),
    rowTitleRank: css({ width: 174, minHeight: short ? 21 : 25, lineHeight: short ? 20 : 23, fontSize: short ? 15 : 18 }),
    rowDetailRank: css({ width: 174, minHeight: short ? 18 : 22, lineHeight: short ? 17 : 18, fontSize: short ? 11 : 12 }),
    rowBadge: css({ minWidth: 44, maxWidth: 78, minHeight: 29, lineHeight: 29, paddingLeft: 6, paddingRight: 6, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 2, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center", flexShrink: 0 }),
    rowCaret: css({ width: 20, height: 20, marginLeft: 4, flexShrink: 0 }),
    timelineRail: css({ position: "absolute", left: 7, top: 0, width: 3, height: short ? 68 : 78, backgroundColor: "#8d715c", alignItems: "center" }),
    timelineMarker: css({ position: "absolute", left: -6, top: 16, width: 14, height: 14, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, transform: "rotate(45deg)" }),
    selfSeat: css({ position: "relative", backgroundColor: PALETTE.yellow, borderWidth: 4, borderColor: PALETTE.cyan, borderRightWidth: 8, borderBottomWidth: 8, borderRadius: 0 }),
    selfBadge: css({ position: "absolute", left: 6, top: 6, width: 44, height: 30, lineHeight: 30, color: PALETTE.white, backgroundColor: PALETTE.red, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 0, fontFamily: DISPLAY_FONT, fontSize: 14, fontWeight: "bold", textAlign: "center" }),

    cardList: css({ width: 354, paddingTop: 6, paddingBottom: 10, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", flexShrink: 0 }),
    cardListGrid: css({ minHeight: short ? 484 : 492 }),
    cardListGive: css({ width: short ? 236 : compact ? 244 : 250, marginLeft: short ? 65 : compact ? 55 : 52 }),
    cardListOrdered: css({ flexDirection: "column" }),
    cardItem: css({ ...hardShadow(3, 3, 3), position: "relative", flexDirection: "column", alignItems: "center", backgroundColor: PALETTE.cream }),
    cardItemGrid: css({ width: short ? 166 : 169, height: short ? 237 : 241, marginBottom: 10 }),
    cardItemGive: css({ width: short ? 112 : compact ? 116 : 119, height: short ? 160 : compact ? 166 : 170, marginBottom: short ? 8 : 10 }),
    cardItemOrdered: css({ width: 348, height: short ? 82 : 100, marginBottom: 10, padding: 5, flexDirection: "row" }),
    cardSelected: css({ backgroundColor: PALETTE.yellow, borderWidth: 5, borderColor: PALETTE.cyan }),
    cardImage: css({ width: short ? 147 : 153, height: short ? 210 : 219, flexShrink: 0 }),
    giveCardImage: css({ width: short ? 98 : compact ? 102 : 105, height: short ? 140 : compact ? 146 : 150 }),
    orderedCardImage: css({ width: short ? 49 : 56, height: short ? 70 : 80, flexShrink: 0 }),
    cardName: css({ position: "absolute", left: 6, top: 6, minWidth: 52, height: 25, lineHeight: 25, paddingLeft: 5, paddingRight: 5, color: PALETTE.ink, backgroundColor: PALETTE.cream, borderWidth: 2, borderColor: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 13, textAlign: "center" }),
    cardOrder: css({ width: 32, height: 74, lineHeight: 74, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 26, textAlign: "center", flexShrink: 0 }),
    orderedCardCopy: css({ flex: 1, minWidth: 0, flexDirection: "column", justifyContent: "center", paddingLeft: 10 }),
    orderedCardName: css({ width: 160, height: 28, lineHeight: 28, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 19, fontWeight: "bold" }),
    orderedCardDetail: css({ width: 160, height: 22, lineHeight: 22, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12 }),

    brandBody: css({ alignItems: "center", paddingLeft: 18, paddingRight: 18 }),
    brandLogo: css({ width: 320, height: short ? 100 : compact ? 135 : 165, alignItems: "center", justifyContent: "center", transform: "rotate(-3deg)", flexShrink: 0 }),
    brandLogoTop: css({ width: 300, height: short ? 44 : 60, lineHeight: short ? 42 : 58, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 46 : compact ? 58 : 67, fontWeight: "bold", textAlign: "center", textStrokeWidth: 3, textStrokeColor: PALETTE.ink, textShadow: "5px 5px 0px #000000" }),
    brandLogoBottom: css({ width: 300, height: short ? 44 : 60, lineHeight: short ? 42 : 58, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: short ? 46 : compact ? 58 : 67, fontWeight: "bold", textAlign: "center", textStrokeWidth: 3, textStrokeColor: PALETTE.ink, textShadow: "5px 5px 0px #000000" }),
    brandOriginal: css({ width: 300, height: 22, lineHeight: 22, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", letterSpacing: 1.6, textAlign: "center" }),
    loginCast: css({ width: 390, height: short ? 150 : compact ? 210 : 285, flexShrink: 0 }),
    loginBurst: css({ alignSelf: "center", width: 118, minHeight: 68, marginTop: short ? -28 : -36, padding: 6, alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.cyan, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, transform: "rotate(-7deg)", flexShrink: 0 }),
    loginBurstLine: css({ width: 96, height: short ? 24 : 27, lineHeight: short ? 24 : 27, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 18 : 22, fontWeight: "bold", textAlign: "center", whiteSpace: "nowrap", flexShrink: 0 }),
    loginLegal: css({ position: "absolute", left: 25, bottom: safeBottomInset, width: 340, height: 32, lineHeight: 16, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    homeToolRow: css({ width: 390, height: short ? MIN_TOUCH_SIZE : 52, paddingLeft: 18, paddingRight: capsuleReserve, flexDirection: "row", justifyContent: "flex-end", flexShrink: 0 }),
    homeSettings: css({ width: MIN_TOUCH_SIZE, height: MIN_TOUCH_SIZE, padding: 8, borderRadius: 24, backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6 }),
    homeBody: css({ alignItems: "center", paddingTop: short ? 0 : 4 }),
    homeKicker: css({ width: 190, height: 30, lineHeight: 30, color: PALETTE.ink, backgroundColor: PALETTE.cyan, borderWidth: 2, borderColor: PALETTE.ink, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center", transform: "rotate(-2deg)", flexShrink: 0 }),
    homeLogo: css({ width: 300, height: short ? 102 : compact ? 132 : 158, marginTop: 2, flexDirection: "column", alignItems: "center", flexShrink: 0 }),
    homeHero: css({ width: 354, height: short ? 145 : compact ? 205 : 275, position: "relative", alignItems: "center", flexShrink: 0 }),
    homeHeroImage: css({ width: 354, height: short ? 145 : compact ? 205 : 275 }),
    homeBoom: css({ position: "absolute", right: 5, top: short ? 10 : 35, width: 112, height: 44, lineHeight: 44, color: PALETTE.red, fontFamily: DISPLAY_FONT, fontSize: short ? 24 : 31, fontWeight: "bold", textStrokeWidth: 2, textStrokeColor: PALETTE.ink, transform: "rotate(9deg)" }),
    versionTag: css({ position: "absolute", left: 25, bottom: safeBottomInset, width: 340, height: 24, lineHeight: 24, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, letterSpacing: 0.4, textAlign: "center" }),

    modeHero: css({ width: 354, height: short ? 120 : compact ? 190 : 255, position: "relative", alignItems: "center", flexShrink: 0 }),
    modeHeroImage: css({ width: 354, height: short ? 120 : compact ? 190 : 255 }),
    modeSticker: css({ position: "absolute", right: 23, bottom: 10, width: 116, height: 34, lineHeight: 34, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, fontFamily: DISPLAY_FONT, fontSize: 15, textAlign: "center", transform: "rotate(5deg)" }),
    modeChoices: css({ width: 354, flexDirection: "column", paddingTop: 5 }),
    modeChoice: css({ ...hardShadow(), width: 348, minHeight: short ? 78 : 105, marginLeft: 3, marginBottom: 12, padding: 10, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.cream }),
    modeChoicePrimary: css({ backgroundColor: PALETTE.yellow, transform: "rotate(-1deg)" }),
    modeChoiceIconBox: css({ width: 48, height: 48, padding: 9, marginRight: 12, backgroundColor: PALETTE.red, borderWidth: 3, borderColor: PALETTE.ink, flexShrink: 0 }),
    modeChoiceCopy: css({ flex: 1, minWidth: 0, flexDirection: "column" }),
    modeChoiceTitle: css({ width: 220, height: 28, lineHeight: 27, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 18 : 22, fontWeight: "bold" }),
    modeChoiceDetail: css({ width: 220, minHeight: 28, lineHeight: 18, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, whiteSpace: "normal" }),
    modeTip: css({ width: 350, minHeight: 28, lineHeight: 20, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center" }),
    formBody: css({ paddingTop: 5 }),
    formRows: css({ width: 354, flexDirection: "column" }),
    formRow: css({ ...hardShadow(3, 3, 3), width: 348, minHeight: short ? 66 : 92, marginLeft: 3, marginBottom: 12, padding: 12, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.cream }),
    formRowDark: css({ backgroundColor: "#211d18", borderColor: "#080706" }),
    formRowStamp: css({ minHeight: 54, backgroundColor: "rgba(7,7,6,.8)", borderWidth: 1, borderColor: "#806d5c" }),
    formCopy: css({ flex: 1, minWidth: 0, flexDirection: "column" }),
    formTitle: css({ width: 210, height: 26, lineHeight: 25, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 17, fontWeight: "bold" }),
    formTitleDark: css({ color: PALETTE.cream }),
    formDetail: css({ width: 172, minHeight: 24, lineHeight: 18, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, whiteSpace: "normal" }),
    formDetailDark: css({ color: PALETTE.mutedOnDark }),
    formBadge: css({ minWidth: 76, height: MIN_TOUCH_SIZE, lineHeight: MIN_TOUCH_SIZE, paddingLeft: 8, paddingRight: 8, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 2, borderColor: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 16, textAlign: "center" }),
    formStepper: css({ width: 104, height: MIN_TOUCH_SIZE, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexShrink: 0 }),
    formStepperCaret: css({ width: 20, height: 20, marginLeft: 4, flexShrink: 0 }),
    formToggleLabel: css({ position: "absolute", right: 9, top: 7, width: 28, height: 27, lineHeight: 27, color: PALETTE.cream, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center" }),
    formToggleLabelOn: css({ left: 8, right: 46, color: PALETTE.ink }),
    joinHero: css({ width: 354, height: short ? 104 : compact ? 168 : 228, alignItems: "center", flexShrink: 0 }),
    joinHeroImage: css({ width: 354, height: short ? 104 : compact ? 168 : 228 }),
    joinPrompt: css({ width: 350, height: short ? 52 : 72, flexDirection: "column", alignItems: "center", flexShrink: 0 }),
    joinPromptTitle: css({ width: 340, height: 34, lineHeight: 32, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 22 : 27, fontWeight: "bold", textAlign: "center", textStrokeWidth: 2, textStrokeColor: PALETTE.ink }),
    joinPromptDetail: css({ width: 340, height: 22, lineHeight: 22, color: "#c3b39f", fontFamily: BODY_FONT, fontSize: 12, textAlign: "center" }),
    codeBox: css({ ...hardShadow(), width: 338, minHeight: short ? 70 : 92, marginLeft: 8, marginTop: 8, padding: 12, backgroundColor: PALETTE.cream, flexDirection: "column" }),
    codeLabel: css({ width: 300, height: 22, lineHeight: 22, color: PALETTE.cyanOnPaper, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", letterSpacing: 0.8 }),
    codeValue: css({ width: 310, height: short ? 38 : 50, lineHeight: short ? 36 : 48, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 28 : 36, letterSpacing: 5, textAlign: "center" }),
    codePlaceholder: css({ color: "#948878", fontFamily: BODY_FONT, fontSize: short ? 23 : 28, letterSpacing: 2 }),

    lobbyCode: css({ ...hardShadow(3, 3, 3), width: 348, height: short ? 54 : 68, marginLeft: 3, marginBottom: 10, paddingLeft: 12, paddingRight: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: PALETTE.yellow }),
    lobbyCodeLabel: css({ width: 92, height: 36, lineHeight: 18, color: PALETTE.ink, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", whiteSpace: "normal" }),
    lobbyCodeValue: css({ width: 214, height: 46, lineHeight: 46, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 25 : 31, textAlign: "right", letterSpacing: 2 }),
    lobbyHostStrip: css({ width: 348, minHeight: 58, marginLeft: 3, marginBottom: 10, padding: 8, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(23,20,16,.9)", borderWidth: 1, borderColor: "#665346" }),
    lobbyHostIcon: css({ width: 40, height: 40, marginRight: 10 }),
    lobbyHostText: css({ width: 270, minHeight: 42, lineHeight: 20, color: PALETTE.yellow, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", whiteSpace: "normal" }),
    lobbyNote: css({ width: 350, minHeight: 32, lineHeight: 19, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),

    tableBody: css({ width: 390, flex: 1, minHeight: 0, paddingLeft: 11, paddingRight: 11, paddingBottom: tableDockReserve, flexDirection: "column", position: "relative" }),
    tableTopbar: css({ width: 368, height: 55, paddingLeft: 6, paddingRight: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(7,7,6,.86)", borderBottomWidth: 2, borderBottomColor: PALETTE.cyan, flexShrink: 0 }),
    tableTopText: css({ width: 368, height: 24, lineHeight: 24, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }),
    tableTurnStatus: css({ width: 232, height: MIN_TOUCH_SIZE, lineHeight: MIN_TOUCH_SIZE, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: 17, fontWeight: "bold", textAlign: "left", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }),
    tableTurnTimer: css({ minWidth: 104, minHeight: MIN_TOUCH_SIZE, paddingLeft: 8, paddingRight: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRadius: 0, flexShrink: 0 }),
    tableTurnTimerLabel: css({ minWidth: 82, height: 30, lineHeight: 30, color: PALETTE.ink, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center", whiteSpace: "nowrap" }),
    opponentStrip: css({ width: 368, height: short ? 64 : compact ? 79 : 92, flexDirection: "row", justifyContent: "space-around", alignItems: "flex-start", flexShrink: 0 }),
    opponent: css({ width: 78, height: short ? 62 : 86, alignItems: "center", position: "relative", flexShrink: 0 }),
    tableCurrentPlayer: css({ backgroundColor: "#2f2a21", borderWidth: 3, borderColor: PALETTE.cyan, borderRadius: 0 }),
    tableCurrentMark: css({ position: "absolute", left: -2, top: short ? 27 : 38, width: 44, height: 24, lineHeight: 24, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 0, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center", transform: "rotate(-7deg)" }),
    opponentAvatar: css({ width: short ? 43 : 58, height: short ? 43 : 58, borderWidth: 3, borderColor: PALETTE.cream, borderRadius: 32, backgroundColor: PALETTE.cream }),
    opponentName: css({ width: 76, height: 22, lineHeight: 22, color: PALETTE.cream, backgroundColor: PALETTE.black, fontFamily: DISPLAY_FONT, fontSize: 11, textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
    opponentCount: css({ position: "absolute", right: 2, top: 0, width: 23, height: 23, lineHeight: 23, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 13, fontFamily: BODY_FONT, fontSize: 10, fontWeight: "bold", textAlign: "center" }),
    tableCanvas: css({ width: 368, flex: 1, minHeight: short ? 280 : compact ? 390 : 460, maxHeight: options.height }),
    tableHint: css({ ...hardShadow(3, 3, 3), position: "absolute", left: 20, top: short ? 92 : 126, width: 350, minHeight: 54, padding: 8, backgroundColor: PALETTE.yellow }),
    tableHintTitle: css({ width: 322, height: 24, lineHeight: 24, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 16, textAlign: "center" }),
    tableHintDetail: css({ width: 322, minHeight: 22, lineHeight: 18, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    debtStamp: css({ position: "absolute", right: 6, top: short ? 145 : compact ? 162 : 175, width: 92, minHeight: MIN_TOUCH_SIZE, padding: 5, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, borderRadius: 0, transform: "rotate(3deg)" }),
    debtText: css({ width: 72, minHeight: 34, lineHeight: 17, color: PALETTE.white, fontFamily: DISPLAY_FONT, fontSize: 17, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),

    responseBackdrop: css({ width: 390, flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", opacity: 0.42 }),
    responseBackdropCard: css({ width: 112, height: 162, borderWidth: 4, borderColor: PALETTE.cream, transform: "rotate(-5deg)" }),
    responseTableContext: css({ position: "absolute", left: 11, top: safeTop, width: 368, height: Math.max(0, options.height - safeTop), paddingTop: 8, flexDirection: "column", alignItems: "center", opacity: 0.78 }),
    responseBackdropScrim: css({ position: "absolute", left: 0, top: 0, width: 390, height: options.height, backgroundColor: "rgba(7,7,6,.62)" }),
    responseModal: css({ position: "absolute", left: 16, top: responseTop, width: 358, height: responseModalHeight, flexDirection: "column", alignItems: "center" }),
    responseSheet: css({ ...hardShadow(4, 5, 6), position: "relative", left: 0, top: 0, width: 358, height: responseHeight, padding: short ? 12 : 18, alignItems: "center", backgroundColor: PALETTE.cream, flexShrink: 0 }),
    responseClose: css({ position: "absolute", right: 12, top: 12, width: MIN_TOUCH_SIZE, height: MIN_TOUCH_SIZE, padding: 9, alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRadius: 0, ':active': { transform: "scale(0.97, 0.97)" } }),
    responseCloseIcon: css({ width: 23, height: 23, marginRight: 0, transform: "rotate(45deg)" }),
    responseNopeIcon: css({ transform: "rotate(45deg)" }),
    responseHero: css({ width: short ? 82 : 122, height: short ? 68 : 102, flexShrink: 0 }),
    responseKicker: css({ width: 310, height: 22, lineHeight: 22, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", letterSpacing: 0.8, textAlign: "center" }),
    responseTitle: css({ width: 320, minHeight: short ? 40 : 54, lineHeight: short ? 36 : 48, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 27 : 33, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    responseSubtitle: css({ width: 310, minHeight: short ? 42 : 58, lineHeight: short ? 18 : 20, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    countdown: css({ width: short ? 84 : 118, height: short ? 84 : 118, marginTop: 6, marginBottom: 8, alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.ink, borderWidth: short ? 7 : 9, borderColor: PALETTE.cyan, borderRadius: 64, flexShrink: 0 }),
    countdownText: css({ width: short ? 64 : 96, height: short ? 48 : 70, lineHeight: short ? 48 : 68, color: PALETTE.red, fontFamily: DISPLAY_FONT, fontSize: short ? 40 : 55, textAlign: "center" }),
    countdownUnit: css({ width: 44, height: 18, lineHeight: 18, color: PALETTE.cream, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center" }),
    responseActions: css({ width: 390, paddingBottom: safeBottom, position: "absolute", left: 0, bottom: 0 }),
    choiceBody: css({ alignItems: "center" }),
    choiceHero: css({ width: short ? 98 : 133, height: short ? 140 : 190, marginTop: 5, marginBottom: 6, borderWidth: 3, borderColor: PALETTE.cream, borderRightWidth: 7, borderBottomWidth: 7, transform: "rotate(2deg)", flexShrink: 0 }),
    choicePrompt: css({ width: 350, minHeight: short ? 56 : 78, alignItems: "center", flexShrink: 0 }),
    choicePromptTitle: css({ width: 340, minHeight: 34, lineHeight: 31, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 22 : 28, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    choicePromptDetail: css({ width: 330, minHeight: 26, lineHeight: 19, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    giveRecipient: css({ width: 338, minHeight: MIN_TOUCH_SIZE, marginBottom: 8, paddingLeft: 10, paddingRight: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.cyan, borderWidth: 3, borderColor: PALETTE.ink, borderRightWidth: 6, borderBottomWidth: 6, borderRadius: 0 }),
    giveRecipientLabel: css({ width: 300, minHeight: 30, lineHeight: 22, color: PALETTE.ink, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    privacyRow: css({ width: 344, minHeight: 29, flexDirection: "row", alignItems: "center", justifyContent: "center" }),
    privacyIcon: css({ width: 17, height: 17, marginRight: 6, flexShrink: 0 }),
    privacyNote: css({ maxWidth: 315, minHeight: 30, lineHeight: 20, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    giveBanner: css({ ...hardShadow(), width: 348, minHeight: short ? 94 : 140, marginLeft: 3, marginTop: 4, marginBottom: 12, padding: 8, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.yellow }),
    giveHero: css({ width: short ? 82 : 116, height: short ? 78 : 116, marginRight: 10, flexShrink: 0 }),
    giveCopy: css({ flex: 1, minWidth: 0, flexDirection: "column" }),
    giveTitle: css({ width: short ? 220 : 210, minHeight: 32, lineHeight: 29, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 19 : 23, whiteSpace: "normal" }),
    giveDetail: css({ width: short ? 220 : 210, minHeight: 30, lineHeight: 18, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, whiteSpace: "normal" }),
    defuseStack: css({ width: 330, height: short ? 132 : 220, marginTop: 8, padding: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,7,6,.75)", borderWidth: 2, borderColor: "#584638", flexShrink: 0 }),
    stackCard: css({ width: short ? 150 : 180, height: short ? 11 : 16, marginBottom: 1, backgroundColor: "#2b251f", borderWidth: 2, borderColor: PALETTE.cream }),
    stackDanger: css({ height: short ? 17 : 24, backgroundColor: PALETTE.red, borderColor: PALETTE.yellow, borderWidth: 4 }),
    insertionBadge: css({ width: 230, minHeight: MIN_TOUCH_SIZE, lineHeight: 25, marginTop: 8, padding: 4, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: 16, textAlign: "center" }),
    defuseSelector: css({ width: 338, minHeight: short ? 146 : 164, marginTop: 8, padding: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,7,6,.88)", borderWidth: 2, borderColor: "#796553", borderRadius: 0, flexShrink: 0 }),
    defuseEndpoint: css({ width: 306, height: 23, lineHeight: 23, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center" }),
    defuseTrack: css({ width: 310, minHeight: 76, marginTop: 3, marginBottom: 3, padding: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#332b24", borderWidth: 3, borderColor: PALETTE.cyan, borderRadius: 0 }),
    defuseStepper: css({ width: 294, minHeight: 64, flexDirection: "row", alignItems: "stretch", justifyContent: "space-between" }),
    defuseStepButton: css({ width: 62, minHeight: 64, padding: 5, alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.cream, borderWidth: 3, borderColor: PALETTE.ink, borderRadius: 0, flexShrink: 0, ':active': { transform: "scale(0.97, 0.97)" } }),
    defuseStepIcon: css({ width: 20, height: 20, flexShrink: 0 }),
    defuseStepLabel: css({ width: 52, height: 20, lineHeight: 20, color: PALETTE.ink, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center", whiteSpace: "nowrap" }),
    defusePosition: css({ ...hardShadow(3, 3, 3), width: 158, minHeight: 64, padding: 6, alignItems: "center", justifyContent: "center", backgroundColor: PALETTE.cream, flexShrink: 0 }),
    defusePositionSelected: css({ backgroundColor: PALETTE.yellow, borderColor: PALETTE.cyan, borderWidth: 4, borderRightWidth: 7, borderBottomWidth: 7 }),
    defusePositionLabel: css({ width: 140, height: 25, lineHeight: 25, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 17, fontWeight: "bold", textAlign: "center", whiteSpace: "nowrap", textOverflow: "ellipsis" }),
    defusePositionDetail: css({ width: 140, minHeight: 20, lineHeight: 17, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 11, textAlign: "center", whiteSpace: "normal" }),

    outcomeBody: css({ alignItems: "center" }),
    explosionWord: css({ width: 350, height: short ? 58 : 92, lineHeight: short ? 56 : 88, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: short ? 54 : 80, fontWeight: "bold", textAlign: "center", textStrokeWidth: 4, textStrokeColor: PALETTE.ink, textShadow: "7px 7px 0px #000000", transform: "rotate(-5deg)", flexShrink: 0 }),
    explosionHero: css({ width: short ? 150 : compact ? 196 : 218, height: short ? 214 : compact ? 280 : 311, borderWidth: 6, borderColor: PALETTE.cream, borderRightWidth: 10, borderBottomWidth: 11, transform: "rotate(3deg)", flexShrink: 0 }),
    outcomeTitle: css({ width: 350, minHeight: short ? 44 : 58, lineHeight: short ? 40 : 52, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 31 : 40, fontWeight: "bold", textAlign: "center", textStrokeWidth: 2, textStrokeColor: PALETTE.ink }),
    outcomeSubtitle: css({ width: 330, minHeight: 34, lineHeight: 19, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    eliminatedStamp: css({ width: 82, height: 42, lineHeight: 38, marginTop: 4, color: PALETTE.ink, backgroundColor: PALETTE.yellow, borderWidth: 3, borderColor: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 24, textAlign: "center", transform: "rotate(-6deg)" }),
    eliminatedHero: css({ width: 350, height: short ? 154 : compact ? 220 : 285, marginTop: short ? 12 : compact ? 18 : 24, flexShrink: 0 }),
    placementCard: css({ ...hardShadow(), width: 240, height: short ? 100 : 112, padding: 10, alignItems: "center", backgroundColor: PALETTE.cream, flexShrink: 0 }),
    placementTitle: css({ width: 210, minHeight: 36, lineHeight: 34, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: 27, textAlign: "center" }),
    placementDetail: css({ width: 210, minHeight: 24, lineHeight: 19, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center" }),
    placementKicker: css({ height: 24 }),
    placementReason: css({ height: 24 }),
    winnerHero: css({ width: 354, minHeight: short ? 96 : compact ? 190 : 246, alignItems: "center", flexShrink: 0 }),
    winnerImage: css({ width: short ? 88 : 190, height: short ? 54 : compact ? 150 : 184 }),
    winnerLabel: css({ width: 240, height: 27, lineHeight: 27, color: PALETTE.yellow, fontFamily: DISPLAY_FONT, fontSize: 22, textAlign: "center", letterSpacing: 2 }),
    winnerAura: css({ ...hardShadow(3, 4, 4), width: short ? 144 : compact ? 224 : 260, height: short ? 62 : compact ? 158 : 192, alignItems: "center", justifyContent: "flex-end", backgroundColor: PALETTE.cyan, transform: "rotate(-2deg)", flexShrink: 0 }),
    winnerDetail: css(short ? { height: 20, minHeight: 20, lineHeight: 18, fontSize: 11 } : {}),
    winnerYou: css({ minWidth: 52, height: 30, lineHeight: 30, paddingLeft: 6, paddingRight: 6, color: PALETTE.white, backgroundColor: PALETTE.red, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 0, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center", flexShrink: 0 }),

    tutorialBody: css({ alignItems: "center" }),
    tutorialBurst: css({ ...hardShadow(4, 5, 5), width: short ? 132 : compact ? 167 : 197, height: short ? 188 : compact ? 238 : 282, padding: 8, marginTop: 4, backgroundColor: PALETTE.yellow, transform: "rotate(2deg)", flexShrink: 0 }),
    tutorialImage: css({ width: short ? 112 : compact ? 151 : 186, height: short ? 160 : compact ? 216 : 266 }),
    tutorialCopy: css({ width: 350, minHeight: short ? 105 : 150, paddingTop: 9, alignItems: "center", backgroundColor: "rgba(7,7,6,0)", borderWidth: 0, borderRadius: 0 }),
    tutorialStep: css({ width: 320, height: 24, lineHeight: 24, color: PALETTE.cyan, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", letterSpacing: 1.4, textAlign: "center" }),
    tutorialTitle: css({ width: 340, minHeight: 39, lineHeight: 36, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 24 : 30, textAlign: "center", whiteSpace: "normal" }),
    tutorialDetail: css({ width: 328, minHeight: 48, lineHeight: 20, color: "#c8b8a3", fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    tutorialDots: css({ width: 180, height: 24, lineHeight: 24, color: PALETTE.yellow, fontFamily: BODY_FONT, fontSize: 17, letterSpacing: 4, textAlign: "center" }),
    ruleTabs: css({ width: 350, height: MIN_TOUCH_SIZE + 4, marginLeft: 2, marginTop: 4, marginBottom: 10, flexDirection: "row", backgroundColor: PALETTE.black, borderWidth: 2, borderColor: PALETTE.ink, flexShrink: 0 }),
    ruleTab: css({ width: 87, height: MIN_TOUCH_SIZE, lineHeight: MIN_TOUCH_SIZE, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center" }),
    ruleTabActive: css({ color: PALETTE.ink, backgroundColor: PALETTE.yellow }),
    rulesBottomSpacer: css({ width: 350, height: Math.max(MIN_TOUCH_SIZE, safeBottom + dockButtonHeight), flexShrink: 0 }),
    detailHero: css({ width: short ? 154 : compact ? 196 : 210, height: short ? 220 : compact ? 280 : 300, marginTop: 8, marginBottom: 12, borderWidth: 5, borderColor: PALETTE.cream, borderRightWidth: 9, borderBottomWidth: 10, transform: "rotate(-2deg)", alignSelf: "center", flexShrink: 0 }),
    detailCopy: css({ ...hardShadow(3, 3, 3), width: 350, minHeight: short ? 54 : 64, marginBottom: 8, padding: 10, backgroundColor: PALETTE.cream }),
    detailTitle: css({ width: 318, minHeight: 31, lineHeight: 28, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 18 : 21, whiteSpace: "normal" }),
    detailText: css({ width: 318, minHeight: 38, lineHeight: 19, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, whiteSpace: "normal" }),
    detailRule: css({ ...hardShadow(3, 3, 3), width: 350, minHeight: 58, marginBottom: 10, padding: 10, color: PALETTE.ink, backgroundColor: PALETTE.yellow, fontFamily: BODY_FONT, fontSize: 13, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    historyTip: css({ width: 350, minHeight: 48, marginTop: 16, padding: 10, color: PALETTE.mutedOnDark, borderWidth: 1, borderColor: "#74604f", fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),

    menuHero: css({ width: 354, height: short ? 92 : compact ? 145 : 190, alignItems: "center", flexShrink: 0 }),
    menuHeroImage: css({ width: 354, height: short ? 92 : compact ? 145 : 190 }),
    dangerNote: css({ width: 350, minHeight: MIN_TOUCH_SIZE, lineHeight: 20, marginTop: 10, padding: 8, color: PALETTE.dangerText, backgroundColor: "#32120f", borderWidth: 2, borderColor: PALETTE.red, borderRadius: 0, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    networkBody: css({ width: 390, flex: 1, minHeight: 0, paddingTop: short ? safeTop : Math.max(safeTop, options.height * 0.2), paddingLeft: 28, paddingRight: 28, alignItems: "center" }),
    networkIcon: css({ width: short ? 56 : 106, height: short ? 56 : 106, marginBottom: short ? 6 : 12 }),
    networkKicker: css({ width: 320, height: short ? 20 : 24, lineHeight: short ? 20 : 24, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center" }),
    networkTitle: css({ width: 334, minHeight: short ? 44 : 54, lineHeight: short ? 40 : 48, color: PALETTE.cream, fontFamily: DISPLAY_FONT, fontSize: short ? 27 : 35, textAlign: "center", whiteSpace: "normal" }),
    networkSubtitle: css({ width: 310, minHeight: short ? 44 : 62, lineHeight: short ? 18 : 20, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    syncTrack: css({ width: 240, height: 10, marginTop: short ? 6 : 12, marginBottom: short ? 6 : 12, backgroundColor: "#40342a", borderWidth: 2, borderColor: PALETTE.ink }),
    syncFill: css({ width: 132, height: 6, backgroundColor: PALETTE.yellow }),
    syncFillOnline: css({ width: 236 }),
    networkProgressLabel: css({ width: 300, minHeight: short ? 20 : 24, lineHeight: short ? 18 : 20, color: PALETTE.cream, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
    settingsProfile: css({ ...hardShadow(), width: 350, minHeight: short ? 94 : 132, marginTop: 7, marginBottom: 14, padding: 8, flexDirection: "row", alignItems: "center", backgroundColor: PALETTE.yellow, flexShrink: 0 }),
    settingsAvatar: css({ width: short ? 78 : 108, height: short ? 78 : 108, marginRight: 10, flexShrink: 0 }),
    settingsCopy: css({ flex: 1, minWidth: 0, flexDirection: "column" }),
    settingsName: css({ width: 200, height: 34, lineHeight: 34, color: PALETTE.ink, fontFamily: DISPLAY_FONT, fontSize: short ? 20 : 24 }),
    settingsDetail: css({ width: 200, minHeight: 28, lineHeight: 19, color: PALETTE.mutedOnLight, fontFamily: BODY_FONT, fontSize: 12, whiteSpace: "normal" }),
    settingsToggle: css({ width: 82, height: MIN_TOUCH_SIZE, position: "relative", backgroundColor: "#41392e", borderWidth: 3, borderColor: PALETTE.ink, borderRadius: 24, flexShrink: 0 }),
    settingsToggleOn: css({ backgroundColor: PALETTE.cyan }),
    settingsToggleKnob: css({ position: "absolute", left: 6, top: 6, width: 29, height: 29, backgroundColor: PALETTE.cream, borderWidth: 2, borderColor: PALETTE.ink, borderRadius: 16 }),
    settingsToggleKnobOn: css({ left: 41 }),
    settingsToggleLabel: css({ position: "absolute", right: 9, top: 7, width: 28, height: 27, lineHeight: 27, color: PALETTE.cream, fontFamily: BODY_FONT, fontSize: 11, fontWeight: "bold", textAlign: "center" }),
    settingsToggleLabelOn: css({ left: 8, right: 46, color: PALETTE.ink }),
    settingsLinks: css({ width: 348, marginTop: 6, flexDirection: "column" }),
    settingsLink: css({ minHeight: short ? 58 : 66, backgroundColor: PALETTE.paper, borderRadius: 0 }),
    legalNote: css({ width: 350, minHeight: 44, lineHeight: 19, marginTop: 16, marginBottom: safeBottom, color: PALETTE.mutedOnDark, fontFamily: BODY_FONT, fontSize: 12, textAlign: "center", whiteSpace: "normal" }),
    error: css({ ...hardShadow(3, 3, 3), position: "absolute", left: 20, top: safeTop + headerHeight + 4, width: 350, minHeight: 44, lineHeight: 20, padding: 10, color: PALETTE.white, backgroundColor: PALETTE.red, fontFamily: BODY_FONT, fontSize: 12, fontWeight: "bold", textAlign: "center", whiteSpace: "normal" }),
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
