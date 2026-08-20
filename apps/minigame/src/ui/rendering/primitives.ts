import type { CardModel, ScreenAction, ScreenModel, ScreenRow, Tone } from "../model";
import type { RenderSceneOptions } from "./types";

const ICON_ROOT = "assets/ui/icons";

export type IconName =
  | "arrow-left"
  | "gear"
  | "plus"
  | "hash"
  | "book-open"
  | "graduation-cap"
  | "users-three"
  | "share-network"
  | "check"
  | "caret-right"
  | "lock"
  | "speaker-high"
  | "device-mobile"
  | "info"
  | "arrow-clockwise"
  | "list"
  | "eye"
  | "sign-out";

export type FitMode = "contain" | "cover";
export type RowVariant = "paper" | "seat" | "timeline" | "menu" | "setting" | "rank" | "fact";
export type ActionLayout = "stack" | "home" | "grid" | "table" | "links";

export function escapeMarkup(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function fitImage(
  source: string,
  className: string,
  fit: FitMode,
  position = "center center",
): string {
  return `<fitimage class="${escapeMarkup(className)}" src="${escapeMarkup(source)}" data-fit="${fit}" data-position="${escapeMarkup(position)}"></fitimage>`;
}

export function icon(name: IconName, tone: "ink" | "cream" = "ink", className = "icon"): string {
  return fitImage(`${ICON_ROOT}/${tone}/${name}.png`, className, "contain");
}

export function background(tint: "ink" | "red" | "none" = "ink"): string {
  return `${fitImage("assets/ui/backgrounds/comic-bg-390x844.jpg", "sceneBackground", "cover")}${tint === "none" ? "" : `<view class="sceneTint sceneTint${capitalize(tint)}"></view>`}`;
}

export function header(model: ScreenModel, options: RenderSceneOptions, right?: string): string {
  const left = options.canGoBack
    ? `<button id="back" class="iconButton backButton">${icon("arrow-left")}</button>`
    : `<view class="headerLeftSpacer"></view>`;
  return `<view class="safeTop"></view><view class="screenHeader">${left}<view class="headerCopy"><text class="eyebrow" value="${escapeMarkup(model.eyebrow ?? "")}"></text><text class="screenTitle" value="${escapeMarkup(model.title)}"></text></view><view class="headerRight">${right ?? ""}</view></view>`;
}

export function body(content: string, scroll = false, className = "sceneBody"): string {
  const classes = `${className}${scroll ? " scrollBody" : ""}`;
  return scroll
    ? `<scrollview id="scene-scroll" class="${classes}" scrollY="true">${content}</scrollview>`
    : `<view class="${classes}">${content}</view>`;
}

export function subtitle(value: string | undefined, className = "subtitle"): string {
  return value ? `<text class="${className}" value="${escapeMarkup(value)}"></text>` : "";
}

export function hero(
  model: ScreenModel,
  className = "hero",
  imageClass = "heroImage",
  imageFit?: FitMode,
  position = "center center",
): string {
  if (!model.heroImage && !model.heroLabel) return "";
  const fit = imageFit ?? fitForSource(model.heroImage);
  return `<view class="${className}">${model.heroImage ? fitImage(model.heroImage, imageClass, fit, position) : ""}${model.heroLabel ? `<text class="heroLabel" value="${escapeMarkup(model.heroLabel)}"></text>` : ""}</view>`;
}

export function rows(rows: readonly ScreenRow[] | undefined, variant: RowVariant = "paper"): string {
  if (!rows?.length) return "";
  return `<view class="rowList rowList${capitalize(variant)}">${rows.map((row, index) => rowTemplate(row, index, variant)).join("")}</view>`;
}

export function cards(
  values: readonly CardModel[] | undefined,
  selectedTokens: readonly string[],
  variant: "grid" | "give" | "ordered" = "grid",
): string {
  if (!values?.length) return "";
  const selected = new Set(selectedTokens);
  return `<view class="cardList cardList${capitalize(variant)}">${values.map((card, index) => {
    const selectedClass = selected.has(card.token) ? " cardSelected" : "";
    const imageClass = variant === "ordered"
      ? "cardImage orderedCardImage"
      : variant === "give"
        ? "cardImage giveCardImage"
        : "cardImage";
    const order = variant === "ordered" ? `<text class="cardOrder" value="${index + 1}"></text>` : "";
    const copy = variant === "ordered"
      ? `<view class="orderedCardCopy"><text class="orderedCardName" value="${escapeMarkup(card.name)}"></text><text class="orderedCardDetail" value="${escapeMarkup(index === 0 ? "下一张" : `再过 ${index} 张`)}"></text></view>`
      : `<text class="cardName" value="${escapeMarkup(card.name)}"></text>`;
    return `<button id="card-${index}" class="cardItem cardItem${capitalize(variant)}${selectedClass}">${order}${fitImage(card.image, imageClass, "contain", "center center")}${copy}</button>`;
  }).join("")}</view>`;
}

export function actions(
  values: readonly ScreenAction[] | undefined,
  layout: ActionLayout = "stack",
): string {
  if (!values?.length) return `<view class="actionDock actionDockEmpty"></view>`;
  return `<view class="actionDock actionDock${capitalize(layout)}">${values.map((action, index) => {
    const tone = action.tone ?? "yellow";
    const hierarchy = actionHierarchy(layout, index, values.length, tone);
    const actionIcon = iconForAction(action);
    const secondaryLink = layout === "links" && index > 0;
    const iconTone = secondaryLink || tone === "ink" || tone === "red" ? "cream" : "ink";
    const linkLabel = secondaryLink ? " actionLabelLink" : "";
    const inert = !action.intent && !action.next && !action.back;
    const disabled = inert ? " actionDisabled disabledControl" : "";
    const disabledAttribute = inert ? ' aria-disabled="true" disabled="true"' : "";
    const cutCorner = index === 0 ? " cutCornerCard" : "";
    const notch = index === 0 ? '<view class="cutCornerNotch"></view>' : "";
    return `<button id="action-${index}" class="actionButton${cutCorner} actionTone${capitalize(tone)} ${hierarchy}${disabled}"${disabledAttribute}>${notch}${icon(actionIcon, iconTone, "actionIcon")}<text class="actionLabel actionLabel${capitalize(tone)}${linkLabel}" value="${escapeMarkup(action.label)}"></text></button>`;
  }).join("")}</view>`;
}

export function errorMessage(message: string | null): string {
  return message ? `<text id="error" class="error" value="${escapeMarkup(message)}"></text>` : "";
}

export function frame(
  content: string,
  options: RenderSceneOptions,
  tint: "ink" | "red" | "none" = "ink",
  rootClass = "",
): string {
  return `<view class="scene ${rootClass}">${background(tint)}${content}${errorMessage(options.error)}</view>`;
}

export function rowIcon(row: ScreenRow): IconName {
  const key = `${row.id} ${row.title}`.toLowerCase();
  if (key.includes("sound") || key.includes("声音") || key.includes("音效")) return "speaker-high";
  if (key.includes("network") || key.includes("网络")) return "device-mobile";
  if (key.includes("setting") || key.includes("振动") || key.includes("设置")) return "gear";
  if (key.includes("rule") || key.includes("规则") || key.includes("教学")) return "book-open";
  if (key.includes("room-code") || key.includes("房间码")) return "hash";
  if (key.includes("player") || key.includes("玩家") || key.includes("bot")) return "users-three";
  if (key.includes("timer") || key.includes("计时") || key.includes("同步")) return "arrow-clockwise";
  if (key.includes("privacy") || key.includes("隐私")) return "lock";
  return "info";
}

export function fitForSource(_source: string | undefined): FitMode {
  return "contain";
}

function rowTemplate(row: ScreenRow, index: number, variant: RowVariant): string {
  const variantClass = capitalize(variant);
  const imageClass = variant === "seat"
    ? "seatAvatar"
    : variant === "rank"
      ? "rankAvatar"
      : variant === "paper" && row.image?.includes("/cards/")
        ? "rowImage ruleCardImage"
        : "rowImage";
  const image = row.image
    ? fitImage(row.image, imageClass, fitForSource(row.image), "center center")
    : variant === "menu" || variant === "setting" || variant === "fact"
      ? icon(rowIcon(row), "ink", "rowIcon")
      : "";
  const caret = row.action ? icon("caret-right", "ink", "rowCaret") : "";
  return `<button id="row-${index}" class="row row${variantClass}${row.action ? " rowInteractive" : ""}">${variant === "timeline" ? `<view class="timelineRail"><view class="timelineMarker"></view></view>` : ""}${image}<view class="rowCopy rowCopy${variantClass}"><text class="rowTitle rowTitle${variantClass}" value="${escapeMarkup(row.title)}"></text>${row.detail ? `<text class="rowDetail rowDetail${variantClass}" value="${escapeMarkup(row.detail)}"></text>` : ""}</view>${row.badge ? `<text class="rowBadge" value="${escapeMarkup(row.badge)}"></text>` : ""}${caret}</button>`;
}

function iconForAction(action: ScreenAction): IconName {
  const key = `${action.id} ${action.next ?? ""} ${action.intent?.type ?? ""} ${action.label}`.toLowerCase();
  if (key.includes("share") || key.includes("分享")) return "share-network";
  if (key.includes("join") || key.includes("加入")) return "hash";
  if (key.includes("tutorial") || key.includes("教学")) return "graduation-cap";
  if (key.includes("rule") || key.includes("规则") || key.includes("图鉴")) return "book-open";
  if (key.includes("setting") || key.includes("设置")) return "gear";
  if (key.includes("history") || key.includes("记录")) return "list";
  if (key.includes("reconnect") || key.includes("重试")) return "arrow-clockwise";
  if (key.includes("leave") || key.includes("concede") || key.includes("离开") || key.includes("认输")) return "sign-out";
  if (key.includes("back") || key.includes("返回") || key.includes("取消")) return "arrow-left";
  if (key.includes("ready") || key.includes("confirm") || key.includes("done") || key.includes("记住") || key.includes("交出")) return "check";
  if (key.includes("target") || key.includes("favor") || key.includes("bot") || key.includes("玩家")) return "users-three";
  if (key.includes("future") || key.includes("peek")) return "eye";
  if (key.includes("menu")) return "list";
  return "plus";
}

function actionHierarchy(layout: ActionLayout, index: number, count: number, tone: Tone): string {
  if (layout === "home") return index < 2 ? "actionWide" : "actionHalf actionSmall";
  if (layout === "grid") return index === 0 || (count % 2 === 0 && index === count - 1) ? "actionWide" : "actionHalf actionSmall";
  if (layout === "table") return tone === "ink" ? "actionTableUtility" : "actionTablePrimary";
  if (layout === "links") return index === 0 ? "actionWide" : `actionLink${tone === "red" ? " actionLinkDanger" : ""}`;
  return "actionWide";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
