import type { CardType } from "@exploding-kitty/game-core";
import type {
  AcknowledgePeekAction,
  ChooseCardAction,
  ClientAction,
  InsertKittenAction,
  PlayCardsAction,
  PlayNopeAction,
  UpdateSettingsAction,
  UseDefuseAction,
} from "@exploding-kitty/protocol";

export type RawProductView = Readonly<Record<string, unknown>>;

export type ProductLegalAction = Readonly<{
  type: ClientAction["type"] | "Choose";
  turnId?: string;
  windowId?: string;
  promptId?: string;
  cardTokens?: readonly string[];
}>;

export type SceneId =
  | "login" | "home" | "play-mode" | "create" | "join"
  | "lobby-host" | "lobby-member" | "game" | "other-turn" | "attack"
  | "favor" | "response" | "give-card" | "defuse" | "future"
  | "explosion" | "eliminated" | "result" | "tutorial" | "rules"
  | "card-detail" | "history" | "game-menu" | "network" | "settings";

export const SCENE_IDS: readonly SceneId[] = [
  "login", "home", "play-mode", "create", "join", "lobby-host", "lobby-member", "game", "other-turn", "attack",
  "favor", "response", "give-card", "defuse", "future", "explosion", "eliminated", "result", "tutorial", "rules",
  "card-detail", "history", "game-menu", "network", "settings",
] as const;

export type OverlayId = "play-mode" | "create" | "join" | "tutorial" | "rules" | "card-detail" | "history" | "game-menu" | "network" | "settings";

export type ProductCard = Readonly<{
  token: string;
  type: CardType;
  name: string;
  image: string;
  playable: boolean;
  singlePlayable: boolean;
}>;

export type ProductPlayer = Readonly<{
  id: string;
  name: string;
  avatar: string;
  handCount: number;
  alive: boolean;
  ready: boolean;
  bot: boolean;
  host: boolean;
  connected: boolean;
}>;

export type ProductPending =
  | Readonly<{ kind: "RESPONSE"; id: string; windowId?: string; actorId: string; targetId?: string; declaredCardType?: CardType; cardTypes: readonly CardType[]; nopeCount: number; deadline: number; viewerPassed: boolean; canPass: boolean }>
  | Readonly<{ kind: "GIVE_CARD"; id: string; promptId?: string; requesterId: string; requesterName?: string; deadline: number }>
  | Readonly<{ kind: "PRIVATE_PEEK"; id: string; promptId?: string; cards: readonly ProductCard[]; deadline: number }>
  | Readonly<{ kind: "EXPLOSION"; id: string; promptId?: string; playerId: string; deadline: number }>
  | Readonly<{ kind: "DEFUSE_INSERTION"; id: string; promptId?: string; playerId: string; deadline: number; deckSize: number }>
  | Readonly<{ kind: "WAITING_PRIVATE_CHOICE"; id: string; playerId: string; deadline: number; requesterId?: string }>;

export type PublicEvent = Readonly<{
  sequence: number;
  type: string;
  actorId?: string;
  actorName?: string;
  cardType?: CardType;
  cardTypes?: readonly CardType[];
  count?: number;
  reason?: string;
  targetId?: string;
  fromId?: string;
  toId?: string;
  declaredCardType?: CardType;
  mode?: string;
  winnerId?: string;
}>;

export type ProductView = Readonly<{
  authenticated: boolean;
  phase: "HOME" | "LOBBY" | "MATCH" | "FINISHED";
  status: "ACTIVE" | "FINISHED";
  viewerId: string;
  user: Readonly<{ id: string; name: string; avatar: string }>;
  room: Readonly<{
    id?: string;
    code?: string;
    ownerId?: string;
    maxPlayers: number;
    allowBots: boolean;
    turnSeconds: 30 | 45 | 60;
    rulesetVersion: "original-2025@1";
    tutorial: boolean;
  }>;
  game: Readonly<{
    id: string;
    turnId: string;
    turnPlayerId: string;
    turnNumber: number;
    turnsOwed: number;
    drawPileCount: number;
    deckCount: number;
    direction: string;
    deadline: number;
    deadlineAt: number;
    discard?: ProductCard;
  }>;
  players: readonly ProductPlayer[];
  hand: readonly ProductCard[];
  legalActions: readonly ClientAction["type"][];
  legalActionDetails: readonly ProductLegalAction[];
  pending: ProductPending | null;
  privatePeek: readonly ProductCard[];
  events: readonly PublicEvent[];
  eliminated: boolean;
  winnerId: string;
  rankings: readonly Readonly<{ playerId: string; rank: number; reason?: string }>[];
  result?: Readonly<{
    winnerId: string;
    summary: string;
    rankings: readonly Readonly<{ playerId: string; rank: number; reason?: string }>[];
  }>;
  settings: Readonly<{ sound: boolean; vibration: boolean }>;
  serverTime: number;
  connectivity: string;
  restartVotes: readonly string[];
}>;

export type SceneContext = Readonly<{
  overlay?: OverlayId | null;
  connectivity?: "local" | "connecting" | "online" | "offline";
  lifecycle?: "opening" | "active" | "recovering" | "ended" | "failed";
  selectedCards?: readonly ProductCard[];
  spectating?: boolean;
}>;

export function deriveScene(view: ProductView, context: SceneContext = {}): SceneId {
  if (context.overlay) return context.overlay;
  if (["connecting", "offline"].includes(context.connectivity ?? "") || ["opening", "recovering", "failed"].includes(context.lifecycle ?? "")) return "network";
  if (!view.authenticated) return "login";
  if (view.result || view.status === "FINISHED" || view.phase === "FINISHED") return "result";
  if (view.eliminated && !context.spectating) return "eliminated";
  if (view.pending?.kind === "RESPONSE" && hasLegalNopeResponse(view)) return "response";
  if (view.pending?.kind === "GIVE_CARD") return "give-card";
  if (view.pending?.kind === "DEFUSE_INSERTION") return "defuse";
  if (view.pending?.kind === "PRIVATE_PEEK") return "future";
  if (view.pending?.kind === "EXPLOSION") return "explosion";
  if (view.pending?.kind === "WAITING_PRIVATE_CHOICE") return "game";
  if (view.phase === "LOBBY") return view.room.ownerId === view.viewerId ? "lobby-host" : "lobby-member";
  if (view.phase === "MATCH" || view.game.id) {
    if (selectionNeedsTarget(context.selectedCards ?? [])) return "favor";
    if (view.game.turnPlayerId !== view.viewerId) return "other-turn";
    if (view.game.turnsOwed > 1) return "attack";
    return "game";
  }
  return "home";
}

function hasLegalNopeResponse(view: ProductView): boolean {
  const nopeTokens = new Set(view.hand.filter((card) => card.type === "NOPE").map((card) => card.token));
  return view.legalActionDetails.some((action) => action.type === "PlayNope" && action.cardTokens?.some((token) => nopeTokens.has(token)));
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (...values: unknown[]): string => String(values.find((value) => typeof value === "string" || typeof value === "number") ?? "");
const numeric = (fallback: number, ...values: unknown[]): number => {
  const found = values.find((value) => Number.isFinite(Number(value)));
  return found === undefined ? fallback : Number(found);
};
const boolean = (fallback: boolean, ...values: unknown[]): boolean => {
  const found = values.find((value) => typeof value === "boolean");
  return typeof found === "boolean" ? found : fallback;
};

export function normalizeProductView(raw: RawProductView | null, connectivity = "local"): ProductView {
  const source = object(raw);
  const room = object(source.room);
  const you = object(source.you ?? source.me);
  const turn = object(source.turn);
  const viewerId = text(source.viewerId, you.id);
  const legalActionDetails = array(source.legalActions)
    .map(normalizeLegalAction)
    .filter((value): value is ProductLegalAction => Boolean(value));
  const rawHand = array(you.hand ?? source.hand).map(normalizeProductCard);
  const playableTokens = new Set(legalActionDetails.filter((action) => action.type === "PlayCards").flatMap((action) => action.cardTokens ?? []));
  const comboTypes = new Set(legalActionDetails
    .filter((action) => action.type === "PlayCards" && (action.cardTokens?.length ?? 0) > 1)
    .map((action) => rawHand.find((card) => card.token === action.cardTokens?.[0])?.type)
    .filter((type): type is CardType => Boolean(type)));
  const hand = rawHand.map((card) => ({ ...card, playable: playableTokens.has(card.token) || comboTypes.has(card.type) }));
  const players = array(source.players).map((value, index) => normalizeProductPlayer(value, index, viewerId, text(room.ownerId)));
  const viewer = players.find((player) => player.id === viewerId);
  const discardValues = array(source.discard);
  const discardValue = discardValues.length ? discardValues[discardValues.length - 1] : source.discard;
  const discard = discardValue ? normalizeProductCard(discardValue, 0) : undefined;
  const pending = source.pending ? normalizeProductPending(source.pending) : null;
  const privatePeek = array(source.privatePeek).map(normalizeProductCard);
  const rankings = array(source.rankings ?? object(source.result).rankings).map((value) => {
    const ranking = object(value);
    return { playerId: text(ranking.playerId), rank: numeric(0, ranking.rank), ...(text(ranking.reason) ? { reason: text(ranking.reason) } : {}) };
  }).filter((value) => value.playerId && value.rank > 0);
  const winnerId = text(source.winnerId, object(source.result).winnerId);
  const phase = normalizePhase(text(source.phase, source.status, "HOME"));
  const normalizedConnectivity = raw === null ? "connecting" : connectivity.toLowerCase();

  return {
    authenticated: boolean(raw !== null, source.authenticated),
    phase,
    status: winnerId || phase === "FINISHED" ? "FINISHED" : "ACTIVE",
    viewerId,
    user: { id: viewerId, name: text(object(source.user).name, you.name, viewer?.name, "玩家"), avatar: text(object(source.user).avatar, you.avatar, viewer?.avatar, "assets/cats/player.png") },
    room: {
      ...(text(room.id) ? { id: text(room.id) } : {}),
      ...(text(room.code) ? { code: text(room.code) } : {}),
      ...(text(room.ownerId) ? { ownerId: text(room.ownerId) } : {}),
      maxPlayers: numeric(4, room.maxPlayers),
      allowBots: boolean(true, room.allowBots),
      turnSeconds: normalizeTurnSeconds(numeric(45, room.turnSeconds)),
      rulesetVersion: "original-2025@1",
      tutorial: boolean(false, room.tutorial),
    },
    game: {
      id: text(source.matchId, object(source.game).id),
      turnId: text(turn.id, source.turnId),
      turnPlayerId: text(turn.playerId, source.turnPlayerId),
      turnNumber: numeric(1, turn.number, source.turnNumber),
      turnsOwed: numeric(1, turn.remaining, source.turnsOwed),
      direction: normalizeDirection(text(turn.direction, "CLOCKWISE")),
      drawPileCount: numeric(0, source.deckCount, source.drawPileCount),
      deckCount: numeric(0, source.deckCount, source.drawPileCount),
      deadline: numeric(0, turn.deadlineAt),
      deadlineAt: numeric(0, turn.deadlineAt),
      ...(discard ? { discard } : {}),
    },
    players,
    hand,
    legalActions: [...new Set(legalActionDetails.map((action) => action.type).filter(isClientActionType))],
    legalActionDetails,
    pending,
    privatePeek,
    events: array(source.events ?? source.history).map(normalizePublicEvent),
    eliminated: boolean(false, source.eliminated, you.eliminated) || you.alive === false,
    winnerId,
    rankings,
    ...(winnerId ? { result: { winnerId, summary: text(object(source.result).summary), rankings } } : {}),
    settings: { sound: true, vibration: true },
    serverTime: numeric(Date.now(), source.serverTime),
    connectivity: normalizedConnectivity,
    restartVotes: array(source.restartVotes).map((value) => text(value)).filter(Boolean),
  };
}

function normalizeProductCard(value: unknown, index: number): ProductCard {
  const card = typeof value === "string" ? { type: value } : object(value);
  const type = canonicalCardType(text(card.type)) ?? "EXPLODING_KITTEN";
  const definition = CARD_CATALOG[type];
  return {
    token: text(card.token, `${type}-${index}`),
    type,
    name: text(card.name, definition.name),
    image: text(card.image, definition.image, "assets/cards/card-back.png"),
    playable: boolean(definition.singlePlayable, card.playable),
    singlePlayable: definition.singlePlayable,
  };
}

function normalizeProductPlayer(value: unknown, index: number, viewerId: string, ownerId: string): ProductPlayer {
  const player = object(value);
  const id = text(player.id, `player-${index}`);
  const avatars = ["assets/cats/player.png", "assets/cats/a-ju.png", "assets/cats/xiao-hui.png", "assets/cats/tuan-zi.png"];
  return {
    id,
    name: id === viewerId ? text(player.name, "你") : text(player.name, `玩家 ${index + 1}`),
    avatar: text(player.avatar, avatars[index % avatars.length]),
    handCount: numeric(0, player.handCount),
    alive: boolean(true, player.alive),
    ready: boolean(false, player.ready),
    bot: boolean(false, player.bot),
    host: id === ownerId || boolean(false, player.host),
    connected: boolean(true, player.connected),
  };
}

function normalizeLegalAction(value: unknown): ProductLegalAction | null {
  if (typeof value === "string") return isLegalActionType(value) ? { type: value } : null;
  const action = object(value);
  const type = text(action.type);
  if (!isLegalActionType(type)) return null;
  const cardTokens = array(action.cardTokens).map((token) => text(token)).filter(Boolean);
  return {
    type,
    ...(text(action.turnId) ? { turnId: text(action.turnId) } : {}),
    ...(text(action.windowId) ? { windowId: text(action.windowId) } : {}),
    ...(text(action.promptId) ? { promptId: text(action.promptId) } : {}),
    ...(cardTokens.length ? { cardTokens } : {}),
  };
}

function normalizeProductPending(value: unknown): ProductPending | null {
  const pending = object(value);
  const kind = text(pending.kind, pending.type).toUpperCase();
  const id = text(pending.id, pending.windowId, pending.promptId, pending.deadlineId);
  const deadline = numeric(0, pending.deadlineAt, pending.deadline);
  if (kind.includes("RESPONSE") || kind.includes("NOPE")) return {
    kind: "RESPONSE", id, windowId: text(pending.windowId, id), actorId: text(pending.actorId),
    ...(text(pending.targetId) ? { targetId: text(pending.targetId) } : {}),
    ...(canonicalCardType(text(pending.declaredCardType)) ? { declaredCardType: canonicalCardType(text(pending.declaredCardType)) } : {}),
    cardTypes: array(pending.cardTypes).map((type) => canonicalCardType(text(type))).filter((type): type is CardType => Boolean(type)),
    nopeCount: numeric(0, pending.nopeCount), deadline, viewerPassed: boolean(false, pending.viewerPassed), canPass: boolean(false, pending.canPass),
  };
  if (kind.includes("GIVE") || kind.includes("FAVOR")) return { kind: "GIVE_CARD", id, promptId: text(pending.promptId, id), requesterId: text(pending.requesterId), ...(text(pending.requesterName) ? { requesterName: text(pending.requesterName) } : {}), deadline };
  if (kind.includes("DEFUSE") || kind.includes("INSERT")) return { kind: "DEFUSE_INSERTION", id, promptId: text(pending.promptId, id), playerId: text(pending.playerId), deadline, deckSize: numeric(0, pending.deckSize) };
  if (kind.includes("EXPLOS")) return { kind: "EXPLOSION", id, promptId: text(pending.promptId, id), playerId: text(pending.playerId), deadline };
  if (kind.includes("PEEK") || kind.includes("FUTURE")) return { kind: "PRIVATE_PEEK", id, promptId: text(pending.promptId, id), cards: array(pending.cards).map(normalizeProductCard), deadline };
  if (kind.includes("WAITING")) return { kind: "WAITING_PRIVATE_CHOICE", id, playerId: text(pending.playerId), deadline, ...(text(pending.requesterId) ? { requesterId: text(pending.requesterId) } : {}) };
  return null;
}

function normalizePublicEvent(value: unknown, index: number): PublicEvent {
  if (typeof value === "string") return { sequence: index + 1, type: value };
  const event = object(value);
  const cardType = canonicalCardType(text(event.cardType));
  const cardTypes = array(event.cardTypes).map((value) => canonicalCardType(text(value))).filter((value): value is CardType => Boolean(value));
  const declaredCardType = canonicalCardType(text(event.declaredCardType));
  return {
    sequence: numeric(index + 1, event.sequence), type: text(event.type, event.kind, "EVENT"),
    ...(text(event.actorId, event.playerId) ? { actorId: text(event.actorId, event.playerId) } : {}),
    ...(text(event.actorName) ? { actorName: text(event.actorName) } : {}),
    ...(cardType ? { cardType } : {}),
    ...(cardTypes.length ? { cardTypes } : {}),
    ...(Number.isFinite(Number(event.count)) ? { count: Number(event.count) } : {}),
    ...(text(event.reason) ? { reason: text(event.reason) } : {}),
    ...(text(event.targetId) ? { targetId: text(event.targetId) } : {}),
    ...(text(event.fromId) ? { fromId: text(event.fromId) } : {}),
    ...(text(event.toId) ? { toId: text(event.toId) } : {}),
    ...(declaredCardType ? { declaredCardType } : {}),
    ...(text(event.mode) ? { mode: text(event.mode) } : {}),
    ...(text(event.winnerId) ? { winnerId: text(event.winnerId) } : {}),
  };
}

function normalizePhase(value: string): ProductView["phase"] {
  const phase = value.toUpperCase();
  return phase === "LOBBY" || phase === "MATCH" || phase === "FINISHED" ? phase : "HOME";
}

function normalizeTurnSeconds(value: number): 30 | 45 | 60 {
  return value === 30 || value === 60 ? value : 45;
}

function normalizeDirection(value: string): string {
  return value.toUpperCase() === "CLOCKWISE" ? "顺时针" : value;
}

const CLIENT_ACTION_TYPES = new Set<ClientAction["type"]>([
  "Login", "CreateRoom", "JoinRoom", "SetReady", "AddBot", "RemoveBot", "StartMatch", "StartTutorial",
  "Draw", "PlayCards", "PlayNope", "PassResponse", "ChooseCard", "AcknowledgePeek", "UseDefuse",
  "InsertKitten", "Concede", "LeaveRoom", "RestartMatch", "VoteRestart", "UpdateSettings",
]);

function isClientActionType(value: string): value is ClientAction["type"] {
  return CLIENT_ACTION_TYPES.has(value as ClientAction["type"]);
}

function isLegalActionType(value: string): value is ProductLegalAction["type"] {
  return value === "Choose" || isClientActionType(value);
}

export type CardDefinition = Readonly<{
  type: CardType;
  name: string;
  count: number;
  image: string;
  category: "危险牌" | "救援牌" | "响应牌" | "行动牌" | "猫咪牌";
  nopeable: boolean;
  endsTurn: boolean;
  singlePlayable: boolean;
  summary: string;
}>;

export const CARD_CATALOG: Readonly<Record<CardType, CardDefinition>> = {
  EXPLODING_KITTEN: { type: "EXPLODING_KITTEN", name: "危险猫", count: 4, image: "assets/cards/danger.png", category: "危险牌", nopeable: false, endsTurn: true, singlePlayable: false, summary: "抽到后使用拆弹，否则淘汰。" },
  DEFUSE: { type: "DEFUSE", name: "拆弹", count: 6, image: "assets/cards/defuse.png", category: "救援牌", nopeable: false, endsTurn: false, singlePlayable: false, summary: "化解危险猫并秘密放回牌堆。" },
  NOPE: { type: "NOPE", name: "否决", count: 5, image: "assets/cards/card-back.png", category: "响应牌", nopeable: true, endsTurn: false, singlePlayable: false, summary: "取消上一张可否决的行动牌。" },
  ATTACK: { type: "ATTACK", name: "攻击", count: 4, image: "assets/cards/attack.png", category: "行动牌", nopeable: true, endsTurn: true, singlePlayable: true, summary: "结束当前回合，让下一位承担两个回合。" },
  FAVOR: { type: "FAVOR", name: "帮忙", count: 4, image: "assets/cards/reverse.png", category: "行动牌", nopeable: true, endsTurn: false, singlePlayable: true, summary: "指定玩家交给你一张牌。" },
  SHUFFLE: { type: "SHUFFLE", name: "洗牌", count: 4, image: "assets/cards/shuffle.png", category: "行动牌", nopeable: true, endsTurn: false, singlePlayable: true, summary: "立即打乱抽牌堆。" },
  SKIP: { type: "SKIP", name: "跳过", count: 4, image: "assets/cards/skip.png", category: "行动牌", nopeable: true, endsTurn: true, singlePlayable: true, summary: "不抽牌，完成一个欠回合。" },
  SEE_FUTURE: { type: "SEE_FUTURE", name: "预见未来", count: 5, image: "assets/cards/peek.png", category: "行动牌", nopeable: true, endsTurn: false, singlePlayable: true, summary: "秘密查看牌堆顶至多三张牌。" },
  CAT_TACO: { type: "CAT_TACO", name: "卷饼猫", count: 4, image: "assets/cards/reverse.png", category: "猫咪牌", nopeable: true, endsTurn: false, singlePlayable: false, summary: "同名两张或三张可组成组合技。" },
  CAT_BEARD: { type: "CAT_BEARD", name: "胡须猫", count: 4, image: "assets/cards/reverse.png", category: "猫咪牌", nopeable: true, endsTurn: false, singlePlayable: false, summary: "同名两张或三张可组成组合技。" },
  CAT_POTATO: { type: "CAT_POTATO", name: "土豆猫", count: 4, image: "assets/cards/reverse.png", category: "猫咪牌", nopeable: true, endsTurn: false, singlePlayable: false, summary: "同名两张或三张可组成组合技。" },
  CAT_RAINBOW: { type: "CAT_RAINBOW", name: "彩虹猫", count: 4, image: "assets/cards/reverse.png", category: "猫咪牌", nopeable: true, endsTurn: false, singlePlayable: false, summary: "同名两张或三张可组成组合技。" },
  CAT_WATERMELON: { type: "CAT_WATERMELON", name: "西瓜猫", count: 4, image: "assets/cards/reverse.png", category: "猫咪牌", nopeable: true, endsTurn: false, singlePlayable: false, summary: "同名两张或三张可组成组合技。" },
};

/** Every card type is a valid declaration for a three-of-a-kind action. */
export const DECLARABLE_CARD_TYPES: readonly CardType[] = Object.freeze(Object.keys(CARD_CATALOG) as CardType[]);

export function canonicalCardType(value: string): CardType | undefined {
  const normalized = value.trim().replace(/[\s-]+/g, "_").toUpperCase();
  const canonical = normalized === "SEE_THE_FUTURE" ? "SEE_FUTURE" : normalized;
  return canonical in CARD_CATALOG ? canonical as CardType : undefined;
}

export const cardDefinition = (type: CardType | string): CardDefinition | undefined => {
  const canonical = canonicalCardType(type);
  return canonical ? CARD_CATALOG[canonical] : undefined;
};

export function hasLegalAction(view: ProductView, type: ClientAction["type"]): boolean {
  return view.legalActions.includes(type);
}

export function hasProductAction(view: ProductView, type: string): boolean {
  return isClientActionType(type) && hasLegalAction(view, type);
}

export function selectedCardsAreCompatible(cards: readonly ProductCard[]): boolean {
  if (cards.length < 1 || cards.length > 3) return false;
  const first = cards[0]!;
  if (new Set(cards.map((card) => card.token)).size !== cards.length) return false;
  if (!cards.every((card) => card.type === first.type)) return false;
  if (cards.length === 1) return first.singlePlayable && first.playable;
  return first.type !== "EXPLODING_KITTEN";
}

export function selectionNeedsTarget(cards: readonly ProductCard[]): boolean {
  return cards.length > 1 || cards[0]?.type === "FAVOR";
}

export function selectedCards(view: ProductView, tokens: readonly string[]): readonly ProductCard[] {
  const wanted = new Set(tokens);
  const cards = view.hand.filter((card) => wanted.has(card.token));
  return cards.length === wanted.size ? cards : [];
}

export type LegalSelectionKind = "invalid" | "prefix" | "exact";

export function legalSelectionKind(view: ProductView, tokens: readonly string[]): LegalSelectionKind {
  if (!tokens.length || new Set(tokens).size !== tokens.length || selectedCards(view, tokens).length !== tokens.length) return "invalid";
  let prefix = false;
  for (const action of view.legalActionDetails ?? []) {
    if (action.type !== "PlayCards" || !action.cardTokens) continue;
    if (!tokens.every((token) => action.cardTokens!.includes(token))) continue;
    if (action.cardTokens.length === tokens.length) return "exact";
    if (action.cardTokens.length > tokens.length) prefix = true;
  }
  return prefix ? "prefix" : "invalid";
}

export function selectionCanExtend(view: ProductView, selectedTokens: readonly string[], token: string): boolean {
  if (selectedTokens.includes(token)) return true;
  return legalSelectionKind(view, [...selectedTokens, token]) !== "invalid";
}

export function eligibleTargets(view: ProductView, cards: readonly ProductCard[]): readonly ProductPlayer[] {
  if (!selectedCardsAreCompatible(cards)) return [];
  if (!selectionNeedsTarget(cards)) return [];
  const needsCards = cards.length === 2 || (cards.length === 1 && cards[0]?.type === "FAVOR");
  return view.players.filter((player) => player.id !== view.viewerId && player.alive && (!needsCards || player.handCount > 0));
}

export type ProductActionDraft = Readonly<{
  selectedTokens?: readonly string[];
  selectedTargetId?: string;
  declaredCardType?: CardType | string;
  insertionPosition?: number;
}>;

export function materializeProductAction(
  raw: Readonly<{ type: string; [key: string]: unknown }>,
  view: ProductView,
  draft: ProductActionDraft = {},
): ClientAction {
  if (raw.type === "Login") return { type: "Login", provider: "wechat", loginCode: text(raw.loginCode, "demo-login") };
  if (raw.type === "CreateRoom") return raw as unknown as ClientAction;
  if (raw.type === "JoinRoom") return { type: "JoinRoom", code: text(raw.code) };
  if (raw.type === "Draw") {
    const turnId = text(raw.turnId, view.game.turnId);
    if (!turnId) throw new Error("MISSING_TURN_ID");
    return { type: "Draw", turnId };
  }
  if (raw.type === "PlayCards") {
    const turnId = text(raw.turnId, view.game.turnId);
    if (!turnId) throw new Error("MISSING_TURN_ID");
    const cards = selectedCards(view, draft.selectedTokens ?? []);
    if (!cards.length || legalSelectionKind(view, cards.map((card) => card.token)) !== "exact") throw new Error("INVALID_CARD_SELECTION");
    return buildPlayCardsAction(turnId, cards, draft.selectedTargetId, canonicalCardType(text(draft.declaredCardType)));
  }
  if (raw.type === "PlayNope") {
    const windowId = text(raw.windowId, responseWindowId(view));
    const cardToken = text(raw.cardToken, legalCardToken(view, "PlayNope"));
    if (!windowId || !cardToken) throw new Error("MISSING_RESPONSE_WINDOW");
    return buildPlayNopeAction(windowId, cardToken);
  }
  if (raw.type === "PassResponse") {
    const windowId = text(raw.windowId, responseWindowId(view));
    if (!windowId) throw new Error("MISSING_RESPONSE_WINDOW");
    return { type: "PassResponse", windowId };
  }
  if (raw.type === "ChooseCard") {
    const promptId = text(raw.promptId, pendingPromptId(view));
    const cardToken = draft.selectedTokens?.[0] ?? text(raw.cardToken);
    if (!promptId || !cardToken || !legalCardToken(view, "ChooseCard", cardToken)) throw new Error("CARD_NOT_AVAILABLE_FOR_CHOICE");
    return buildChooseCardAction(promptId, cardToken);
  }
  if (raw.type === "AcknowledgePeek") {
    const promptId = text(raw.promptId, pendingPromptId(view));
    if (!promptId) throw new Error("MISSING_PROMPT_ID");
    return buildAcknowledgePeekAction(promptId);
  }
  if (raw.type === "UseDefuse") {
    const promptId = text(raw.promptId, pendingPromptId(view));
    const cardToken = text(raw.cardToken, legalCardToken(view, "UseDefuse"));
    if (!promptId || !cardToken) throw new Error("MISSING_DEFUSE_ACTION");
    return buildUseDefuseAction(promptId, cardToken);
  }
  if (raw.type === "InsertKitten") {
    const promptId = text(raw.promptId, pendingPromptId(view));
    if (!promptId) throw new Error("MISSING_PROMPT_ID");
    const maximum = view.pending?.kind === "DEFUSE_INSERTION" ? view.pending.deckSize : view.game.drawPileCount;
    const position = Math.max(0, Math.min(maximum, draft.insertionPosition ?? numeric(0, raw.position)));
    return buildInsertKittenAction(promptId, position);
  }
  if (!isClientActionType(raw.type)) throw new Error("UNSUPPORTED_ACTION");
  return raw as unknown as ClientAction;
}

function pendingPromptId(view: ProductView): string {
  const pending = view.pending;
  return pending && "promptId" in pending ? text(pending.promptId, pending.id) : pending && "id" in pending ? text(pending.id) : "";
}

function responseWindowId(view: ProductView): string {
  return view.pending?.kind === "RESPONSE" ? text(view.pending.windowId, view.pending.id) : "";
}

function legalCardToken(view: ProductView, type: ProductLegalAction["type"], requested?: string): string {
  const tokens = (view.legalActionDetails ?? []).filter((action) => action.type === type).flatMap((action) => action.cardTokens ?? []);
  return requested ? tokens.includes(requested) ? requested : "" : tokens[0] ?? "";
}

export function buildPlayCardsAction(turnId: string, cards: readonly ProductCard[], targetId?: string, declaredCardType?: CardType): PlayCardsAction {
  if (!selectedCardsAreCompatible(cards)) throw new Error("INCOMPATIBLE_CARD_SELECTION");
  const requiresTarget = cards.length === 2 || cards[0]?.type === "FAVOR";
  if (requiresTarget && !targetId) throw new Error("TARGET_REQUIRED");
  if (cards.length === 3) {
    if (!targetId || !declaredCardType) throw new Error("TARGET_AND_DECLARATION_REQUIRED");
    if (!Object.hasOwn(CARD_CATALOG, declaredCardType)) throw new Error("INVALID_DECLARED_CARD_TYPE");
  }
  return { type: "PlayCards", turnId, cardTokens: cards.map((card) => card.token), ...(targetId ? { targetId } : {}), ...(declaredCardType ? { declaredCardType } : {}) };
}
export const buildPlayNopeAction = (windowId: string, cardToken: string): PlayNopeAction => ({ type: "PlayNope", windowId, cardToken });
export const buildChooseCardAction = (promptId: string, cardToken: string): ChooseCardAction => ({ type: "ChooseCard", promptId, cardToken });
export const buildAcknowledgePeekAction = (promptId: string): AcknowledgePeekAction => ({ type: "AcknowledgePeek", promptId });
export const buildUseDefuseAction = (promptId: string, cardToken: string): UseDefuseAction => ({ type: "UseDefuse", promptId, cardToken });
export const buildInsertKittenAction = (promptId: string, position: number): InsertKittenAction => {
  if (!Number.isSafeInteger(position) || position < 0) throw new Error("INVALID_INSERTION_POSITION");
  return { type: "InsertKitten", promptId, position };
};
export const buildUpdateSettingsAction = (settings: { sound?: boolean; vibration?: boolean }): UpdateSettingsAction => {
  if (settings.sound === undefined && settings.vibration === undefined) throw new Error("EMPTY_SETTINGS_UPDATE");
  return { type: "UpdateSettings", ...settings };
};
