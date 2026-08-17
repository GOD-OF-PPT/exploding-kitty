import Layout, { type Canvas as LayoutCanvas, type Element as LayoutElement } from "./layoutEngine";
import type { ClientAction } from "@exploding-kitty/protocol";
import {
  DECLARABLE_CARD_TYPES,
  hasProductAction,
  materializeProductAction,
  selectionCanExtend,
} from "@exploding-kitty/presentation-model";
import type { WxKeyboardAdapter, WxMediaAdapter, WxShareAdapter, WxLike } from "../platform";
import type { GameSession, RawProductView, ScreenAction, ScreenId, ScreenModel } from "./model";
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
  private joinCode: string;
  private roomDraft = { maxPlayers: 4, turnSeconds: 45, allowBots: true };
  private tableSurface: CardTableSurface | null = null;
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
      if (view.game.deadline || Number.isFinite(Number(view.pending?.deadline))) this.render();
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
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    Layout.clearAll();
    this.options.keyboard.close();
  }

  show(id: ScreenId): void {
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
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    Layout.clear();
    Layout.init(this.template(model), {
      ...UI_STYLE,
      topSafe: { ...UI_STYLE.topSafe, height: this.metrics.safeInsets.top },
      actionDock: { ...UI_STYLE.actionDock, paddingBottom: 16 + this.metrics.safeInsets.bottom },
    });
    applyLayoutTransform(this.context, this.metrics);
    Layout.updateViewPort(this.metrics.viewport);
    Layout.layout(this.context);
    this.bind(model, view);
  }

  private template(model: ScreenModel): string {
    const header = `<view class="header"><button id="back" class="back" value="${this.navigation.length || this.override ? "‹" : ""}"></button><view class="headerCopy"><text class="eyebrow" value="${escape(model.eyebrow ?? "")}"></text><text class="headerTitle" value="${escape(model.title)}"></text></view><view class="headerSpacer"></view></view>`;
    const subtitle = model.subtitle ? `<text class="subtitle" value="${escape(model.subtitle)}"></text>` : "";
    const hero = model.heroImage || model.heroLabel ? `<view class="hero">${model.heroImage ? `<image class="heroImage" src="${escape(model.heroImage)}"></image>` : ""}${model.heroLabel ? `<text class="heroLabel" value="${escape(model.heroLabel)}"></text>` : ""}</view>` : "";
    const players = model.players ? this.playersTemplate(model.players) : "";
    const table = model.table ? `${this.playersTemplate(model.table.players.filter((player) => player.id !== this.currentView().viewerId))}<canvas id="tableCanvas" class="tableCanvas" width="358" height="520"></canvas>` : "";
    const cards = model.cards ? `<view class="cardGrid">${model.cards.map((card, index) => `<button id="card-${index}" class="cardItem${this.selectedTokens.includes(card.token) ? " cardSelected" : ""}"><image class="cardImage" src="${escape(card.image)}"></image><text class="cardName" value="${escape(card.name)}"></text></button>`).join("")}</view>` : "";
    const rows = model.rows?.length ? `<view class="rowList">${model.rows.map((row, index) => `<button id="row-${index}" class="row">${row.image ? `<image class="rowImage" src="${escape(row.image)}"></image>` : ""}<view class="rowCopy"><text class="rowTitle" value="${escape(row.title)}"></text><text class="rowDetail" value="${escape(row.detail ?? "")}"></text></view>${row.badge ? `<text class="badge" value="${escape(row.badge)}"></text>` : ""}</button>`).join("")}</view>` : "";
    const content = `${subtitle}${hero}${players}${table}${cards}${rows}`;
    const body = model.scroll ? `<scrollview class="scroll" scrollY="true">${content}</scrollview>` : `<view class="body">${content}</view>`;
    const actions = `<view class="actionDock">${(model.actions ?? []).slice(0, 4).map((action, index) => `<button id="action-${index}" class="button button${capitalize(action.tone ?? "yellow")}" value="${escape(action.label)}"></button>`).join("")}</view>`;
    const error = this.error ? `<text id="error" class="error" value="${escape(this.error)}"></text>` : "";
    return `<view class="app"><view class="topSafe"></view>${header}${body}${actions}${error}</view>`;
  }

  private playersTemplate(players: readonly { id: string; name: string; avatar?: string }[]): string {
    return `<view class="players">${players.slice(0, 5).map((player) => `<view class="player"><image class="avatar" src="${escape(player.avatar ?? "assets/cats/player.png")}"></image><text class="playerName" value="${escape(player.name)}"></text></view>`).join("")}</view>`;
  }

  private bind(model: ScreenModel, view: ProductViewModel): void {
    const back = Layout.getElementById("back");
    if (back && (this.navigation.length || this.override)) back.on("click", () => this.goBack());
    model.actions?.slice(0, 4).forEach((action, index) => Layout.getElementById(`action-${index}`)?.on("click", () => void this.perform(action, view)));
    model.rows?.forEach((row, index) => {
      const element = Layout.getElementById(`row-${index}`);
      if (row.action) element?.on("click", () => {
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
    const state = { width: 358, height: 520, deckCount: model.table.deckCount, discard: model.table.discard, hand: model.table.hand, players: model.table.players, myTurn: model.table.myTurn, turnsOwed: model.table.turnsOwed, selectedTokens: this.selectedTokens };
    this.tableSurface = new CardTableSurface(() => this.options.wx.createCanvas(), this.options.wx.createImage?.bind(this.options.wx), state);
    component.canvas = this.tableSurface.element;
    component.update();
    component.on("click", (event: unknown) => {
      const touch = extractCssPoint(event);
      if (!touch || !this.tableSurface) return;
      const rect = Layout.getElementViewportRect(component as unknown as LayoutElement);
      const x = (touch.x - rect.left) * (358 / rect.width);
      const y = (touch.y - rect.top) * (520 / rect.height);
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
    void view;
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
        this.render();
        return;
      }
      if (action.intent.type === "CycleRoomPlayers") { this.roomDraft.maxPlayers = this.roomDraft.maxPlayers >= 5 ? 2 : this.roomDraft.maxPlayers + 1; this.render(); return; }
      if (action.intent.type === "CycleTurnSeconds") { this.roomDraft.turnSeconds = this.roomDraft.turnSeconds === 30 ? 45 : this.roomDraft.turnSeconds === 45 ? 60 : 30; this.render(); return; }
      if (action.intent.type === "ToggleRoomBots") { this.roomDraft.allowBots = !this.roomDraft.allowBots; this.render(); return; }
      if (action.intent.type === "SelectTarget") { this.selectedTargetId = String(action.intent.targetId); this.render(); return; }
      if (action.intent.type === "CycleDeclaredCard") {
        const current = DECLARABLE_CARD_TYPES.indexOf(this.declaredCardType as never);
        this.declaredCardType = DECLARABLE_CARD_TYPES[(current + 1) % DECLARABLE_CARD_TYPES.length]; this.render(); return;
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
      const materialized = this.materialize(action.intent, view);
      if (!this.isLocallyAllowed(String(materialized.type), view)) throw new Error("ACTION_NOT_AVAILABLE");
      if (this.sending) return;
      this.sending = true;
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
    if (!selectionCanExtend(view, this.selectedTokens, token)) throw new Error(this.selectedTokens.length ? "该组合当前不可出" : "这张牌当前不可单独打出");
    this.selectedTokens = [...this.selectedTokens, token];
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
    return derived === "network" ? "network" : this.override ?? derived;
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

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
