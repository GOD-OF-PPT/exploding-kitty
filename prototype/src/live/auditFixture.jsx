import React from "react";
import { LiveGameApp } from "./LiveGameApp.jsx";

const avatars = [
  "/assets/cats/player.png",
  "/assets/cats/a-ju.png",
  "/assets/cats/xiao-hui.png",
  "/assets/cats/tuan-zi.png",
];

const cards = [
  { token: "attack", type: "ATTACK", name: "攻击", image: "/assets/cards/attack.png", playable: true, singlePlayable: true },
  { token: "skip", type: "SKIP", name: "跳过", image: "/assets/cards/skip.png", playable: true, singlePlayable: true },
  { token: "defuse", type: "DEFUSE", name: "拆弹", image: "/assets/cards/defuse.png", playable: false, singlePlayable: false },
  { token: "shuffle", type: "SHUFFLE", name: "洗牌", image: "/assets/cards/shuffle.png", playable: true, singlePlayable: true },
  { token: "future", type: "SEE_THE_FUTURE", name: "透视", image: "/assets/cards/peek.png", playable: true, singlePlayable: true },
  { token: "favor", type: "FAVOR", name: "帮忙", image: "/assets/cards/reverse.png", playable: true, singlePlayable: true },
];

function baseView() {
  return {
    authenticated: true,
    status: "ACTIVE",
    lifecycle: "ACTIVE",
    connectivity: "local",
    viewerId: "you",
    user: { id: "you", name: "蓝耳队长", avatar: avatars[0] },
    room: { id: "room", code: "582913", ownerId: "you", maxPlayers: 4, allowBots: true, turnSeconds: 45, rulesetVersion: "original-2025@1" },
    game: { id: "match", turnId: "turn-8", turnPlayerId: "you", turnNumber: 8, turnsOwed: 1, direction: "CLOCKWISE", drawPileCount: 18, discardTop: { type: "DEFUSE", image: "/assets/cards/defuse.png" } },
    players: [
      { id: "you", name: "你", avatar: avatars[0], handCount: 4, alive: true, ready: true, connected: true },
      { id: "orange", name: "阿橘", avatar: avatars[1], handCount: 5, alive: true, ready: true, connected: true },
      { id: "gray", name: "小灰", avatar: avatars[2], handCount: 7, alive: true, ready: true, connected: true },
      { id: "white", name: "团子", avatar: avatars[3], handCount: 4, alive: true, ready: true, connected: true },
    ],
    hand: cards,
    legalActions: ["Draw", "PlayCards"],
    events: [
      { type: "TURN_STARTED", sequence: 8, playerId: "you" },
      { type: "CARDS_COMMITTED", sequence: 7, playerId: "orange", cardType: "ATTACK" },
    ],
    settings: { sound: true, vibration: true },
  };
}

function fixture(kind) {
  const view = baseView();
  if (["home", "play-mode", "create", "join", "tutorial", "rules", "settings"].includes(kind)) { delete view.game; view.room = {}; view.status = "HOME"; }
  if (kind === "login") { delete view.game; view.room = {}; view.status = "UNAUTHENTICATED"; view.authenticated = false; }
  if (kind === "lobby") { delete view.game; view.status = "LOBBY"; view.room.allowBots = false; view.players = view.players.slice(0, 3); }
  if (kind === "lobby-member") { delete view.game; view.status = "LOBBY"; view.room.ownerId = "orange"; view.players[0].ready = false; }
  if (kind === "other-turn") { view.game.turnPlayerId = "orange"; view.game.deadline = Date.now() + 31_000; view.legalActions = []; }
  if (kind === "attack") view.game.turnsOwed = 3;
  if (kind === "response") { view.pending = { kind: "RESPONSE", id: "response", playerId: "orange", cardType: "ATTACK", nopeCount: 0, deadline: Number.MAX_SAFE_INTEGER, deadlineDisplay: 4, canPass: true }; view.legalActions = [{ type: "PassResponse" }, { type: "PlayNope" }]; }
  if (kind === "give-card") { view.pending = { kind: "GIVE_CARD", id: "give", requesterId: "white", requesterName: "团子", deadline: Number.MAX_SAFE_INTEGER, deadlineDisplay: 12 }; view.legalActions = ["Choose"]; }
  if (kind === "defuse") { view.pending = { kind: "DEFUSE_INSERTION", id: "defuse", deckSize: 18, deadline: Number.MAX_SAFE_INTEGER, deadlineDisplay: 15 }; view.legalActions = ["Choose"]; }
  if (kind === "future") { view.pending = { kind: "PRIVATE_PEEK", id: "future", cards: cards.slice(0, 3) }; view.legalActions = ["Choose"]; }
  if (kind === "explosion") { view.pending = { kind: "EXPLOSION", id: "explosion", playerId: "you" }; view.legalActions = [{ type: "UseDefuse" }]; }
  if (kind === "waiting") { view.pending = { kind: "WAITING_PRIVATE_CHOICE", id: "waiting", playerId: "orange", deadline: Number.MAX_SAFE_INTEGER, deadlineDisplay: 12 }; view.legalActions = []; }
  if (kind === "eliminated") { view.eliminated = true; view.players[0].alive = false; view.legalActions = []; view.elimination = { reason: "EXPLOSION", rank: 3, turnSurvived: 12 }; }
  if (kind === "result") { view.status = "FINISHED"; view.result = { summary: "成功躲过 3 次危险", rankings: view.players.map((player, index) => ({ ...player, rank: index + 1, winner: index === 0, reason: index === 0 ? "冠军" : "炸毛" })) }; }
  if (kind === "network") { view.connectivity = "disconnected"; view.connection = { state: "DISCONNECTED" }; }
  return view;
}

function staticSession(view) {
  return {
    getSnapshot: () => view,
    subscribe: () => () => {},
    send: async () => ({ ok: true, snapshot: view }),
  };
}

export function renderAuditFixture(kind) {
  const overlay = {
    "play-mode": "play-mode",
    create: "create",
    join: "join",
    tutorial: "tutorial",
    rules: "rules",
    history: "history",
    "game-menu": "menu",
    settings: "settings",
  }[kind] || null;
  const targetSelection = kind === "favor";
  const view = fixture(targetSelection ? "game" : kind);
  if (targetSelection) view.hand = [view.hand.find((card) => card.type === "FAVOR")];
  return <LiveGameApp session={staticSession(view)} initialOverlay={overlay} initialSelectedTokens={targetSelection ? ["favor"] : []} />;
}
