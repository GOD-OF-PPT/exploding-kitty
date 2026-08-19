import Layout, { type Canvas as LayoutCanvas, type Element as LayoutElement } from "./layoutEngine";
import type { ClientAction } from "@exploding-kitty/protocol";
import type { Text as LayoutText } from "./layoutEngine";
import {
  DECLARABLE_CARD_TYPES,
  hasProductAction,
  materializeProductAction,
  selectionCanExtend,
} from "@exploding-kitty/presentation-model";
import type { WxKeyboardAdapter, WxMediaAdapter, WxShareAdapter, WxLike } from "../platform";
import type { GameSession, RawProductView, ScreenAction, ScreenId, ScreenModel, ScreenRow } from "./model";
import { normalizeProductView, type ProductViewModel } from "./normalize";
import { buildScreen, deriveScreen } from "./sceneRegistry";
import { CardTableSurface } from "./cardTableSurface";
import { UI_STYLE } from "./theme";
import { applyLayoutTransform, extractCssPoint, resolveCanvasMetrics, sizeDisplayCanvas, type CanvasMetrics } from "./canvasMetrics";
import { AuthoritativeSoundPlayer, SOUND_ASSETS } from "./soundEffects";

type ScreenHostOptions = Readonly<{
  wx: WxLike;
  session: GameSession<RawProductView>;
  keyboard: WxKeyboardAdapter;
  media: WxMediaAdapter;
  share: WxShareAdapter;
  initialJoinCode?: string;
  canvas?: HTMLCanvasElement;
}>;

export class ScreenHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly metrics: CanvasMetrics;
  private readonly navigation: ScreenId[] = [];
  private override: ScreenId | null = null;
  private selectedTokens: string[] = [];
  private selectedTargetId: string | undefined;
  private declaredCardType: string | undefined;
  private insertionPosition = 0;
  private spectating = false;
  private selectedCard = 0;
  private handPage = 0;
  private joinCode: string;
  private roomDraft = { maxPlayers: 4, turnSeconds: 45, allowBots: true };
  private tableSurface: CardTableSurface | null = null;
  private unsubscribeTableInvalidation: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private error: string | null = null;
  private sending = false;
  private lastRevision = -1;
  private tutorialStep = 0;
  private invitationPending: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clockAnchor = { serverAt: Date.now(), localAt: Date.now() };
  private readonly authoritySounds: AuthoritativeSoundPlayer;

  constructor(private readonly options: ScreenHostOptions) {
    this.joinCode = options.initialJoinCode ?? "";
    this.invitationPending = /^\d{6}$/.test(this.joinCode);
    this.metrics = resolveCanvasMetrics(options.wx.getSystemInfoSync());
    this.canvas = options.canvas ?? options.wx.createCanvas();
    sizeDisplayCanvas(this.canvas, this.metrics);
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_2D_UNAVAILABLE");
    this.context = context;
    this.authoritySounds = new AuthoritativeSoundPlayer(options.media);
  }

  start(): void {
    this.handleLaunchQuery(this.options.wx.getLaunchOptionsSync?.().query);
    const initial = this.currentView();
    this.lastRevision = this.options.session.getSnapshot().revision ?? -1;
    this.anchorServerClock(initial);
    this.authoritySounds.prime(soundView(initial));
    this.unsubscribe = this.options.session.subscribe(() => {
      const current = this.currentView();
      this.anchorServerClock(current);
      this.authoritySounds.consume(soundView(current));
      const revision = this.options.session.getSnapshot().revision ?? -1;
      if (revision !== this.lastRevision) {
        this.lastRevision = revision;
        this.clearSelection();
        this.handPage = 0;
        this.override = null;
        this.navigation.length = 0;
        if (!current.eliminated) this.spectating = false;
      }
      this.openInvitationIfReady();
      this.render();
    });
    this.openInvitationIfReady();
    this.render();
    this.timer = setInterval(() => {
      const view = this.currentView();
      if (view.game.deadline || Number.isFinite(Number(view.pending?.deadline))) this.refreshCountdown(view);
    }, 1_000);
  }

  handleLaunchQuery(query?: Record<string, string>): void {
    const invitation = query?.room?.replace(/\D/g, "").slice(0, 6) ?? "";
    if (invitation.length !== 6) return;
    const view = this.currentView();
    if (view.room.id || view.game.id) return;
    this.joinCode = invitation;
    this.invitationPending = true;
    this.navigation.length = 0;
    this.openInvitationIfReady();
    if (this.unsubscribe) this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeTableInvalidation?.();
    this.unsubscribeTableInvalidation = null;
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    Layout.clearAll();
    this.options.keyboard.close();
  }

  show(id: ScreenId): void {
    if (id === "login" && this.currentView().authenticated) {
      this.override = "home";
      this.render();
      return;
    }
    const current = this.currentId();
    if (id === "tutorial" && current !== "tutorial") this.tutorialStep = 0;
    if (current === "tutorial" && id !== "tutorial") this.tutorialStep = 0;
    if (current === "eliminated" && id === "other-turn") this.spectating = true;
    if (["favor", "give-card", "defuse"].includes(current) && (id === "game" || id === "other-turn")) this.clearSelection();
    if (current !== id) this.navigation.push(current);
    this.override = id;
    if (id === "game" || id === "other-turn") {
      this.selectedTargetId = undefined;
      this.declaredCardType = undefined;
    }
    this.render();
  }

  private currentView(): ProductViewModel {
    const snapshot = this.options.session.getSnapshot();
    return normalizeProductView(snapshot.view, snapshot.connectivity);
  }

  private currentId(): ScreenId {
    return this.resolveId(this.currentView());
  }

  private render(): void {
    if (this.disposed) return;
    const view = this.currentView();
    const id = this.resolveId(view);
    const model = buildScreen(id, this.sceneContext(view));
    this.unsubscribeTableInvalidation?.();
    this.unsubscribeTableInvalidation = null;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    Layout.clear();
    Layout.init(this.template(model), {
      ...UI_STYLE,
      topSafe: { ...UI_STYLE.topSafe, height: this.metrics.safeInsets.top },
      actionDock: { ...UI_STYLE.actionDock, paddingBottom: 16 + this.metrics.safeInsets.bottom },
      tableActionDock: { ...UI_STYLE.tableActionDock, height: 96 + this.metrics.safeInsets.bottom, paddingBottom: 12 + this.metrics.safeInsets.bottom },
      tableCanvas: { ...UI_STYLE.tableCanvas, height: this.tableHeight(model), minHeight: this.tableHeight(model), maxHeight: this.tableHeight(model) },
    });
    applyLayoutTransform(this.context, this.metrics);
    Layout.updateViewPort(this.metrics.viewport);
    Layout.layout(this.context);
    this.bind(model, view);
  }

  private template(model: ScreenModel): string {
    const canGoBack = Boolean(this.navigation.length || this.override);
    const headerLeft = model.table
      ? `<button id="table-menu" class="tableMenu"><image class="headerIcon" src="assets/ui/icons/cream/list.png"></image></button>`
      : canGoBack
        ? `<button id="back" class="back"><image class="headerIcon" src="assets/ui/icons/cream/arrow-left.png"></image></button>`
        : `<view class="headerSpacer"></view>`;
    const header = `<view class="header">${headerLeft}<view class="headerCopy"><text id="screen-eyebrow" class="eyebrow" value="${escape(model.eyebrow ?? "")}"></text><text class="headerTitle" value="${escape(model.title)}"></text></view><view class="headerSpacer"></view></view>`;
    const subtitle = model.subtitle ? `<text class="subtitle" value="${escape(model.subtitle)}"></text>` : "";
    const heroVariant = heroVariantFor(model);
    const hero = model.heroImage || model.heroLabel
      ? `<view class="hero hero${heroVariant}">${model.heroLabel ? `<text class="stackedHeroLabel stackedHeroLabel${heroVariant}" value="${escape(model.heroLabel)}"></text>` : ""}${model.heroImage ? `<image class="heroImage heroImage${heroVariant}" src="${escape(model.heroImage)}"></image>` : ""}</view>`
      : "";
    const players = model.players ? this.playersTemplate(model.players) : "";
    const tableHeight = this.tableHeight(model);
    const table = model.table ? `${this.playersTemplate(model.table.players.filter((player) => player.id !== this.currentView().viewerId))}<canvas id="tableCanvas" class="tableCanvas" width="358" height="${tableHeight}"></canvas>` : "";
    const cards = model.cards
      ? `<view class="cardGrid">${chunk(model.cards, 3).map((row, rowIndex) => `<view class="cardGridRow">${row.map((card, columnIndex) => { const index = rowIndex * 3 + columnIndex; const selected = this.selectedTokens.includes(card.token); return `<button id="card-${index}" class="cardItem${selected ? " cardSelected" : ""}"><image class="cardImage" src="${escape(card.image)}"></image>${selected ? `<view class="cardCheck"><image class="cardCheckIcon" src="assets/ui/icons/ink/check.png"></image></view>` : ""}<text class="cardName" value="${escape(card.name)}"></text></button>`; }).join("")}</view>`).join("")}</view>`
      : "";
    const rows = model.rows?.length ? `<view class="rowList">${model.rows.map((row, index) => this.rowTemplate(model, row, index)).join("")}</view>` : "";
    const content = `${subtitle}${hero}${players}${table}${cards}${rows}`;
    const body = !model.table || model.scroll ? `<scrollview class="scroll" scrollY="true">${content}</scrollview>` : `<view class="body">${content}</view>`;
    const actions = this.actionDockTemplate(model);
    const tableActions = model.table ? this.tableActionDockTemplate(model) : "";
    const error = this.error ? `<text id="error" class="error" value="${escape(this.error)}"></text>` : "";
    return `<view class="app"><view class="topSafe"></view>${header}${body}${tableActions}${actions}${error}</view>`;
  }

  private rowTemplate(model: ScreenModel, row: ScreenRow, index: number): string {
    const control = row.control;
    const interactive = Boolean(row.action || row.id === "room-code" || control?.kind === "toggle");
    const selected = control?.kind === "selection" && control.selected;
    const tag = control?.kind === "stepper" || control?.kind === "toggle" || !interactive ? "view" : "button";
    const copyClass = control?.kind === "stepper" ? "rowCopy rowCopyControl" : "rowCopy";
    const textSuffix = control?.kind === "stepper" ? " rowTextControl" : "";
    const image = row.image ? `<image class="rowImage rowImage${rowImageVariantFor(model, row.image)}" src="${escape(row.image)}"></image>` : "";
    const badge = row.badge ? `<text class="badge" value="${escape(row.badge)}"></text>` : "";
    const affordance = this.rowControlTemplate(row, index);
    return `<${tag} id="row-${index}" class="row${interactive ? " rowInteractive" : " rowStatic"}${selected ? " rowSelected" : ""}">${image}<view class="${copyClass}"><text class="rowTitle${textSuffix}" value="${escape(row.title)}"></text><text class="rowDetail${textSuffix}" value="${escape(row.detail ?? "")}"></text></view>${badge}${affordance}</${tag}>`;
  }

  private rowControlTemplate(row: ScreenRow, index: number): string {
    const control = row.control;
    if (control?.kind === "toggle") {
      return `<view class="toggle${control.checked ? " toggleOn" : ""}"><view class="toggleThumb"></view></view>`;
    }
    if (control?.kind === "stepper") {
      return `<view class="stepper"><button id="row-${index}-down" class="stepperButton" value="−"></button><text class="stepperValue" value="${escape(control.value)}"></text><button id="row-${index}-up" class="stepperButton" value="+"></button></view>`;
    }
    if (control?.kind === "selection") {
      return `<view class="selectionMark${control.selected ? " selectionMarkSelected" : ""}">${control.selected ? `<image class="selectionCheck" src="assets/ui/icons/ink/check.png"></image>` : ""}</view>`;
    }
    if (row.action || row.id === "room-code") return `<image class="rowChevron" src="assets/ui/icons/ink/caret-right.png"></image>`;
    return "";
  }

  private actionDockTemplate(model: ScreenModel): string {
    if (model.table) return "";
    const entries = (model.actions ?? []).slice(0, 4).map((action, index) => ({ action, index }));
    const primary = primaryAction(model.id, entries);
    const secondary = entries.filter((entry) => entry !== primary);
    const disabledLabel = this.disabledPrimaryLabel(model, primary?.action);
    const primaryMarkup = disabledLabel
      ? `<view class="button buttonDisabled"><text class="buttonDisabledText" value="${escape(disabledLabel)}"></text></view>`
      : primary
        ? this.actionButton(primary.action, primary.index, false)
        : "";
    const secondaryRows = chunk(secondary, 2).map((row) => `<view class="actionRow">${row.map((entry) => this.actionButton(entry.action, entry.index, row.length === 2)).join("")}</view>`).join("");
    if (!primaryMarkup && !secondaryRows) return "";
    return `<view class="actionDock">${primaryMarkup}${secondaryRows}</view>`;
  }

  private disabledPrimaryLabel(model: ScreenModel, action: ScreenAction | undefined): string | null {
    if (this.sending && action) return "处理中…";
    if (model.id === "join" && this.joinCode.length !== 6) return "输入 6 位房间码";
    if (model.id === "favor" && action?.id !== "confirm") return "先选择目标玩家";
    if (model.id === "give-card" && action?.id !== "give") return "先选择一张手牌";
    return null;
  }

  private actionButton(action: ScreenAction, index: number, compact: boolean): string {
    const classes = `button${compact ? " buttonCompact" : ""} button${capitalize(action.tone ?? "yellow")}`;
    return `<button id="action-${index}" class="${classes}" value="${escape(action.label)}"></button>`;
  }

  private tableActionDockTemplate(model: ScreenModel): string {
    if (!model.table?.myTurn) return `<view class="tableActionDock"><text class="tableDockHint" value="等待当前玩家行动"></text></view>`;
    if (!this.selectedTokens.length) return `<view class="tableActionDock"><text class="tableDockHint" value="选择一张牌，或从牌堆抽牌"></text></view>`;

    const action = model.actions?.[0];
    const primaryLabel = this.sending
      ? "处理中…"
      : action?.id === "target"
        ? "下一步"
        : action
          ? "打出"
          : "继续选牌";
    const primary = action && !this.sending
      ? `<button id="table-primary" class="tablePrimaryButton" value="${primaryLabel}"></button>`
      : `<view class="tablePrimaryDisabled"><text class="tablePrimaryDisabledText" value="${primaryLabel}"></text></view>`;
    return `<view class="tableActionDock"><button id="table-cancel" class="tableCancelButton" value="取消"></button>${primary}</view>`;
  }

  private playersTemplate(players: readonly { id: string; name: string; avatar?: string }[]): string {
    return `<view class="players">${players.slice(0, 5).map((player) => `<view class="player"><image class="avatar" src="${escape(player.avatar ?? "assets/cats/player.png")}"></image><text class="playerName" value="${escape(player.name)}"></text></view>`).join("")}</view>`;
  }

  private bind(model: ScreenModel, view: ProductViewModel): void {
    const back = Layout.getElementById("back");
    if (back && (this.navigation.length || this.override)) back.on("click", () => this.goBack());
    Layout.getElementById("table-menu")?.on("click", () => this.show("game-menu"));
    if (!model.table && !this.sending) model.actions?.slice(0, 4).forEach((action, index) => {
      if (model.id === "join" && action.id === "join" && this.joinCode.length !== 6) return;
      Layout.getElementById(`action-${index}`)?.on("click", () => void this.perform(action, view));
    });
    Layout.getElementById("table-cancel")?.on("click", () => {
      this.clearSelection();
      this.error = null;
      this.options.media.impact("light");
      this.render();
    });
    const tableAction = model.table ? model.actions?.[0] : undefined;
    if (tableAction && !this.sending) Layout.getElementById("table-primary")?.on("click", () => void this.perform(tableAction, view));
    model.rows?.forEach((row, index) => {
      const element = Layout.getElementById(`row-${index}`);
      const control = row.control;
      if (control?.kind === "stepper") {
        Layout.getElementById(`row-${index}-down`)?.on("click", () => void this.perform(control.decrement, view));
        Layout.getElementById(`row-${index}-up`)?.on("click", () => void this.perform(control.increment, view));
      } else if (control?.kind === "toggle") {
        element?.on("click", () => void this.perform(control.action, view));
      } else if (row.action) element?.on("click", () => {
        if (model.id === "rules") this.selectedCard = cardIndexForRule(row.id);
        void this.perform(row.action!, view);
      });
      else if (row.id === "room-code") element?.on("click", () => void this.editRoomCode());
    });
    model.cards?.forEach((card, index) => Layout.getElementById(`card-${index}`)?.on("click", () => {
      if (model.id !== "give-card") return;
      const allowed = view.legalActionDetails.some((action) => action.type === "ChooseCard" && action.cardTokens?.includes(card.token));
      if (!allowed) {
        this.error = "这张牌当前不能交出";
        this.render();
        return;
      }
      this.selectedTokens = this.selectedTokens[0] === card.token ? [] : [card.token];
      this.error = null;
      this.options.media.play("select", SOUND_ASSETS.select, 0.42);
      this.options.media.impact("light");
      this.render();
    }));
    if (model.table) this.attachTable(model, view);
  }

  private attachTable(model: ScreenModel, view: ProductViewModel): void {
    const component = Layout.getElementById("tableCanvas") as LayoutCanvas | null;
    if (!component || !model.table) return;
    const tableHeight = this.tableHeight(model);
    const state = { width: 358, height: tableHeight, renderScale: this.metrics.renderScale, deckCount: model.table.deckCount, discard: model.table.discard, hand: model.table.hand, players: model.table.players, myTurn: model.table.myTurn, canDraw: Boolean(model.table.drawAction), turnsOwed: model.table.turnsOwed, selectedTokens: this.selectedTokens, handPage: this.handPage };
    if (this.tableSurface) this.tableSurface.update(state);
    else this.tableSurface = new CardTableSurface(() => this.options.wx.createCanvas(), this.options.wx.createImage?.bind(this.options.wx), state);
    this.unsubscribeTableInvalidation = this.tableSurface.subscribeInvalidation(() => {
      if (this.disposed || component.canvas !== this.tableSurface?.element) return;
      component.update();
    });
    component.canvas = this.tableSurface.element;
    component.update();
    component.on("click", (event: unknown) => {
      const touch = extractCssPoint(event);
      if (!touch || !this.tableSurface) return;
      const rect = Layout.getElementViewportRect(component as unknown as LayoutElement);
      const x = (touch.x - rect.left) * (358 / rect.width);
      const y = (touch.y - rect.top) * (tableHeight / rect.height);
      const pageDelta = this.tableSurface.pageDeltaAt(x, y);
      if (pageDelta) {
        this.handPage += pageDelta;
        this.options.media.impact("light");
        this.render();
        return;
      }
      if (this.tableSurface.drawAt(x, y)) {
        if (!model.table?.drawAction) return;
        this.options.media.impact("medium");
        void this.perform(model.table.drawAction, view);
        return;
      }
      const card = this.tableSurface.cardAt(x, y);
      if (!card) return;
      try {
        this.toggleTableCard(card.token, view);
        this.error = null;
        this.options.media.play("select", SOUND_ASSETS.select, 0.42);
      } catch (error) {
        this.error = error instanceof Error ? error.message : "INVALID_CARD_SELECTION";
      }
      this.options.media.impact("light");
      this.render();
    });
  }

  private refreshCountdown(view: ProductViewModel): void {
    if (this.disposed) return;
    const model = buildScreen(this.resolveId(view), this.sceneContext(view));
    const eyebrow = Layout.getElementById<LayoutText>("screen-eyebrow");
    const value = model.eyebrow ?? "";
    if (!eyebrow || eyebrow.value === value) return;

    eyebrow.value = value;
    // Text.value marks the entire Layout tree dirty. Its box is fixed, so repaint
    // only that opaque header region and keep the table canvas intact.
    for (let element: LayoutElement | null = eyebrow; element; element = element.parent) element.isDirty = false;
    const box = eyebrow.layoutBox;
    this.context.save();
    applyLayoutTransform(this.context, this.metrics);
    this.context.fillStyle = String(UI_STYLE.app?.backgroundColor ?? "#171514");
    this.context.fillRect(box.absoluteX - 1, box.absoluteY - 1, box.width + 2, box.height + 2);
    eyebrow.repaint();
    this.context.restore();
  }

  private tableHeight(model: ScreenModel): number {
    if (!model.table) return 0;
    const dockHeight = 96 + this.metrics.safeInsets.bottom;
    const supplementalRows = model.rows?.length ? 94 : 0;
    return Math.max(370, 844 - this.metrics.safeInsets.top - 82 - 95 - dockHeight - supplementalRows);
  }

  private async perform(action: ScreenAction, view: ProductViewModel): Promise<void> {
    this.error = null;
    if (action.back) {
      this.goBack();
      return;
    }
    if (action.next) {
      if (action.next === "join" && action.id === "join" && action.label.includes("加入")) {
        this.show("join"); return;
      }
      this.show(action.next); return;
    }
    if (!action.intent) return;
    try {
      if (action.intent.type === "NextTutorialStep") {
        this.tutorialStep += 1;
        this.render();
        return;
      }
      const local = action.intent.type === "ToggleSound" || action.intent.type === "ToggleVibration" || action.intent.type === "UpdateSettings";
      if (local) {
        const settings = this.options.media.getSnapshot();
        this.options.media.update(action.intent.type === "ToggleSound" ? { sound: !settings.sound } : action.intent.type === "ToggleVibration" ? { vibration: !settings.vibration } : { sound: action.intent.sound as boolean | undefined, vibration: action.intent.vibration as boolean | undefined });
        this.options.media.impact("light");
        this.render();
        return;
      }
      if (action.intent.type === "AdjustRoomPlayers") {
        const delta = Number(action.intent.delta) < 0 ? -1 : 1;
        this.roomDraft.maxPlayers = Math.max(2, Math.min(5, this.roomDraft.maxPlayers + delta));
        this.options.media.impact("light");
        this.render(); return;
      }
      if (action.intent.type === "AdjustTurnSeconds") {
        const values = [30, 45, 60] as const;
        const current = Math.max(0, values.indexOf(this.roomDraft.turnSeconds as never));
        const delta = Number(action.intent.delta) < 0 ? -1 : 1;
        this.roomDraft.turnSeconds = values[Math.max(0, Math.min(values.length - 1, current + delta))]!;
        this.options.media.impact("light");
        this.render(); return;
      }
      if (action.intent.type === "CycleRoomPlayers") { this.roomDraft.maxPlayers = this.roomDraft.maxPlayers >= 5 ? 2 : this.roomDraft.maxPlayers + 1; this.render(); return; }
      if (action.intent.type === "CycleTurnSeconds") { this.roomDraft.turnSeconds = this.roomDraft.turnSeconds === 30 ? 45 : this.roomDraft.turnSeconds === 45 ? 60 : 30; this.render(); return; }
      if (action.intent.type === "ToggleRoomBots") { this.roomDraft.allowBots = !this.roomDraft.allowBots; this.options.media.impact("light"); this.render(); return; }
      if (action.intent.type === "SelectTarget") { this.selectedTargetId = String(action.intent.targetId); this.options.media.impact("light"); this.render(); return; }
      if (action.intent.type === "AdjustDeclaredCard") {
        const current = DECLARABLE_CARD_TYPES.indexOf(this.declaredCardType as never);
        const delta = Number(action.intent.delta) < 0 ? -1 : 1;
        const next = current < 0
          ? delta < 0 ? DECLARABLE_CARD_TYPES.length - 1 : 0
          : Math.max(0, Math.min(DECLARABLE_CARD_TYPES.length - 1, current + delta));
        this.declaredCardType = DECLARABLE_CARD_TYPES[next];
        this.options.media.impact("light");
        this.render(); return;
      }
      if (action.intent.type === "CycleDeclaredCard") {
        const current = DECLARABLE_CARD_TYPES.indexOf(this.declaredCardType as never);
        this.declaredCardType = DECLARABLE_CARD_TYPES[(current + 1) % DECLARABLE_CARD_TYPES.length]; this.render(); return;
      }
      if (action.intent.type === "AdjustInsertionPosition") {
        const deckSize = insertionDeckSize(view);
        const delta = Number(action.intent.delta) < 0 ? -1 : 1;
        this.insertionPosition = Math.max(0, Math.min(deckSize, this.insertionPosition + delta));
        this.options.media.impact("light");
        this.render(); return;
      }
      if (action.intent.type === "CycleInsertionPosition") {
        const deckSize = insertionDeckSize(view);
        this.insertionPosition = (this.insertionPosition + 1) % (deckSize + 1);
        this.render(); return;
      }
      if (action.intent.type === "ShareRoom") {
        if (!view.room.code) throw new Error("ROOM_CODE_UNAVAILABLE");
        this.options.share.room(view.room.code);
        return;
      }
      if (action.intent.type === "Reconnect") {
        this.options.session.reconnect?.();
        return;
      }
      if (action.intent.type === "Login" && view.connectivity.toLowerCase() !== "local") {
        // Remote sessions authenticate through the auth adapter before the
        // session is created. Sending Login over the wire is rejected by the
        // server as LOGIN_OVER_HTTP_ONLY, so intercept it locally as a no-op.
        // Demo sessions handle Login through session.send() (see DemoGameSession).
        return;
      }
      const materialized = this.materialize(action.intent, view);
      if (!this.isLocallyAllowed(String(materialized.type), view)) throw new Error("ACTION_NOT_AVAILABLE");
      if (this.sending) return;
      this.sending = true;
      this.render();
      const result = await this.options.session.send(materialized as ClientAction).finally(() => { this.sending = false; });
      if (!result.ok) throw new Error(result.message || result.code || "ACTION_REJECTED");
      if (materialized.type === "JoinRoom") this.invitationPending = false;
      if (materialized.type === "StartTutorial") {
        this.tutorialStep = 0;
      }
      this.clearSelection();
      this.override = null;
      this.navigation.length = 0;
      this.options.media.impact(materialized.type === "PlayNope" ? "heavy" : "medium");
      this.render();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "ACTION_FAILED";
      this.render();
    }
  }

  private materialize(raw: Readonly<{ type: string; [key: string]: unknown }>, view: ProductViewModel): Record<string, unknown> {
    if (raw.type === "CreateRoom") return { type: "CreateRoom", settings: { ...this.roomDraft, responseSeconds: 5, choiceSeconds: 15, rulesetVersion: "original-2025@1" } };
    if (raw.type === "JoinRoom") { if (!/^\d{6}$/.test(this.joinCode)) throw new Error("ROOM_CODE_REQUIRED"); return { type: "JoinRoom", code: this.joinCode }; }
    return materializeProductAction(raw, view, {
      selectedTokens: this.selectedTokens,
      selectedTargetId: this.selectedTargetId,
      declaredCardType: this.declaredCardType,
      insertionPosition: this.insertionPosition,
    });
  }

  private async editRoomCode(): Promise<void> {
    try {
      const code = await this.options.keyboard.open({ value: this.joinCode, maxLength: 6, numeric: true }, (value) => {
        this.joinCode = value;
        this.render();
      });
      this.joinCode = code;
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : "KEYBOARD_FAILED";
      if (message === "KEYBOARD_CANCELLED" || this.disposed) return;
      this.error = message;
      this.render();
    }
  }

  private goBack(): void {
    const current = this.currentId();
    if (current === "tutorial") this.tutorialStep = 0;
    if (["favor", "give-card", "defuse"].includes(current)) this.clearSelection();
    if (current === "join") this.invitationPending = false;
    const previous = this.navigation.pop();
    this.override = previous ?? null;
    if (!previous) {
      const view = this.currentView();
      if (!view.game.id && view.phase !== "MATCH" && !view.room.id && view.phase !== "LOBBY" && view.authenticated) this.override = "home";
    }
    this.render();
  }

  private sceneContext(view: ProductViewModel) {
    return { view, settings: this.options.media.getSnapshot(), selectedCard: this.selectedCard, selectedTokens: this.selectedTokens, selectedTargetId: this.selectedTargetId, declaredCardType: this.declaredCardType, insertionPosition: this.insertionPosition, joinCode: this.joinCode, roomDraft: this.roomDraft, spectating: this.spectating, tutorialStep: this.tutorialStep, now: this.clockAnchor.serverAt + (Date.now() - this.clockAnchor.localAt) };
  }

  private anchorServerClock(view: ProductViewModel): void {
    this.clockAnchor = { serverAt: view.serverTime, localAt: Date.now() };
  }

  private toggleTableCard(token: string, view: ProductViewModel): void {
    const card = view.hand.find((entry) => entry.token === token);
    if (!card) throw new Error("CARD_NOT_IN_HAND");
    if (!hasProductAction(view, "PlayCards")) throw new Error("PLAY_NOT_AVAILABLE");
    if (this.selectedTokens.includes(token)) {
      this.selectedTokens = this.selectedTokens.filter((entry) => entry !== token);
      this.selectedTargetId = undefined;
      this.declaredCardType = undefined;
      return;
    }
    if (selectionCanExtend(view, this.selectedTokens, token)) this.selectedTokens = [...this.selectedTokens, token];
    else if (selectionCanExtend(view, [], token)) this.selectedTokens = [token];
    else throw new Error(this.selectedTokens.length ? "该组合当前不可出" : "这张牌当前不可单独打出");
    this.selectedTargetId = undefined;
    this.declaredCardType = undefined;
  }

  private isLocallyAllowed(type: string, view: ProductViewModel): boolean {
    const always = new Set(["Login", "CreateRoom", "JoinRoom", "SetReady", "AddBot", "RemoveBot", "StartMatch", "StartTutorial", "LeaveRoom", "RestartMatch", "VoteRestart", "UpdateSettings"]);
    if (always.has(type)) return true;
    return hasProductAction(view, type);
  }

  private clearSelection(): void {
    this.selectedTokens = [];
    this.selectedTargetId = undefined;
    this.declaredCardType = undefined;
    this.insertionPosition = 0;
  }

  private resolveId(view: ProductViewModel): ScreenId {
    const derived = deriveScreen(this.sceneContext(view));
    if (derived === "network") return "network";
    if (this.override === "login" && view.authenticated) return "home";
    if (this.override) return this.override;
    if (derived === "favor") return view.game.turnsOwed > 1 ? "attack" : "game";
    return derived;
  }

  private openInvitationIfReady(): void {
    if (!this.invitationPending) return;
    const view = this.currentView();
    if (!view.authenticated || view.room.id || view.game.id || view.phase !== "HOME") return;
    if (!["online", "local"].includes(view.connectivity.toLowerCase())) return;
    this.override = "join";
  }
}

function insertionDeckSize(view: ProductViewModel): number {
  const pendingSize = Number(view.pending?.kind === "DEFUSE_INSERTION" ? view.pending.deckSize : Number.NaN);
  return Number.isSafeInteger(pendingSize) && pendingSize >= 0 ? pendingSize : view.game.drawPileCount;
}

function soundView(view: ProductViewModel) {
  return { matchId: view.game.id, connectivity: view.connectivity, events: view.events };
}

function cardIndexForRule(id: string): number {
  const index = RULE_INDEX[id];
  return index ?? 0;
}

const RULE_INDEX: Readonly<Record<string, number>> = {
  flow: 0, danger: 1, defuse: 2, nope: 3, attack: 4, favor: 5,
  shuffle: 6, skip: 7, future: 8, cats: 9, combos: 10, platform: 11,
};

type IndexedAction = Readonly<{ action: ScreenAction; index: number }>;

function primaryAction(id: ScreenId, entries: readonly IndexedAction[]): IndexedAction | undefined {
  const priorities: Partial<Record<ScreenId, readonly string[]>> = {
    "lobby-host": ["start", "share"],
    "lobby-member": ["ready"],
    favor: ["confirm"],
    "give-card": ["give"],
    "game-menu": ["back"],
    result: ["restart", "leave"],
  };
  const preferred = priorities[id];
  if (preferred) {
    for (const actionId of preferred) {
      const match = entries.find((entry) => entry.action.id === actionId);
      if (match) return match;
    }
    return undefined;
  }
  return entries[0];
}

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

type HeroVariant = "Home" | "Result" | "Wide" | "Card" | "Square" | "LabelOnly";

function heroVariantFor(model: ScreenModel): HeroVariant {
  if (model.id === "home") return "Home";
  if (model.id === "result") return "Result";
  if (!model.heroImage) return "LabelOnly";
  if (model.heroImage.includes("/cards/")) return "Card";
  if (model.heroImage.endsWith("/cat-cast.png") || model.heroImage.endsWith("cat-cast.png")) return "Wide";
  return "Square";
}

function rowImageVariantFor(model: ScreenModel, image: string): "Result" | "Card" | "Square" {
  if (model.id === "result") return "Result";
  return image.includes("/cards/") ? "Card" : "Square";
}
