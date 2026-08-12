export const BASE_CARDS = [
  { type: "EXPLODING_KITTEN", name: "危险猫", count: 4, image: "/assets/cards/danger.png", nopeable: false, endsTurn: true, category: "危险牌", copy: "抽到立即揭示；拆弹或淘汰", details: "抽到后必须立刻处理。若有拆弹，就消耗拆弹并秘密放回；否则当场淘汰。" },
  { type: "DEFUSE", name: "拆弹", count: 6, image: "/assets/cards/defuse.png", nopeable: false, endsTurn: false, category: "救援牌", copy: "化解危险猫并秘密放回", details: "只能在抽到危险猫时使用，不能在普通回合主动打出，也不进入否决窗口。" },
  { type: "NOPE", name: "否决", count: 5, image: "/assets/cards/card-back.png", nopeable: true, endsTurn: false, category: "响应牌", copy: "取消上一张可否决的动作牌", details: "所有存活玩家都能在响应窗口打出；奇数张否决取消动作，偶数张让动作重新生效。" },
  { type: "ATTACK", name: "攻击", count: 4, image: "/assets/cards/attack.png", nopeable: true, endsTurn: true, category: "动作牌", copy: "结束你的回合，让下家承担 2 回合", details: "攻击可以叠加并转移欠回合数；跳过只会减少其中 1 个回合。" },
  { type: "FAVOR", name: "帮忙", count: 4, image: "/assets/cards/reverse.png", nopeable: true, endsTurn: false, category: "动作牌", copy: "指定玩家交给你 1 张手牌", details: "你选择目标，对方秘密选择交出的牌；目标必须仍有手牌。" },
  { type: "SHUFFLE", name: "洗牌", count: 4, image: "/assets/cards/shuffle.png", nopeable: true, endsTurn: false, category: "动作牌", copy: "立即打乱抽牌堆", details: "结算后无人知道牌堆顺序；你仍需继续当前回合。" },
  { type: "SKIP", name: "跳过", count: 4, image: "/assets/cards/skip.png", nopeable: true, endsTurn: true, category: "动作牌", copy: "不抽牌，结束 1 个欠回合", details: "普通状态下直接结束回合；被攻击时只减少 1 个欠回合。" },
  { type: "SEE_THE_FUTURE", name: "预见未来", count: 5, image: "/assets/cards/peek.png", nopeable: true, endsTurn: false, category: "动作牌", copy: "秘密查看牌堆顶至多 3 张", details: "牌堆不足 3 张时查看剩余全部；只查看，不改变顺序。" },
  { type: "CAT_CARD", name: "猫咪牌", count: 20, image: "/assets/cards/card-back.png", nopeable: true, endsTurn: false, category: "组合牌", copy: "5 种花色各 4 张；单张无效果", details: "两张同名可随机偷牌，三张同名可点名索要一种牌；组合必须是同一种猫咪牌。" },
];

export const CARD_TYPE_OPTIONS = [
  ...BASE_CARDS.filter((card) => card.type !== "CAT_CARD").map(({ type, name }) => ({ type, name })),
  { type: "CAT_TACO", name: "卷饼猫" },
  { type: "CAT_BEARD", name: "胡须猫" },
  { type: "CAT_POTATO", name: "土豆猫" },
  { type: "CAT_RAINBOW", name: "彩虹猫" },
  { type: "CAT_WATERMELON", name: "西瓜猫" },
];

const aliases = {
  EXPLODING: "EXPLODING_KITTEN",
  EXPLODING_KITTENS: "EXPLODING_KITTEN",
  DANGER: "EXPLODING_KITTEN",
  BOMB: "EXPLODING_KITTEN",
  PEEK: "SEE_THE_FUTURE",
  FUTURE: "SEE_THE_FUTURE",
  SEE_FUTURE: "SEE_THE_FUTURE",
  CAT: "CAT_CARD",
  CATS: "CAT_CARD",
  CATCARD: "CAT_CARD",
  PLAY_NOPE: "NOPE",
};

const CAT_TYPES = new Set([
  "CAT_TACO",
  "CAT_BEARD",
  "CAT_POTATO",
  "CAT_RAINBOW",
  "CAT_WATERMELON",
]);

const first = (...values) => values.find((value) => value !== undefined && value !== null);
const list = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const upper = (value) => String(value ?? "").trim().replace(/[\s-]+/g, "_").toUpperCase();

export function canonicalCardType(value) {
  const key = upper(typeof value === "object" ? first(value.cardType, value.type, value.kind, value.name, value.id) : value);
  return aliases[key] || key || "UNKNOWN";
}

export function cardDefinition(type) {
  const canonical = canonicalCardType(type);
  if (CAT_TYPES.has(canonical)) {
    return {
      type: canonical,
      name: {
        CAT_TACO: "卷饼猫",
        CAT_BEARD: "胡须猫",
        CAT_POTATO: "土豆猫",
        CAT_RAINBOW: "彩虹猫",
        CAT_WATERMELON: "西瓜猫",
      }[canonical],
      image: "/assets/cards/card-back.png",
      nopeable: true,
    };
  }
  return BASE_CARDS.find((card) => card.type === canonical) || {
    type: canonical,
    name: canonical.replaceAll("_", " "),
    image: "/assets/cards/card-back.png",
    nopeable: true,
  };
}

export function normalizeCard(card, index = 0) {
  const source = typeof card === "string" ? { type: card } : card || {};
  const type = canonicalCardType(source);
  const definition = cardDefinition(type);
  return {
    ...source,
    token: String(first(source.token, source.cardToken, source.instanceToken, source.id, `${type}-${index}`)),
    type,
    name: first(source.displayName, source.label, source.localizedName, definition.name),
    image: first(source.image, source.imageUrl, {
      EXPLODING_KITTEN: "/assets/cards/danger.png",
      DEFUSE: "/assets/cards/defuse.png",
      ATTACK: "/assets/cards/attack.png",
      FAVOR: "/assets/cards/reverse.png",
      SHUFFLE: "/assets/cards/shuffle.png",
      SKIP: "/assets/cards/skip.png",
      SEE_THE_FUTURE: "/assets/cards/peek.png",
    }[type], definition.image),
    playable: source.playable !== false && type !== "EXPLODING_KITTEN",
    singlePlayable: ["ATTACK", "FAVOR", "SHUFFLE", "SKIP", "SEE_THE_FUTURE"].includes(type),
  };
}

export function normalizeAction(action) {
  if (typeof action === "string") return { type: upper(action) };
  const value = action || {};
  const rawType = String(first(value.type, value.kind, value.action, value.name) || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return { ...value, type: upper(rawType) };
}

export function normalizePlayer(player, index = 0) {
  const value = player || {};
  const { hand: _privateHand, cards: _privateCards, cardTokens: _privateTokens, privateView: _privateView, ...publicValue } = value;
  return {
    ...publicValue,
    id: String(first(value.id, value.playerId, value.userId, `player-${index}`)),
    name: first(value.displayName, value.nickname, value.name, `玩家 ${index + 1}`),
    handCount: Number(first(value.handCount, value.cardsCount, value.cardCount, list(value.hand).length, 0)),
    alive: first(value.alive, value.isAlive, value.eliminated == null ? true : !value.eliminated),
    ready: Boolean(first(value.ready, value.isReady, false)),
    bot: Boolean(first(value.bot, value.isBot, value.kind === "BOT", false)),
    connected: first(value.connected, value.online, true) !== false,
    avatar: first(value.avatar, value.avatarUrl, [
      "/assets/cats/a-ju.png",
      "/assets/cats/xiao-hui.png",
      "/assets/cats/tuan-zi.png",
      "/assets/cats/player.png",
    ][index % 4]),
  };
}

export function normalizePending(pending) {
  if (!pending) return null;
  const value = typeof pending === "string" ? { type: pending } : pending;
  const rawKind = upper(first(value.kind, value.type, value.promptType, value.name));
  let kind = rawKind;
  if (/(RESPONSE|NOPE)/.test(rawKind)) kind = "RESPONSE";
  else if (/(EXPLOS)/.test(rawKind)) kind = "EXPLOSION";
  else if (/(DEFUSE|INSERT)/.test(rawKind)) kind = "DEFUSE_INSERTION";
  else if (/(FUTURE|PEEK)/.test(rawKind)) kind = "PRIVATE_PEEK";
  else if (/(FAVOR|GIVE).*?(CARD|CHOICE)|CHOOSE_CARD|CARD_GIVE/.test(rawKind) || rawKind === "FAVOR_CHOICE") kind = "GIVE_CARD";
  return {
    ...value,
    kind,
    id: first(value.id, value.promptId, value.windowId),
    deadline: first(value.deadline, value.deadlineAt, value.expiresAt),
    cardType: first(value.cardType, list(value.cardTypes)[0]),
  };
}

function normalizeConnection(source) {
  const raw = first(source.connection, source.network, source.connectionState, source.online);
  if (typeof raw === "object" && raw) {
    return {
      state: upper(first(raw.state, raw.status, raw.connected === false ? "DISCONNECTED" : "CONNECTED")),
      latency: first(raw.latency, raw.latencyMs),
      reconnecting: Boolean(raw.reconnecting),
    };
  }
  if (raw === false) return { state: "DISCONNECTED" };
  return { state: upper(raw || "CONNECTED") };
}

export function normalizeSnapshot(snapshot = {}) {
  const source = snapshot.playerView || snapshot.view || snapshot;
  const room = source.room || snapshot.room || {};
  const game = source.game || source.match || snapshot.game || snapshot.match || source;
  const user = source.user || snapshot.user || {};
  const rawPlayers = first(game.players, room.players, source.players, snapshot.players, []);
  const players = list(rawPlayers).map(normalizePlayer);
  const meId = String(first(source.viewerId, source.playerId, source.you?.id, user.id, snapshot.viewerId, players.find((p) => p.isSelf)?.id, ""));
  const me = players.find((player) => player.id === meId || player.isSelf) || normalizePlayer(source.me || source.you || user, 0);
  const rawHand = first(source.hand, source.myHand, source.you?.hand, game.hand, source.me?.hand, []);
  let legalActions = list(first(source.legalActions, game.legalActions, source.actions, [])).map(normalizeAction);
  const rawStatus = upper(first(source.status, game.status, source.phase, game.phase, room.status, snapshot.status));
  const explicitAuth = first(source.authenticated, snapshot.authenticated, source.session?.authenticated);
  const authenticated = explicitAuth == null
    ? Boolean(meId || user.id || !["", "LOGIN", "UNAUTHENTICATED", "SIGNED_OUT"].includes(rawStatus))
    : Boolean(explicitAuth);
  let pending = normalizePending(first(source.pending, game.pending, source.prompt, source.responseWindow));
  if (!pending && list(source.privatePeek).length) {
    pending = normalizePending({ kind: "PRIVATE_PEEK", id: `peek-${first(source.sequence, snapshot.lastSequence, 0)}`, cards: source.privatePeek });
  }
  const result = first(source.result, game.result, snapshot.result);
  const eliminated = Boolean(first(source.eliminated, me.eliminated, me.alive === false, false));
  const visibleTurn = first(game.turn, source.turn);
  if (!eliminated && !legalActions.length && visibleTurn?.playerId === meId && !pending && rawStatus !== "FINISHED") {
    legalActions = [{ type: "DRAW" }, { type: "PLAY_CARDS" }];
  }
  if (!eliminated && !legalActions.some((action) => action.type === "PLAY_CARDS") && visibleTurn?.playerId === meId && !pending && rawStatus !== "FINISHED") {
    legalActions.push({ type: "PLAY_CARDS" });
  }
  if (eliminated) legalActions = [];

  const winnerId = first(result?.winnerId, source.winnerId, game.winnerId);
  const rawRankings = list(first(result?.rankings, result?.players));
  const rankings = rawRankings.length
    ? rawRankings.map((ranking, index) => {
        const playerId = String(first(ranking.id, ranking.playerId, ""));
        const player = players.find((item) => item.id === playerId) || {};
        return { ...player, ...ranking, id: playerId || player.id || `rank-${index}`, winner: Boolean(first(ranking.winner, playerId === winnerId, false)) };
      })
    : winnerId
      ? players.map((player) => ({ ...player, winner: player.id === winnerId }))
      : [];
  const orderedRankings = rankings
    .slice()
    .sort((a, b) => Number(Boolean(b.winner)) - Number(Boolean(a.winner)) || Number(a.rank ?? Number.MAX_SAFE_INTEGER) - Number(b.rank ?? Number.MAX_SAFE_INTEGER))
    .map((player, index) => ({ ...player, rank: Number(player.rank) || index + 1 }));

  return {
    raw: snapshot,
    status: rawStatus,
    authenticated,
    user: { ...user, id: first(user.id, meId), name: first(user.name, user.nickname, me.name, "蓝耳队长"), avatar: first(user.avatar, user.avatarUrl, me.avatar, "/assets/cats/player.png") },
    room: {
      ...room,
      id: first(room.id, room.roomId),
      code: String(first(room.code, room.inviteCode, room.roomCode, "")),
      ownerId: String(first(room.ownerId, room.hostId, players.find((p) => p.host)?.id, "")),
      maxPlayers: Number(first(room.maxPlayers, room.capacity, 5)),
      allowBots: first(room.allowBots, room.botsAllowed, true) !== false,
      turnSeconds: Number(first(room.turnSeconds, room.turnTime, 45)),
      rulesetVersion: first(room.rulesetVersion, source.rulesetVersion, "original-2025@1"),
    },
    game: {
      ...game,
      id: first(game.id, game.matchId, source.matchId),
      turnId: first(game.turnId, game.turn?.id, source.turn?.id),
      turnPlayerId: String(first(game.turnPlayerId, source.turnPlayerId, game.turn?.playerId, source.turn?.playerId, "")),
      turnNumber: Number(first(game.turnNumber, game.turn?.number, 1)),
      turnsOwed: Number(first(game.turnsOwed, game.turn?.remaining, source.turn?.remaining, source.turnsOwed, 1)),
      direction: first(game.direction, "CLOCKWISE"),
      drawPileCount: Number(first(game.drawPileCount, game.deckCount, source.drawPileCount, source.deckCount, 0)),
      discardTop: normalizeCard(first(game.discardTop, source.discardTop, list(source.discard).at(-1), { type: "UNKNOWN" })),
      deadline: first(game.deadline, game.turn?.deadline, source.turn?.deadline, source.deadline),
      deadlineId: first(game.deadlineId, game.turn?.deadlineId, source.turn?.deadlineId, source.deadlineId),
    },
    me: { ...me, id: meId || me.id },
    players,
    hand: list(rawHand).map(normalizeCard),
    legalActions,
    pending,
    events: list(first(source.events, source.history, game.events, snapshot.events, [])),
    connection: snapshot.connectivity === "local"
      ? { state: "CONNECTED", latency: 0 }
      : normalizeConnection({ ...source, connection: first(source.connection, snapshot.connectivity) }),
    result: result || winnerId ? {
      ...(result || {}),
      summary: first(result?.summary, "最后一名存活玩家获胜"),
      winnerId,
      rankings: orderedRankings,
    } : undefined,
    eliminated,
    elimination: first(source.elimination, source.you?.elimination, me.elimination, {}),
    settings: first(source.settings, snapshot.settings, { sound: true, vibration: true }),
    lastAckSeq: first(snapshot.lastSequence, source.lastAckSeq),
    lifecycle: upper(first(snapshot.lifecycle, source.lifecycle, "ACTIVE")),
  };
}

export function deriveScene(view) {
  const connection = upper(view.connection?.state);
  const lifecycle = upper(view.lifecycle);
  if (["DISCONNECTED", "OFFLINE", "RECONNECTING", "CONNECTING", "RECOVERING", "FAILED", "ERROR"].includes(connection) || ["OPENING", "RECOVERING", "FAILED"].includes(lifecycle)) return "network";
  if (!view.authenticated) return "login";
  if (view.result || /(FINISHED|GAME_OVER|RESULT)/.test(view.status)) return "result";
  if (view.eliminated) return "eliminated";
  if (view.game?.id || /(AWAITING_TURN|PLAYING|MATCH|GAME|RESPONSE|CHOICE|DEFUSE)/.test(view.status)) return "game";
  if (view.room?.id || /(ROOM|LOBBY|READY)/.test(view.status)) return "lobby";
  return "home";
}

export function hasLegalAction(view, ...types) {
  const wanted = types.flat().map(upper);
  return view.legalActions.some((action) => wanted.some((type) => action.type === type || action.type.endsWith(`_${type}`)));
}

export function selectedCardsAreCompatible(cards) {
  return cards.length <= 3 && cards.every((card) => card.type === cards[0]?.type);
}

export function eligibleTargets(view, selectedCards) {
  const count = selectedCards.length;
  const isFavor = count === 1 && selectedCards[0]?.type === "FAVOR";
  return view.players.filter((player) => player.id !== view.me.id && player.alive && (!(isFavor || count === 2) || player.handCount > 0));
}

export function buildPlayCommand(cards, targetId, declaredCardType) {
  const command = { type: "PlayCards", cardTokens: cards.map((card) => card.token) };
  if (targetId) command.target = targetId;
  if (declaredCardType) command.declaredCardType = canonicalCardType(declaredCardType);
  return command;
}

export function eventCopy(event) {
  if (typeof event === "string") return event;
  const type = upper(first(event.type, event.kind));
  const actor = first(event.actorName, event.playerName, event.actor?.name, "系统");
  const card = event.cardName || cardDefinition(event.cardType).name;
  const copies = {
    MATCH_STARTED: "对局开始，所有玩家获得 8 张手牌",
    TURN_STARTED: `${actor} 开始行动`,
    CARDS_COMMITTED: `${actor} 打出了「${card}」`,
    NOPE_PLAYED: `${actor} 打出否决`,
    ACTION_CANCELLED: "原动作已被否决",
    ACTION_RESOLVED: "动作已生效",
    CARD_DRAWN: `${actor} 抽了 1 张牌`,
    EXPLODING_KITTEN_REVEALED: `${actor} 抽到了危险猫`,
    DEFUSE_CONSUMED: `${actor} 使用了拆弹`,
    KITTEN_REINSERTED: "危险猫已被秘密放回牌堆",
    DECK_SHUFFLED: "抽牌堆已重新洗混",
    PLAYER_ELIMINATED: `${actor} 已淘汰`,
    GAME_FINISHED: "对局结束",
  };
  return first(event.copy, event.message, copies[type], type.replaceAll("_", " "));
}

export function eventCopyForView(event, players = []) {
  if (typeof event === "string") return event;
  const player = players.find((item) => item.id === String(first(event?.playerId, event?.actorId, "")));
  return eventCopy(player && !event?.actorName && !event?.playerName ? { ...event, actorName: player.name } : event);
}
