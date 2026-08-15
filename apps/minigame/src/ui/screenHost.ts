import Layout, { type Canvas as LayoutCanvas, type Element as LayoutElement } from "./layoutEngine";
import type { ClientAction } from "@exploding-kitty/protocol";
import {
  DECLARABLE_CARD_TYPES,
  hasProductAction,
  materializeProductAction,
  selectionCanExtend,
} from "@exploding-kitty/presentation-model";
import type {
  WxDeviceOrientationEvent,
  WxKeyboardAdapter,
  WxLike,
  WxMediaAdapter,
  WxShareAdapter,
  WxWindowResizeEvent,
} from "../platform";
import type { GameSession, RawProductView, ScreenAction, ScreenId, ScreenModel } from "./model";
import { normalizeProductView, type ProductViewModel } from "./normalize";
import { buildScreen, deriveScreen } from "./sceneRegistry";
import { CardTableSurface } from "./cardTableSurface";
import { applyLayoutTransform, extractCssPoint, resolveCanvasMetrics, sizeDisplayCanvas, type CanvasMetrics } from "./canvasMetrics";
import { AuthoritativeSoundPlayer, SOUND_ASSETS } from "./soundEffects";
import { registerFitImage } from "./rendering/fitImage";
import { renderScene } from "./rendering/rendererRegistry";

type ScreenHostOptions = Readonly<{
  wx: WxLike;
  session: GameSession<RawProductView>;
  keyboard: WxKeyboardAdapter;
  media: WxMediaAdapter;
  share: WxShareAdapter;
  initialJoinCode?: string;
  canvas?: HTMLCanvasElement;
}>;

type ScrollElement = LayoutElement & Readonly<{
  scrollTop: number;
  scrollTo(left?: number, top?: number, animate?: boolean): void;
}>;

type TableSize = Readonly<{ width: number; height: number }>;

const DEFAULT_TABLE_SIZE: TableSize = { width: 368, height: 520 };

export class ScreenHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private metrics: CanvasMetrics;
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
  private lastTableSize: TableSize | null = null;
  private unsubscribeTableInvalidation: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private starting = false;
  private disposed = false;
  private error: string | null = null;
  private sending = false;
  private lastRevision = -1;
  private tutorialStep = 0;
  private invitationPending: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clockAnchor = { serverAt: Date.now(), localAt: Date.now() };
  private readonly authoritySounds: AuthoritativeSoundPlayer;
  private readonly displayFont: string;
  private readonly scrollPositions = new Map<ScreenId, number>();
  private lastRenderedId: ScreenId | null = null;
  private windowResizeSubscribed = false;
  private orientationSubscribed = false;
  private readonly handleDisplayChange = (event?: WxWindowResizeEvent | WxDeviceOrientationEvent) => this.refreshDisplayMetrics(event);

  constructor(private readonly options: ScreenHostOptions) {
    this.joinCode = options.initialJoinCode ?? "";
    this.invitationPending = /^\d{6}$/.test(this.joinCode);
    this.metrics = resolveCanvasMetrics(options.wx.getSystemInfoSync(), readCapsuleRect(options.wx));
    this.canvas = options.canvas ?? options.wx.createCanvas();
    sizeDisplayCanvas(this.canvas, this.metrics);
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_2D_UNAVAILABLE");
    this.context = context;
    this.authoritySounds = new AuthoritativeSoundPlayer(options.media);
    this.displayFont = loadDisplayFont(options.wx);
    registerFitImage(Layout);
  }

  start(): void {
    if (this.disposed || this.started || this.starting) return;
    this.starting = true;
    try {
      this.subscribeDisplayChanges();
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
      this.timer = setInterval(() => {
        const view = this.currentView();
        const id = this.resolveId(view);
        if (LIVE_CLOCK_SCREENS.has(id) && (view.game.deadline || Number.isFinite(Number(view.pending?.deadline)))) this.render();
      }, 1_000);
      this.openInvitationIfReady();
      this.render();
      this.started = true;
    } catch (error) {
      this.releaseRuntimeResources();
      throw error;
    } finally {
      this.starting = false;
    }
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
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    this.starting = false;
    this.releaseRuntimeResources();
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
    const previousScroll = Layout.getElementById("scene-scroll") as ScrollElement | null;
    if (previousScroll && this.lastRenderedId) this.scrollPositions.set(this.lastRenderedId, previousScroll.scrollTop);
    this.unsubscribeTableInvalidation?.();
    this.unsubscribeTableInvalidation = null;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    Layout.clear();
    const rendered = renderScene(model, {
      height: this.metrics.logicalHeight,
      safeTop: this.metrics.safeInsets.top,
      safeBottom: this.metrics.safeInsets.bottom,
      capsule: this.metrics.capsuleRect,
      canGoBack: Boolean(this.navigation.length || this.override),
      selectedTokens: this.selectedTokens,
      error: this.error,
      viewerId: view.viewerId,
      displayFont: this.displayFont,
    });
    Layout.init(rendered.template, rendered.styles);
    applyLayoutTransform(this.context, this.metrics);
    Layout.updateViewPort(this.metrics.viewport);
    Layout.layout(this.context);
    const nextScroll = Layout.getElementById("scene-scroll") as ScrollElement | null;
    const savedScrollTop = this.scrollPositions.get(id) ?? 0;
    if (nextScroll && savedScrollTop > 0) nextScroll.scrollTo(0, savedScrollTop, false);
    this.lastRenderedId = id;
    this.bind(model, view);
  }

  private bind(model: ScreenModel, view: ProductViewModel): void {
    const back = Layout.getElementById("back");
    if (back && (this.navigation.length || this.override)) bindClickTree(back, () => this.goBack());
    model.actions?.forEach((action, index) => bindClickTree(Layout.getElementById(`action-${index}`), () => void this.perform(action, view)));
    model.rows?.forEach((row, index) => {
      const element = Layout.getElementById(`row-${index}`);
      if (row.action) bindClickTree(element, () => {
        if (model.id === "rules") this.selectedCard = cardIndexForRule(row.id);
        void this.perform(row.action!, view);
      });
      else if (row.id === "room-code") bindClickTree(element, () => void this.editRoomCode());
    });
    model.cards?.forEach((card, index) => bindClickTree(Layout.getElementById(`card-${index}`), () => {
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
    const width = validLayoutSize(component.layoutBox.width)
      ?? this.lastTableSize?.width
      ?? DEFAULT_TABLE_SIZE.width;
    const height = validLayoutSize(component.layoutBox.height)
      ?? this.lastTableSize?.height
      ?? DEFAULT_TABLE_SIZE.height;
    this.lastTableSize = { width, height };
    const state = { width, height, renderScale: this.metrics.renderScale, deckCount: model.table.deckCount, discard: model.table.discard, hand: model.table.hand, players: model.table.players, myTurn: model.table.myTurn, turnsOwed: model.table.turnsOwed, waitingLabel: model.subtitle ?? model.title, selectedTokens: this.selectedTokens, fontFamily: this.displayFont };
    this.unsubscribeTableInvalidation?.();
    this.unsubscribeTableInvalidation = null;
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
      const x = (touch.x - rect.left) * (width / rect.width);
      const y = (touch.y - rect.top) * (height / rect.height);
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

  private subscribeDisplayChanges(): void {
    const { wx } = this.options;
    if (!this.windowResizeSubscribed && wx.onWindowResize && wx.offWindowResize) {
      try {
        wx.onWindowResize(this.handleDisplayChange);
        this.windowResizeSubscribed = true;
      } catch { /* Older runtimes can expose a stub that throws. */ }
    }
    if (!this.orientationSubscribed && wx.onDeviceOrientationChange && wx.offDeviceOrientationChange) {
      try {
        wx.onDeviceOrientationChange(this.handleDisplayChange);
        this.orientationSubscribed = true;
      } catch { /* Window resize remains sufficient when orientation events are unavailable. */ }
    }
  }

  private unsubscribeDisplayChanges(): void {
    const { wx } = this.options;
    if (this.windowResizeSubscribed) {
      try { wx.offWindowResize?.(this.handleDisplayChange); }
      catch { /* Disposal must continue even when the platform rejects unbinding. */ }
      this.windowResizeSubscribed = false;
    }
    if (this.orientationSubscribed) {
      try { wx.offDeviceOrientationChange?.(this.handleDisplayChange); }
      catch { /* Disposal must continue even when the platform rejects unbinding. */ }
      this.orientationSubscribed = false;
    }
  }

  private releaseRuntimeResources(): void {
    const unsubscribeTableInvalidation = this.unsubscribeTableInvalidation;
    this.unsubscribeTableInvalidation = null;
    try { unsubscribeTableInvalidation?.(); }
    catch { /* Keep releasing the remaining resources. */ }

    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    try { unsubscribe?.(); }
    catch { /* Keep releasing the remaining resources. */ }

    const timer = this.timer;
    this.timer = null;
    if (timer !== null) {
      try { clearInterval(timer); }
      catch { /* Keep releasing the remaining resources. */ }
    }
    this.unsubscribeDisplayChanges();
  }

  private refreshDisplayMetrics(event?: WxWindowResizeEvent | WxDeviceOrientationEvent): void {
    if (this.disposed) return;
    let next: CanvasMetrics;
    try {
      const snapshot = readSystemInfo(this.options.wx);
      const eventSize = readResizeSize(event);
      next = resolveCanvasMetrics({
        ...snapshot,
        windowWidth: eventSize.windowWidth
          ?? positiveDisplayValue(snapshot.windowWidth)
          ?? this.metrics.cssWidth,
        windowHeight: eventSize.windowHeight
          ?? positiveDisplayValue(snapshot.windowHeight)
          ?? this.metrics.cssHeight,
        pixelRatio: positiveDisplayValue(snapshot.pixelRatio) ?? this.metrics.pixelRatio,
      }, readCapsuleRect(this.options.wx));
    } catch {
      return;
    }
    this.metrics = next;
    sizeDisplayCanvas(this.canvas, next);
    this.render();
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
        const positionCount = deckSize + 1;
        const rawDelta = Number(action.intent.delta ?? 1);
        const delta = Number.isFinite(rawDelta) && rawDelta < 0 ? -1 : 1;
        this.insertionPosition = (this.insertionPosition + delta + positionCount) % positionCount;
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

function validLayoutSize(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : null;
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

const LIVE_CLOCK_SCREENS = new Set<ScreenId>(["game", "other-turn", "attack", "response", "give-card", "defuse"]);

function readCapsuleRect(wx: WxLike) {
  try { return wx.getMenuButtonBoundingClientRect?.() ?? null; }
  catch { return null; }
}

function readSystemInfo(wx: WxLike): Partial<ReturnType<WxLike["getSystemInfoSync"]>> {
  try {
    return wx.getSystemInfoSync() ?? {};
  } catch {
    return {};
  }
}

function readResizeSize(event?: WxWindowResizeEvent | WxDeviceOrientationEvent): WxWindowResizeEvent {
  if (!event || typeof event !== "object") return {};
  const resize = event as WxWindowResizeEvent;
  return {
    windowWidth: positiveDisplayValue(resize.windowWidth)
      ?? positiveDisplayValue(resize.size?.windowWidth)
      ?? undefined,
    windowHeight: positiveDisplayValue(resize.windowHeight)
      ?? positiveDisplayValue(resize.size?.windowHeight)
      ?? undefined,
  };
}

function positiveDisplayValue(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function loadDisplayFont(wx: WxLike): string {
  try {
    const family = wx.loadFont?.("assets/fonts/zcool-kuaile-minigame-subset.ttf");
    if (family) return family;
  } catch { /* Use the system face when the packaged font cannot be loaded. */ }
  return "sans-serif";
}

/**
 * The canvas layout engine dispatches to the deepest hit element and does not
 * bubble clicks to a parent button. Binding the complete visual subtree makes
 * its icon, label and artwork share the same 44px+ interaction target.
 */
function bindClickTree(element: LayoutElement | null, listener: () => void): void {
  if (!element) return;
  element.on("click", listener);
  for (const child of element.children) bindClickTree(child, listener);
}
