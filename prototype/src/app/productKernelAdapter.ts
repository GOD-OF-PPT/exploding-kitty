import {
  applyCommand,
  createBotCommand,
  createMatch,
  legalActions,
  projectView,
  type CardType,
  type Command,
  type GameState,
} from "../game";
import type { CommandEnvelope } from "../session/public";
import type { LocalKernelAdapter } from "../session/local/LocalGameSession";

type ProductPlayer = {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  ready?: boolean;
};

type RoomSettings = {
  code: string;
  maxPlayers: number;
  turnSeconds: number;
  responseSeconds: number;
  choiceSeconds: number;
  allowBots: boolean;
  ruleset: string;
};

type ProductState = {
  authenticated: boolean;
  phase: "HOME" | "LOBBY" | "MATCH" | "FINISHED";
  viewerId: string;
  players: ProductPlayer[];
  room: RoomSettings & { id?: string; ownerId: string };
  game: GameState | null;
  seed: number;
  settings: { sound: boolean; vibration: boolean };
  tutorial: boolean;
  nextDeadlineAt?: number;
};

type ProductKernelOptions = {
  viewerId: string;
  players: ProductPlayer[];
  seed: number;
  sessionId: string;
  room: RoomSettings;
};

const CARD_NAMES: Record<CardType, string> = {
  EXPLODING_KITTEN: "危险猫",
  DEFUSE: "拆弹",
  NOPE: "否决",
  ATTACK: "攻击",
  FAVOR: "帮忙",
  SHUFFLE: "洗牌",
  SKIP: "跳过",
  SEE_FUTURE: "预见未来",
  CAT_TACO: "卷饼猫",
  CAT_BEARD: "胡须猫",
  CAT_POTATO: "土豆猫",
  CAT_RAINBOW: "彩虹猫",
  CAT_WATERMELON: "西瓜猫",
};

const BOT_PROFILES = [
  { name: "阿橘", avatar: "/assets/cats/a-ju.png" },
  { name: "小灰", avatar: "/assets/cats/xiao-hui.png" },
  { name: "团子", avatar: "/assets/cats/tuan-zi.png" },
  { name: "豆包", avatar: "/assets/cats/player.png" },
];

function gameProblem(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_GAME_ERROR";
  const labels: Record<string, string> = {
    NOT_YOUR_TURN: "还没轮到你",
    STALE_TURN: "这个回合已经结束",
    STALE_WINDOW: "否决窗口已经关闭",
    STALE_PROMPT: "这个选择已经失效",
    CARD_NOT_OWNED: "这张牌不在你的手里",
    INVALID_TARGET: "请选择合法目标",
  };
  return { code: message, message: labels[message] || `当前不能执行：${message}`, retryable: false };
}

function commandFromIntent(state: ProductState, envelope: CommandEnvelope): Command {
  const game = state.game!;
  const intent = envelope.intent;
  const actorId = state.viewerId;
  const base = { commandId: envelope.commandId, actorId };
  switch (intent.type) {
    case "Draw":
      return { ...base, type: "Draw", turnId: String(intent.turnId || game.turn?.id || "") };
    case "PlayCards":
      return {
        ...base,
        type: "PlayCards",
        turnId: game.turn?.id || "",
        cardIds: (intent.cardTokens as string[]) || [],
        targetId: intent.target as string | undefined,
        declaredCardType: intent.declaredCardType as CardType | undefined,
      };
    case "PlayNope": {
      const nope = game.players[actorId].hand.find((card) => card.type === "NOPE");
      return { ...base, type: "PlayNope", windowId: String(intent.windowId || ""), cardId: nope?.id || "" };
    }
    case "PassResponse":
      return { ...base, type: "PassResponse", windowId: String(intent.windowId || "") };
    case "UseDefuse": {
      const defuse = game.players[actorId].hand.find((card) => card.type === "DEFUSE");
      return { ...base, type: "UseDefuse", promptId: String(intent.promptId || ""), cardId: defuse?.id || "" };
    }
    case "Choose": {
      const raw = (intent.value || {}) as Record<string, unknown>;
      let value: string | number | { cardId?: string; position?: number; acknowledged?: boolean };
      if (raw.random) value = { position: Math.floor(game.deck.length / 2) };
      else if (raw.cardToken) value = { cardId: String(raw.cardToken) };
      else if (typeof raw.position === "number") value = { position: raw.position };
      else if (raw.acknowledged) value = { acknowledged: true };
      else value = raw as { cardId?: string; position?: number; acknowledged?: boolean };
      return { ...base, type: "Choose", promptId: String(intent.promptId || ""), value };
    }
    case "Concede":
      return { ...base, type: "Concede" };
    default:
      throw new Error(`UNSUPPORTED_MATCH_INTENT_${intent.type}`);
  }
}

function runBots(state: ProductState): void {
  let guard = 0;
  while (state.game?.status === "ACTIVE" && guard++ < 200) {
    const game = state.game;
    let actorId: string | undefined;
    if (game.pending?.kind === "RESPONSE") {
      const response = game.pending;
      actorId = game.order.find((id) => state.players.find((player) => player.id === id)?.isBot && !response.passedPlayerIds.includes(id));
      if (!actorId && !response.passedPlayerIds.includes(state.viewerId)) break;
    } else if (game.pending && "playerId" in game.pending) actorId = game.pending.playerId;
    else if (game.pending?.kind === "FAVOR_CHOICE") actorId = game.pending.targetId;
    else actorId = game.turn?.playerId;
    const isBot = state.players.find((player) => player.id === actorId)?.isBot;
    if (!actorId || !isBot) break;
    const botCommand = createBotCommand(game, actorId);
    if (!botCommand) break;
    state.game = applyCommand(game, botCommand);
  }
  if (state.game?.status === "FINISHED") state.phase = "FINISHED";
}

function settleLocalResponse(state: ProductState): void {
  const response = state.game?.pending;
  if (!response || response.kind !== "RESPONSE") return;
  for (const player of state.players.filter((profile) => profile.isBot)) {
    if (state.game?.pending?.kind !== "RESPONSE") break;
    if (state.game.pending.passedPlayerIds.includes(player.id)) continue;
    const botCommand = createBotCommand(state.game, player.id);
    if (botCommand) state.game = applyCommand(state.game, botCommand);
  }
}

function advanceExpiredDeadlines(state: ProductState, now: number): void {
  let guard = 0;
  while (state.game?.status === "ACTIVE" && guard++ < 20) {
    const deadline = state.game.pending?.deadline ?? state.game.turn?.deadline;
    const deadlineId = state.game.pending?.deadlineId ?? state.game.turn?.deadlineId;
    if (!deadlineId || typeof deadline !== "number" || !Number.isFinite(deadline) || deadline > now) break;
    state.game = applyCommand(state.game, {
      type: "DeadlineElapsed",
      commandId: `deadline-${deadlineId}-${now}`,
      deadlineId,
      now,
    });
    runBots(state);
  }
}

function tickIntent(state: ProductState, commandId: string, now: number): Command | null {
  const deadlineId = state.game?.pending?.deadlineId ?? state.game?.turn?.deadlineId;
  return deadlineId ? { type: "DeadlineElapsed", commandId, deadlineId, now } : null;
}

function projectProduct(state: ProductState) {
  const base = {
    authenticated: state.authenticated,
    phase: state.phase,
    viewerId: state.viewerId,
    user: state.players.find((player) => player.id === state.viewerId),
    room: state.phase === "HOME" ? {} : {
      ...state.room,
      rulesetVersion: state.room.ruleset,
      players: state.players.map((player) => ({ ...player, bot: player.isBot, host: player.id === state.room.ownerId })),
    },
    settings: state.settings,
  };
  if (!state.game) return base;
  const view = projectView(state.game, state.viewerId);
  const publicEventFields = (entry: GameState["events"][number]) => {
    const actorId = String(entry.playerId || entry.actorId || "");
    const actorName = state.players.find((player) => player.id === actorId)?.name;
    const safe: Record<string, unknown> = { type: entry.type, sequence: entry.sequence, actorName };
    if (entry.type === "CARDS_COMMITTED") safe.count = Array.isArray(entry.cardIds) ? entry.cardIds.length : 1;
    if (entry.type === "NOPE_PLAYED") safe.nope = true;
    if (entry.type === "PLAYER_ELIMINATED") safe.reason = entry.reason;
    return safe;
  };
  const events = state.game.events.slice(-40).map(publicEventFields);
  const players = view.players.map((player) => ({
    ...player,
    ...(state.players.find((profile) => profile.id === player.id) || {}),
    bot: state.players.find((profile) => profile.id === player.id)?.isBot,
    host: player.id === state.room.ownerId,
  }));
  const rawPending = view.pending;
  const pending = rawPending?.kind === "FAVOR_CHOICE"
    ? { ...rawPending, requesterName: players.find((player) => player.id === rawPending.requesterId)?.name }
    : rawPending;
  return {
    ...base,
    status: view.status,
    matchId: view.matchId,
    you: view.you,
    players,
    deckCount: view.deckCount,
    discard: view.discard,
    turn: view.turn,
    pending,
    privatePeek: view.privatePeek,
    winnerId: view.winnerId,
    legalActions: legalActions(state.game, state.viewerId),
    events,
    result: view.status === "FINISHED" ? {
      summary: "最后一名存活玩家获胜",
      rankings: [...players]
        .sort((a, b) => Number(b.id === view.winnerId) - Number(a.id === view.winnerId))
        .map((player, index) => ({ ...player, rank: index + 1, winner: player.id === view.winnerId, reason: player.alive ? "存活" : "炸毛" })),
    } : undefined,
    cardNames: CARD_NAMES,
  };
}

export function createProductKernelAdapter(options: ProductKernelOptions): LocalKernelAdapter<ProductState, ReturnType<typeof projectProduct>> {
  return {
    create: () => ({
      authenticated: false,
      phase: "HOME",
      viewerId: options.viewerId,
      players: options.players.map((player, index) => ({ ...player, ready: index === 0 })),
      room: { ...options.room, ownerId: options.viewerId },
      game: null,
      seed: options.seed,
      settings: { sound: true, vibration: true },
      tutorial: false,
      nextDeadlineAt: undefined,
    }),
    restore: (payload) => payload as ProductState,
    serialize: (state) => state,
    project: projectProduct,
    execute: (current, envelope) => {
      const state = structuredClone(current);
      if (state.game) state.game.clock = envelope.sentAt;
      const intent = envelope.intent;
      try {
        if (state.game && intent.type !== "DeadlineElapsed") advanceExpiredDeadlines(state, envelope.sentAt);
        switch (intent.type) {
          case "Login": state.authenticated = true; break;
          case "CreateRoom": {
            const settings = intent.settings as Partial<RoomSettings>;
            state.room = { ...state.room, ...settings, id: options.sessionId, ownerId: state.viewerId };
            state.players = state.players.slice(0, 1);
            state.phase = "LOBBY";
            break;
          }
          case "JoinRoom":
            state.room = { ...state.room, id: String(intent.code), code: String(intent.code), ownerId: state.viewerId };
            state.phase = "LOBBY";
            break;
          case "LeaveRoom": state.phase = "HOME"; state.game = null; break;
          case "AddBot": {
            if (!state.room.allowBots || state.players.length >= state.room.maxPlayers) throw new Error("ROOM_FULL");
            const profile = BOT_PROFILES[state.players.filter((player) => player.isBot).length % BOT_PROFILES.length];
            state.players.push({ id: `bot-${state.players.length}`, ...profile, isBot: true, ready: true });
            break;
          }
          case "RemoveBot": state.players = state.players.filter((player) => player.id !== intent.playerId || !player.isBot); break;
          case "SetReady": {
            const viewer = state.players.find((player) => player.id === state.viewerId);
            if (viewer) viewer.ready = Boolean(intent.ready);
            break;
          }
          case "StartTutorial": {
            state.authenticated = true;
            state.tutorial = true;
            state.players = [state.players[0], ...options.players.filter((player) => player.isBot).slice(0, 1)];
            state.room = { ...state.room, id: "tutorial", code: "教学局", maxPlayers: 2, ownerId: state.viewerId };
            state.game = createMatch({ playerIds: state.players.map((player) => player.id), seed: state.seed, firstPlayerId: state.viewerId, now: envelope.sentAt });
            state.phase = "MATCH";
            break;
          }
          case "StartMatch": {
            if (state.players.length < 2) {
              const profile = BOT_PROFILES[0];
              state.players.push({ id: "bot-1", ...profile, isBot: true, ready: true });
            }
            state.game = createMatch({
              playerIds: state.players.map((player) => player.id),
              seed: state.seed,
              firstPlayerId: state.viewerId,
              now: envelope.sentAt,
              turnDurationMs: state.room.turnSeconds ? state.room.turnSeconds * 1000 : Number.MAX_SAFE_INTEGER,
              responseWindowMs: state.room.responseSeconds * 1000,
              choiceDurationMs: state.room.choiceSeconds * 1000,
            });
            state.phase = "MATCH";
            break;
          }
          case "RestartMatch":
            state.game = createMatch({ playerIds: state.players.map((player) => player.id), seed: state.seed + 1, firstPlayerId: state.viewerId, now: envelope.sentAt });
            state.seed += 1; state.phase = "MATCH"; break;
          case "VoteRestart": break;
          case "UpdateSettings": state.settings = { ...state.settings, sound: intent.sound as boolean ?? state.settings.sound, vibration: intent.vibration as boolean ?? state.settings.vibration }; break;
          case "Reconnect": break;
          case "DeadlineElapsed": {
            if (!state.game) break;
            const command = tickIntent(state, envelope.commandId, envelope.sentAt);
            if (command) state.game = applyCommand(state.game, command);
            runBots(state);
            break;
          }
          default:
            if (!state.game) throw new Error("MATCH_NOT_STARTED");
            state.game = applyCommand(state.game, commandFromIntent(state, envelope));
            if (intent.type === "PlayCards" || intent.type === "PlayNope") settleLocalResponse(state);
            runBots(state);
        }
        return { ok: true, state };
      } catch (error) {
        return { ok: false, state: current, problem: gameProblem(error) };
      }
    },
  };
}
