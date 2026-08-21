import { deriveScene, eligibleTargets, hasProductAction, legalSelectionKind, selectedCards as selectCards, selectionNeedsTarget } from "@exploding-kitty/presentation-model";
import { activityTimeline, latestActivity } from "./activityFeed";
import { CARD_CATALOG, COPY, RULE_DETAILS, RULE_ROWS } from "./copy";
import type { ScreenAction, ScreenId, ScreenModel, ScreenRow } from "./model";
import type { ProductViewModel } from "./normalize";

export type SceneContext = Readonly<{
  view: ProductViewModel;
  selectedCard?: number;
  selectedTokens?: readonly string[];
  selectedTargetId?: string;
  declaredCardType?: string;
  insertionPosition?: number;
  spectating?: boolean;
  joinCode?: string;
  roomDraft?: Readonly<{ maxPlayers: number; turnSeconds: number; allowBots: boolean }>;
  tutorialStep?: number;
  settings?: Readonly<{ sound: boolean; vibration: boolean }>;
  now?: number;
}>;

export type SceneDefinition = Readonly<{
  id: ScreenId;
  build(context: SceneContext): ScreenModel;
}>;

const BACK_IDS = new Set(["back"]);
const nav = (id: string, label: string, next: ScreenId, tone: ScreenAction["tone"] = "cream"): ScreenAction => ({ id, label, next, tone, ...(BACK_IDS.has(id) ? { back: true } : {}) });
const intent = (id: string, label: string, type: string, payload: Record<string, unknown> = {}, tone: ScreenAction["tone"] = "yellow"): ScreenAction => ({ id, label, intent: { type, ...payload }, tone });
const inactive = (id: string, label: string, tone: ScreenAction["tone"] = "ink"): ScreenAction => ({ id, label, tone });
const avatarRows = (
  context: SceneContext,
  viewerReadyDetail = "正在准备",
): ScreenRow[] => context.view.players.map((player) => ({
  id: player.id,
  title: `${player.id === context.view.viewerId ? "你" : player.name}${player.host ? " · 房主" : player.bot ? " · BOT" : ""}`,
  detail: player.id === context.view.viewerId
    ? player.ready ? viewerReadyDetail : "尚未准备"
    : player.ready ? "已准备" : "等待准备",
  badge: `${player.handCount} 张`,
  image: player.avatar,
}));
const can = (context: SceneContext, type: string): boolean => hasProductAction(context.view, type);
const selectedCards = (context: SceneContext) => selectCards(context.view, context.selectedTokens ?? []);
const screens: Record<ScreenId, SceneDefinition> = {
  login: { id: "login", build: () => ({ id: "login", eyebrow: COPY.original, title: COPY.brand, subtitle: "今晚谁先炸？", heroImage: "assets/cat-cast.png", heroLabel: "BOOM!", actions: [intent("login", COPY.enter, "Login", { provider: "wechat" })] }) },
  home: { id: "home", build: (context) => {
    const resumable = context.view.phase === "MATCH" || context.view.phase === "LOBBY";
    return {
      id: "home",
      eyebrow: COPY.tagline,
      title: COPY.brand,
      subtitle: `嗨，${context.view.user.name}`,
      heroImage: "assets/cats/player.png",
      rows: [{ id: "settings", title: "声音与振动", detail: "调整当前设备设置", action: nav("settings", "打开", "settings") }],
      actions: [
        resumable
          ? intent("resume", "继续牌局", "ResumeSession", {}, "yellow")
          : nav("create", COPY.create, "create", "yellow"),
        nav("join", COPY.join, "join", "cream"),
        nav("tutorial", COPY.tutorial, "tutorial", "cyan"),
        nav("rules", COPY.rules, "rules", "cream"),
      ],
    };
  } },
  "play-mode": { id: "play-mode", build: () => ({ id: "play-mode", eyebrow: "选择你的混乱方式", title: COPY.start, heroImage: "assets/cats/player.png", rows: [{ id: "create", title: COPY.create, detail: "设置人数与节奏，邀请好友", action: nav("create", "创建", "create") }, { id: "join", title: COPY.join, detail: "输入好友分享的 6 位房间码", action: nav("join", "加入", "join") }], actions: [nav("back", "返回首页", "home", "ink")] }) },
  create: { id: "create", build: (context) => {
    const draft = context.roomDraft ?? { maxPlayers: 4, turnSeconds: 45, allowBots: true };
    return {
      id: "create",
      eyebrow: "PRIVATE ROOM",
      title: COPY.create,
      rows: [
        {
          id: "players",
          title: "玩家人数",
          detail: "2 至 5 人",
          control: {
            kind: "stepper",
            value: `${draft.maxPlayers} 人`,
            decrement: intent("players-down", "减少玩家", "AdjustRoomPlayers", { delta: -1 }),
            increment: intent("players-up", "增加玩家", "AdjustRoomPlayers", { delta: 1 }),
          },
        },
        {
          id: "timer",
          title: "行动计时",
          detail: "每位玩家的行动时间",
          control: {
            kind: "stepper",
            value: `${draft.turnSeconds} 秒`,
            decrement: intent("timer-down", "缩短时间", "AdjustTurnSeconds", { delta: -1 }),
            increment: intent("timer-up", "延长时间", "AdjustTurnSeconds", { delta: 1 }),
          },
        },
        {
          id: "bots",
          title: "机器人补位",
          detail: "空位允许 Bot 加入",
          control: {
            kind: "toggle",
            checked: draft.allowBots,
            action: intent("toggle-bots", "切换机器人补位", "ToggleRoomBots"),
          },
        },
        { id: "ruleset", title: "规则集", detail: "original-2025@1", badge: "基础版" },
      ],
      actions: [intent("create", "创建并邀请", "CreateRoom"), nav("back", "返回", "play-mode", "ink")],
    };
  } },
  join: { id: "join", build: (context) => ({ id: "join", eyebrow: "JOIN THE CHAOS", title: COPY.join, subtitle: "输入好友发来的 6 位房间码", heroImage: "assets/cats/a-ju.png", rows: [{ id: "room-code", title: "房间码", detail: context.joinCode || "点击输入", badge: context.joinCode?.length === 6 ? "可加入" : "6 位数字" }], actions: [intent("join", "进入房间", "JoinRoom"), nav("back", "返回", "play-mode", "ink")] }) },
  "lobby-host": { id: "lobby-host", build: (context) => ({ id: "lobby-host", eyebrow: `ROOM #${context.view.room.code}`, title: COPY.lobby, subtitle: "你是房主，所有人准备后即可开始", rows: avatarRows(context, "已准备").map((row) => { const player = context.view.players.find((entry) => entry.id === row.id); return player?.bot ? { ...row, detail: "点击移除这个 Bot", action: intent(`remove-${row.id}`, "移除", "RemoveBot", { playerId: row.id }, "red") } : row; }), actions: [intent("share", "分享房间码", "ShareRoom", {}, "yellow"), ...(context.view.room.allowBots && context.view.players.length < context.view.room.maxPlayers ? [intent("bot", "加入 Bot", "AddBot", {}, "cream")] : []), ...(context.view.players.length >= 2 && context.view.players.every((player) => player.ready) ? [intent("start", "开始游戏", "StartMatch", {}, "cyan")] : []), intent("leave", "离开房间", "LeaveRoom", {}, "ink")], scroll: true }) },
  "lobby-member": { id: "lobby-member", build: (context) => { const ready = context.view.players.find((player) => player.id === context.view.viewerId)?.ready ?? false; return { id: "lobby-member", eyebrow: `ROOM #${context.view.room.code}`, title: COPY.lobby, subtitle: "房主正在调整规则", rows: avatarRows(context), actions: [intent("ready", ready ? "取消准备" : "我准备好了", "SetReady", { ready: !ready }), nav("rules", COPY.rules, "rules", "cream"), intent("leave", "离开房间", "LeaveRoom", {}, "ink")], scroll: true }; } },
  game: { id: "game", build: (context) => table(context, true) },
  "other-turn": { id: "other-turn", build: (context) => { const active = context.view.players.find((player) => player.id === context.view.game.turnPlayerId); return { ...table(context, false), id: "other-turn", subtitle: active ? `等待${active.name}行动…` : "等待其他玩家行动…" }; } },
  attack: { id: "attack", build: (context) => ({ ...table(context, true), id: "attack", eyebrow: "攻击已生效", title: `你还欠 ${Math.max(2, context.view.game.turnsOwed)} 个回合！`, heroLabel: "×2" }) },
  response: { id: "response", build: (context) => { const pending = context.view.pending?.kind === "RESPONSE" ? context.view.pending : null; const windowId = pending?.windowId ?? pending?.id ?? ""; const legalNope = context.view.legalActionDetails.find((action) => action.type === "PlayNope" && action.cardTokens?.[0]); const actor = context.view.players.find((player) => player.id === pending?.actorId); const target = context.view.players.find((player) => player.id === pending?.targetId); const types = pending?.cardTypes.length ? pending.cardTypes.map((type) => cardName(type)).join(" + ") : "动作"; const declaration = pending?.declaredCardType ? `，声明 ${cardName(pending.declaredCardType)}` : ""; const targetCopy = target ? `，目标 ${target.name}` : ""; return { id: "response", eyebrow: `否决窗口 · ${remainingSeconds(pending?.deadline, context)} 秒`, title: "要取消这次行动吗？", subtitle: `${actor?.name ?? "一名玩家"}打出了 ${types}${targetCopy}${declaration}。再次否决会让原动作重新生效。`, heroImage: "assets/cards/card-back.png", heroLabel: "NOPE!", actions: [...(legalNope && windowId ? [intent("nope", "打出否决", "PlayNope", { cardToken: legalNope.cardTokens![0], windowId }, "red")] : []), ...(can(context, "PassResponse") && windowId ? [intent("pass", "放行", "PassResponse", { windowId }, "cream")] : [])] }; } },
  favor: { id: "favor", build: (context) => {
    const cards = selectedCards(context);
    const count = cards.length;
    const needsDeclaration = count === 3;
    const eligible = new Set(eligibleTargets(context.view, cards).map((player) => player.id));
    const rows: ScreenRow[] = avatarRows(context)
      .filter((row) => eligible.has(row.id))
      .map((row) => ({
        ...row,
        detail: [row.detail, row.badge].filter(Boolean).join(" · "),
        badge: undefined,
        action: { id: `target-${row.id}`, label: "选择", intent: { type: "SelectTarget", targetId: row.id } },
        control: { kind: "selection", selected: row.id === context.selectedTargetId },
      }));
    if (needsDeclaration) {
      rows.push({
        id: "declare",
        title: "声明索要的牌型",
        detail: "使用两侧按钮选择",
        control: {
          kind: "stepper",
          value: context.declaredCardType ? cardName(context.declaredCardType) : "请选择",
          decrement: intent("declare-down", "上一种牌", "AdjustDeclaredCard", { delta: -1 }),
          increment: intent("declare-up", "下一种牌", "AdjustDeclaredCard", { delta: 1 }),
        },
      });
    }
    const ready = Boolean(context.selectedTargetId && eligible.has(context.selectedTargetId) && (!needsDeclaration || context.declaredCardType));
    return {
      id: "favor",
      eyebrow: count === 1 ? "帮忙 · FAVOR" : count === 2 ? "两张同名组合" : "三张同名组合",
      title: "选择目标玩家",
      subtitle: count === 3 ? "选择玩家并声明一种牌" : "对方将交出或失去一张牌",
      heroImage: cards[0]?.image ?? "assets/cards/reverse.png",
      rows,
      actions: [...(ready ? [intent("confirm", "确认目标并出牌", "PlayCards")] : []), nav("back", "取消", "game", "ink")],
      scroll: true,
    };
  } },
  "give-card": { id: "give-card", build: (context) => { const pending = context.view.pending; const promptId = String(pending && "promptId" in pending ? pending.promptId ?? pending.id : ""); const card = selectedCards(context)[0]; const allowed = card && context.view.legalActionDetails.some((action) => action.type === "ChooseCard" && action.cardTokens?.includes(card.token)); return { id: "give-card", eyebrow: `秘密选择 · ${remainingSeconds(pending?.deadline, context)} 秒`, title: "交给对方一张牌", subtitle: card ? `已选择：${card.name}` : "点击选择要交出的手牌；只有双方会看到", cards: context.view.hand, scroll: true, actions: [...(allowed && promptId ? [intent("give", "交出所选牌", "ChooseCard", { promptId, cardToken: card.token })] : [])] }; } },
  future: { id: "future", build: (context) => { const pending = context.view.pending?.kind === "PRIVATE_PEEK" ? context.view.pending : null; const promptId = pending?.promptId ?? pending?.id ?? ""; const cards: ScreenModel["cards"] = pending?.cards.length ? pending.cards : context.view.privatePeek; return { id: "future", eyebrow: "仅你可见", title: "未来的三张牌", subtitle: "从左到右依次抽到，查看不会改变顺序", cards, actions: can(context, "AcknowledgePeek") && promptId ? [intent("done", "记住了", "AcknowledgePeek", { promptId })] : [] }; } },
  explosion: { id: "explosion", build: (context) => { const pending = context.view.pending; const promptId = String(pending && "promptId" in pending ? pending.promptId ?? pending.id : ""); const legalDefuse = context.view.legalActionDetails.find((action) => action.type === "UseDefuse" && action.cardTokens?.[0]); return { id: "explosion", eyebrow: "危险猫出现了！", title: "砰！你抽到了危险", subtitle: legalDefuse ? "你有一张拆弹，赶紧化解危机。" : "没有可用的拆弹，等待服务器处理淘汰。", heroImage: "assets/cards/danger.png", heroLabel: "BOOM!", actions: promptId && legalDefuse ? [intent("defuse", "使用拆弹", "UseDefuse", { promptId, cardToken: legalDefuse.cardTokens![0] }, "cyan")] : [] }; } },
  defuse: { id: "defuse", build: (context) => {
    const pending = context.view.pending;
    const promptId = String(pending && "promptId" in pending ? pending.promptId ?? pending.id : "");
    const deckSize = Number(pending?.kind === "DEFUSE_INSERTION" ? pending.deckSize : context.view.game.drawPileCount);
    const position = Math.max(0, Math.min(deckSize, context.insertionPosition ?? 0));
    const positionLabel = position === 0 ? "牌堆顶" : position === deckSize ? "牌堆底" : `第 ${position + 1} 张`;
    return {
      id: "defuse",
      eyebrow: `秘密操作 · ${remainingSeconds(pending?.deadline, context)} 秒`,
      title: "把危险放回哪里？",
      subtitle: `牌堆当前共 ${deckSize} 张。位置只有你知道。`,
      heroImage: "assets/cards/defuse.png",
      rows: [{
        id: "position",
        title: "插入位置",
        detail: "精确调整后再确认",
        control: {
          kind: "stepper",
          value: positionLabel,
          decrement: intent("position-down", "向牌堆顶移动", "AdjustInsertionPosition", { delta: -1 }),
          increment: intent("position-up", "向牌堆底移动", "AdjustInsertionPosition", { delta: 1 }),
        },
      }],
      actions: can(context, "InsertKitten") && promptId ? [intent("insert", "秘密放回牌堆", "InsertKitten", { promptId, position }, "cyan")] : [],
    };
  } },
  eliminated: { id: "eliminated", build: (context) => { const result = context.view.rankings.find((item) => item.playerId === context.view.viewerId); return { id: "eliminated", eyebrow: "砰！", title: "你炸毛了", subtitle: "别灰心，下一局把危险留给他们。", heroImage: "assets/cats/player.png", rows: result ? [{ id: "rank", title: "本局名次", detail: result.reason ?? "已淘汰", badge: `第 ${result.rank} 名` }] : [], actions: [nav("spectate", "继续观战", "other-turn")] }; } },
  result: { id: "result", build: (context) => { const byId = new Map(context.view.players.map((player) => [player.id, player])); const ranking = context.view.rankings.length ? [...context.view.rankings] : [{ playerId: context.view.winnerId, rank: 1 }]; const host = context.view.room.ownerId === context.view.viewerId; const voted = context.view.restartVotes.includes(context.view.viewerId); return { id: "result", eyebrow: "最后一只猫站着", title: "本局结算", subtitle: context.view.restartVotes.length ? `${context.view.restartVotes.length} 位玩家已投票再来一局` : undefined, heroImage: context.view.players.find((player) => player.id === context.view.winnerId)?.avatar ?? "assets/cats/tuan-zi.png", heroLabel: "WINNER", rows: ranking.sort((left, right) => left.rank - right.rank).map((item) => { const player = byId.get(item.playerId); return { id: item.playerId, title: player?.name ?? item.playerId, detail: rankingDetail(item.rank, item.reason), badge: `#${item.rank}`, image: player?.avatar }; }), actions: [...(!voted || host ? [intent("restart", host ? "再来一局" : "投票再来一局", host ? "RestartMatch" : "VoteRestart")] : []), intent("leave", "回到首页", "LeaveRoom", {}, "cream")], scroll: true }; } },
  tutorial: { id: "tutorial", build: (context) => tutorial(context) },
  rules: { id: "rules", build: () => ({ id: "rules", eyebrow: "original-2025@1", title: COPY.rules, subtitle: "2 - 5 人 · 共 56 张牌", rows: RULE_ROWS.map((row) => ({ ...row, action: nav(`card-${row.id}`, "详情", "card-detail") })), actions: [nav("back", "返回", "home", "ink")], scroll: true }) },
  "card-detail": { id: "card-detail", build: (context) => { const selectedRule = RULE_ROWS[context.selectedCard ?? 0]; const detail = selectedRule ? RULE_DETAILS[selectedRule.id] : undefined; if (detail) return { id: "card-detail", eyebrow: detail.eyebrow, title: detail.title, subtitle: detail.subtitle, ...(detail.image ? { heroImage: detail.image } : {}), rows: detail.rows, actions: [nav("back", "返回图鉴", "rules", "cream")], scroll: true }; const card = cardForRule(selectedRule?.id) ?? CARD_CATALOG[0]!; return { id: "card-detail", eyebrow: card.type, title: card.name, subtitle: card.type === "ATTACK" ? "结束你的回合，让下一位玩家承担两个回合。可被否决，攻击债务可以继续叠加。" : "完整牌效与数字平台补充规则。", heroImage: card.image, rows: [{ id: "count", title: "基础牌组数量", badge: `${cardCount(card.type)} 张` }, { id: "nope", title: "可否决", badge: card.type === "DEFUSE" || card.type === "EXPLODING_KITTEN" ? "否" : "是" }], actions: [nav("back", "返回图鉴", "rules", "cream")], scroll: true }; } },
  history: { id: "history", build: (context) => ({ id: "history", eyebrow: "PUBLIC EVENTS", title: "行动记录", subtitle: "只展示所有玩家都能看到的信息", rows: activityTimeline(context.view, context.view.events.length).map((entry) => ({ id: `event-${entry.sequence}`, title: entry.title, detail: entry.detail, badge: activityBadge(entry.tone) })), actions: [nav("back", "返回菜单", "game-menu", "cream")], scroll: true }) },
  "game-menu": { id: "game-menu", build: (context) => ({ id: "game-menu", eyebrow: `ROOM #${context.view.room.code}`, title: "对局菜单", rows: [{ id: "history", title: "行动记录", detail: "查看本局公开行动", action: nav("history", "打开", "history") }, { id: "rules", title: COPY.rules, detail: "卡牌、组合与平台规则", action: nav("rules", "打开", "rules") }, { id: "settings", title: "声音与振动", detail: "只影响当前设备", action: nav("settings", "打开", "settings") }, { id: "network", title: "网络状态", detail: "连接与同步信息", action: nav("network", "打开", "network") }], actions: [...(can(context, "Concede") ? [intent("concede", "认输并继续观战", "Concede", {}, "red")] : []), nav("back", "返回牌桌", "game", "cream")], scroll: true }) },
  network: {
    id: "network",
    build: (context) => {
      const connectivity = context.view.connectivity.toLowerCase();
      const local = connectivity === "local";
      const online = connectivity === "online";
      const retrying = !local && !online;
      const active = context.view.players.find((player) => player.id === context.view.game.turnPlayerId);
      const turnRow: ScreenRow = {
        id: "turn",
        title: "当前回合",
        detail: active ? `${active.name} 正在行动` : local ? "等待本机回合状态" : "等待服务端回合状态",
        badge: `第 ${context.view.game.turnNumber} 回合`,
      };

      if (local) {
        return {
          id: "network",
          eyebrow: "本地演示对局",
          title: "本地状态正常",
          subtitle: "本局由本机演示会话驱动，不连接对局服务器；当前回合和私有状态均来自本机。",
          heroLabel: "本机",
          rows: [
            { id: "state", title: "连接状态", detail: "未连接远程服务器", badge: "本地演示" },
            turnRow,
            { id: "revision", title: "状态来源", detail: "本机内存中的演示会话", badge: "本机" },
          ],
          actions: [nav("back", "返回", "game-menu", "cream")],
        };
      }

      return {
        id: "network",
        eyebrow: "服务端权威对局",
        title: retrying ? "正在恢复当前牌桌…" : "连接稳定",
        subtitle: retrying
          ? "对局仍由服务器继续处理。重连后会同步当前回合与你的最新私有状态，不会代你自动出牌。"
          : "当前已与服务器同步；倒计时和行动结果以服务端为准。",
        heroLabel: retrying ? "正在同步" : "已连接",
        rows: [
          { id: "state", title: "连接状态", detail: retrying ? "网络恢复后会自动同步" : "可正常继续对局", badge: retrying ? "离线，等待重连" : "在线" },
          turnRow,
          { id: "revision", title: "恢复方式", detail: "同步完整私有快照", badge: "安全" },
        ],
        actions: retrying ? [intent("retry", "立即重试", "Reconnect")] : [nav("back", "返回", "game-menu", "cream")],
      };
    },
  },
  settings: { id: "settings", build: (context) => ({
    id: "settings",
    eyebrow: "THIS DEVICE",
    title: "声音与振动",
    rows: [
      {
        id: "sound",
        title: "游戏声音",
        detail: "卡牌与危险提示音",
        control: {
          kind: "toggle",
          checked: context.settings?.sound !== false,
          action: intent("toggle-sound", "切换游戏声音", "ToggleSound"),
        },
      },
      {
        id: "vibration",
        title: "触感反馈",
        detail: "出牌与危险提示",
        control: {
          kind: "toggle",
          checked: context.settings?.vibration !== false,
          action: intent("toggle-vibration", "切换触感反馈", "ToggleVibration"),
        },
      },
      { id: "privacy", title: "隐私说明", detail: "仅保存会话恢复所需信息" },
    ],
    actions: [nav("back", "完成", "home", "cream")],
  }) },
};

function table(context: SceneContext, myTurn: boolean): ScreenModel {
  const discard = context.view.game.discard ?? CARD_CATALOG[3];
  const cards = selectedCards(context);
  const needsTarget = selectionNeedsTarget(cards);
  const exactSelectionIsLegal = selectionIsLegal(context, cards);
  const playAction = exactSelectionIsLegal && cards.length > 0
    ? needsTarget
      ? nav("target", cards.length === 3 ? "选择目标并声明牌型" : "选择目标玩家", "favor", "cyan")
      : intent("play", "打出所选牌", "PlayCards", { turnId: context.view.game.turnId }, "cyan")
    : null;
  const drawAction = myTurn && can(context, "Draw") && context.view.game.turnId
    ? intent("draw", "抽一张", "Draw", { turnId: context.view.game.turnId })
    : undefined;
  const tutorialHint = context.view.room.tutorial ? activeTutorialHint(context, myTurn) : null;
  const feedback = latestActivity(context.view);
  return {
    id: myTurn ? "game" : "other-turn", eyebrow: `第 ${context.view.game.turnNumber} 回合 · ${context.view.game.direction} · ${remainingSeconds(context.view.game.deadline, context)} 秒`,
    title: myTurn ? (context.view.game.turnsOwed > 1 ? `你还欠 ${context.view.game.turnsOwed} 个回合` : "轮到你了") : "等待其他玩家行动",
    table: {
      turn: context.view.game.turnNumber,
      direction: context.view.game.direction,
      deckCount: context.view.game.drawPileCount,
      discard,
      hand: context.view.hand,
      players: context.view.players,
      myTurn,
      turnsOwed: context.view.game.turnsOwed,
      drawAction,
      ...(feedback ? { feedback: { title: feedback.title, detail: feedback.detail, tone: feedback.tone } } : {}),
    },
    rows: tutorialHint ? [tutorialHint] : undefined,
    actions: playAction ? [playAction] : [],
  };
}

function rankingDetail(rank: number, reason?: string): string {
  if (rank === 1) return "获胜";
  if (reason === "EXPLOSION") return "危险猫淘汰";
  if (reason === "CONCEDE") return "已认输";
  return "已淘汰";
}

const TUTORIAL_STEPS = [
  { title: "先出牌，再抽牌", detail: "你可以连续打出手牌，也可以什么都不出。抽牌会结束当前欠回合。", image: "assets/cards/skip.png" },
  { title: "别抽到危险猫", detail: "抽到危险猫会立刻出局，除非你手里有一张拆弹。", image: "assets/cards/attack.png" },
  { title: "最后一只猫获胜", detail: "观察牌堆、打乱计划、把危险留给下家。活到最后！", image: "assets/cats/player.png" },
] as const;

function tutorial(context: SceneContext): ScreenModel {
  const step = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, context.tutorialStep ?? 0));
  const current = TUTORIAL_STEPS[step]!;
  const last = step === TUTORIAL_STEPS.length - 1;
  return {
    id: "tutorial",
    eyebrow: `${step + 1} / ${TUTORIAL_STEPS.length}`,
    title: COPY.tutorial,
    subtitle: current.detail,
    heroImage: current.image,
    heroLabel: `STEP ${step + 1}`,
    rows: [{ id: `tutorial-${step + 1}`, title: current.title, detail: "● ".repeat(step + 1) + "○ ".repeat(TUTORIAL_STEPS.length - step - 1) }],
    actions: last
      ? [intent("start", "我会了，开教学局！", "StartTutorial"), nav("back", "返回", "home", "ink")]
      : [intent("next", "下一步", "NextTutorialStep"), nav("back", "返回", "home", "ink")],
  };
}

function activeTutorialHint(context: SceneContext, myTurn: boolean): ScreenRow {
  // Every authoritative match starts with MATCH_STARTED (1) and TURN_STARTED
  // (2). Deriving progress from later domain-event sequences survives host
  // recreation, reconnects and full-snapshot replacement without local state.
  const eventsSinceStart = context.view.events.filter((event) => event.sequence > 2).length;
  if (!myTurn) return { id: "tutorial-hint", title: "教学局 · 观察 Bot", detail: "对手会自动行动；轮到你时再选择出牌或抽牌。", badge: "练习" };
  if (eventsSinceStart === 0) return { id: "tutorial-hint", title: "第 1 步 · 试着出牌", detail: "点击手牌中的跳过、攻击或预见未来；也可以直接抽牌结束回合。", badge: "提示" };
  if (eventsSinceStart < 4) return { id: "tutorial-hint", title: "第 2 步 · 留意响应", detail: "行动牌会开启否决窗口。没有要回应时选择放行，继续观察结果。", badge: "提示" };
  return { id: "tutorial-hint", title: "第 3 步 · 活到最后", detail: "控制牌堆、保留拆弹并让 Bot 先遇到危险猫。", badge: "目标" };
}

function remainingSeconds(deadline: unknown, context: SceneContext): number {
  const value = Number(deadline);
  if (!Number.isFinite(value)) return 0;
  const now = context.now ?? Date.now();
  return Math.max(0, Math.ceil((value - now) / 1_000));
}

function cardName(type: string): string {
  return CARD_CATALOG.find((card) => card.type === type)?.name ?? type;
}

function cardForRule(id: string | undefined) {
  const typeByRule: Readonly<Record<string, string>> = {
    danger: "EXPLODING_KITTEN", defuse: "DEFUSE", nope: "NOPE", attack: "ATTACK",
    favor: "FAVOR", shuffle: "SHUFFLE", skip: "SKIP", future: "SEE_FUTURE",
  };
  return CARD_CATALOG.find((card) => card.type === typeByRule[id ?? ""]);
}

function cardCount(type: string): number {
  return type === "EXPLODING_KITTEN" || ["ATTACK", "FAVOR", "SHUFFLE", "SKIP"].includes(type) ? 4
    : type === "DEFUSE" ? 6 : type === "NOPE" || type === "SEE_FUTURE" ? 5 : 4;
}

function activityBadge(tone: "neutral" | "action" | "danger" | "success"): string {
  if (tone === "danger") return "危险";
  if (tone === "success") return "生效";
  if (tone === "action") return "行动";
  return "公开";
}

function selectionIsLegal(context: SceneContext, cards: readonly { type: string }[]): boolean {
  return cards.length > 0 && legalSelectionKind(context.view, selectedCards(context).map((card) => card.token)) === "exact";
}

export const SCENE_REGISTRY: Readonly<Record<ScreenId, SceneDefinition>> = screens;
export const ALL_SCREEN_IDS: readonly ScreenId[] = Object.freeze(Object.keys(screens) as ScreenId[]);

export function buildScreen(id: ScreenId, context: SceneContext): ScreenModel {
  return SCENE_REGISTRY[id].build(context);
}

export function deriveScreen(context: SceneContext): ScreenId {
  return deriveScene(context.view, {
    connectivity: normalizeConnectivity(context.view.connectivity),
    selectedCards: selectedCards(context),
    spectating: context.spectating,
  });
}

function normalizeConnectivity(value: string | undefined): "local" | "connecting" | "online" | "offline" {
  const normalized = value?.toLowerCase();
  return normalized === "online" || normalized === "offline" || normalized === "local" ? normalized : "connecting";
}
