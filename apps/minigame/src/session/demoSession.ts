import { CARD_CATALOG } from "../ui/copy";
import type { GameSession, RawProductView, SessionSnapshot } from "../ui/model";

type DemoState = {
  phase: "HOME" | "LOBBY" | "MATCH" | "FINISHED";
  viewerId: string;
  authenticated: boolean;
  room?: Record<string, unknown>;
  matchId?: string;
  you?: Record<string, unknown>;
  players?: Record<string, unknown>[];
  deckCount?: number;
  turn?: Record<string, unknown>;
  pending?: Record<string, unknown>;
  winnerId?: string;
  events?: unknown[];
  legalActions?: unknown[];
};

export class DemoGameSession implements GameSession<RawProductView> {
  private state: DemoState = homeState(false);
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  getSnapshot(): SessionSnapshot<RawProductView> {
    return { lifecycle: this.state.phase === "FINISHED" ? "ended" : "active", connectivity: "local", view: this.state as RawProductView, revision: this.revision };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(action: Readonly<{ type: string; [key: string]: unknown }>): Promise<{ ok: true; revision: number }> {
    if (this.disposed) throw new Error("SESSION_DISPOSED");
    this.reduce(action);
    this.revision += 1;
    for (const listener of this.listeners) listener();
    return { ok: true, revision: this.revision };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private reduce(action: Readonly<{ type: string; [key: string]: unknown }>): void {
    switch (action.type) {
      case "Login": this.state = homeState(true); break;
      case "CreateRoom": this.state = lobbyState(true); break;
      case "JoinRoom": this.state = lobbyState(false, String(action.code ?? "839204")); break;
      case "SetReady": this.updatePlayer("you", { ready: Boolean(action.ready) }); break;
      case "AddBot": this.addBot(); break;
      case "RemoveBot": this.state.players = this.state.players?.filter((player) => player.id !== action.playerId); break;
      case "StartMatch": this.state = matchState(false, this.revision + 1); break;
      case "StartTutorial": this.state = matchState(true, this.revision + 1); break;
      case "Draw": this.draw(); break;
      case "PlayCards": this.playCards(action); break;
      case "PlayNope": this.closePending("否决已打出"); break;
      case "PassResponse": this.closePending("行动已放行"); break;
      case "ChooseCard": this.closePending("秘密选择已提交"); break;
      case "AcknowledgePeek": this.closePending("你记住了未来的牌序"); break;
      case "UseDefuse": this.state = { ...this.state, pending: { id: "insert-demo", promptId: "insert-demo", kind: "DEFUSE_INSERTION" } }; break;
      case "InsertKitten": this.closePending("危险猫已秘密放回牌堆"); break;
      case "Concede": this.state = { ...this.state, you: { ...this.state.you, eliminated: true } }; break;
      case "RestartMatch": this.state = matchState(this.state.room?.tutorial === true, this.revision + 1); break;
      case "VoteRestart": this.state = { ...this.state, events: [...(this.state.events ?? []), "你已投票再来一局"] }; break;
      case "LeaveRoom": this.state = homeState(true); break;
      case "Reconnect": break;
    }
  }

  private updatePlayer(id: string, patch: Record<string, unknown>): void {
    this.state.players = this.state.players?.map((player) => player.id === id ? { ...player, ...patch } : player);
  }

  private addBot(): void {
    const players = this.state.players ?? [];
    if (players.length >= Number(this.state.room?.maxPlayers ?? 4)) return;
    this.state.players = [...players, { id: `bot-${players.length}`, name: `机器猫 ${players.length}`, avatar: "assets/cats/xiao-hui.png", handCount: 0, ready: true, bot: true }];
  }

  private draw(): void {
    const hand = Array.isArray(this.state.you?.hand) ? this.state.you.hand : [];
    const next = CARD_CATALOG[(this.revision + 2) % CARD_CATALOG.length]!;
    const turnNumber = Number(this.state.turn?.number ?? 1) + 2;
    const turnId = `turn-${turnNumber}`;
    const nextHand = [...hand, { ...next, token: `${next.type}-${this.revision}` }];
    this.state = {
      ...this.state,
      deckCount: Math.max(0, Number(this.state.deckCount ?? 23) - 1),
      you: { ...this.state.you, hand: nextHand },
      turn: { ...this.state.turn, id: turnId, playerId: "you", number: turnNumber },
      events: [...(this.state.events ?? []), "你抽了 1 张牌", "Bot 完成了回合"],
      legalActions: demoTurnActions(nextHand, turnId),
    };
  }

  private playCards(action: Readonly<{ type: string; [key: string]: unknown }>): void {
    const selected = new Set(Array.isArray(action.cardTokens) ? action.cardTokens.map(String) : []);
    const hand = (Array.isArray(this.state.you?.hand) ? this.state.you.hand : []).filter((card) => !selected.has(String((card as Record<string, unknown>).token)));
    const played = CARD_CATALOG.find((card) => selected.has(card.token));
    const windowId = `window-${this.revision}`;
    this.state = {
      ...this.state,
      you: { ...this.state.you, hand },
      pending: { id: windowId, kind: "RESPONSE", windowId, actorId: "you", cardTypes: played ? [played.type] : [] },
      events: [...(this.state.events ?? []), "你打出了一张动作牌"],
      legalActions: [{ type: "PassResponse", windowId }],
    };
  }

  private closePending(event: string): void {
    const hand = Array.isArray(this.state.you?.hand) ? this.state.you.hand : [];
    const turnId = String(this.state.turn?.id ?? "turn-1");
    this.state = { ...this.state, pending: undefined, events: [...(this.state.events ?? []), event], legalActions: demoTurnActions(hand, turnId) };
  }
}

function homeState(authenticated: boolean): DemoState {
  return { phase: "HOME", viewerId: "you", authenticated, you: { id: "you", name: "蓝耳队长", avatar: "assets/cats/player.png", hand: [] }, players: [] };
}

function lobbyState(host: boolean, code = "839204"): DemoState {
  const players = [
    { id: host ? "you" : "a-ju", name: host ? "你" : "阿橘", avatar: host ? "assets/cats/player.png" : "assets/cats/a-ju.png", handCount: 0, ready: true, host: true },
    { id: host ? "a-ju" : "you", name: host ? "阿橘" : "你", avatar: host ? "assets/cats/a-ju.png" : "assets/cats/player.png", handCount: 0, ready: false },
  ];
  return { phase: "LOBBY", viewerId: "you", authenticated: true, room: { id: "room-demo", code, ownerId: host ? "you" : "a-ju", maxPlayers: 4, allowBots: true, turnSeconds: 45 }, you: players.find((player) => player.id === "you"), players };
}

function matchState(tutorial = false, serial = 1): DemoState {
  const allPlayers = [
    { id: "you", name: "你", avatar: "assets/cats/player.png", handCount: 6, ready: true, host: true },
    { id: "a-ju", name: "阿橘", avatar: "assets/cats/a-ju.png", handCount: 5, ready: true },
    { id: "xiaohui", name: "小灰", avatar: "assets/cats/xiao-hui.png", handCount: 7, ready: true, bot: true },
    { id: "tuanzi", name: "团子", avatar: "assets/cats/tuan-zi.png", handCount: 4, ready: true },
  ];
  const players = tutorial ? [allPlayers[0]!, { ...allPlayers[2]!, handCount: 8 }] : allPlayers;
  const hand = [...CARD_CATALOG.slice(0, 6), CARD_CATALOG[7]];
  return {
    phase: "MATCH", viewerId: "you", authenticated: true,
    room: { id: "room-demo", code: "839204", ownerId: "you", maxPlayers: tutorial ? 2 : 4, allowBots: true, turnSeconds: 45, tutorial },
    matchId: `${tutorial ? "match-tutorial-demo" : "match-demo"}-${serial}`,
    you: { ...players[0], hand }, players, deckCount: 23,
    turn: { id: "turn-1", playerId: "you", number: 1, remaining: 1, direction: "顺时针" },
    events: [{ sequence: 1, type: "MATCH_STARTED" }, { sequence: 2, type: "TURN_STARTED" }],
    legalActions: demoTurnActions(hand, "turn-1"),
  };
}

function demoTurnActions(hand: readonly unknown[], turnId: string): unknown[] {
  const playable = hand
    .map((value) => value as { token?: string; singlePlayable?: boolean })
    .filter((card) => card.singlePlayable && card.token)
    .map((card) => ({ type: "PlayCards", turnId, cardTokens: [card.token] }));
  return [{ type: "Draw", turnId }, ...playable];
}
