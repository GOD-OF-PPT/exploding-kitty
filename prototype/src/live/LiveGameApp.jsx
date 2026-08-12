import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Copy,
  Gear,
  Info,
  Lock,
  Minus,
  Plus,
  ShareNetwork,
  SpeakerHigh,
  SpeakerSlash,
  UserPlus,
  UsersThree,
  Warning,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import { useDeadline, useLiveSession } from "./useLiveSession.js";
import {
  BASE_CARDS,
  CARD_TYPE_OPTIONS,
  buildPlayCommand,
  cardDefinition,
  deriveScene,
  eligibleTargets,
  eventCopyForView,
  hasLegalAction,
  selectedCardsAreCompatible,
} from "./viewModel.js";
import "./live.css";

const fallbackAvatars = [
  "/assets/cats/player.png",
  "/assets/cats/a-ju.png",
  "/assets/cats/xiao-hui.png",
  "/assets/cats/tuan-zi.png",
];

function command(type, payload = {}) {
  return { type, ...payload };
}

function actionType(action) {
  return action?.type || "";
}

function sends(send, commandValue, setError) {
  return async () => {
    try {
      await send(commandValue);
    } catch (error) {
      setError?.(error?.message || "操作没有成功，请重试");
    }
  };
}

function ComicButton({ children, tone = "yellow", className = "", onClick, disabled, icon }) {
  return <button className={`comic-button comic-button--${tone} ${className}`} onClick={onClick} disabled={disabled}>{icon}{children}</button>;
}

function ScreenHeader({ title, eyebrow, onBack, right }) {
  return (
    <header className="screen-header">
      <button className="icon-button" onClick={onBack} aria-label="返回"><ArrowLeft size={22} weight="bold" /></button>
      <div className="screen-header__title">{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1></div>
      {right || <span className="icon-button icon-button--ghost" />}
    </header>
  );
}

function PlayerAvatar({ player, active, compact = false, size, showName = true, showCount = true }) {
  const avatarSize = size || (compact ? "sm" : "md");
  return (
    <div className={`cat-avatar cat-avatar--${avatarSize} ${active ? "is-active" : ""} ${!player.connected ? "is-offline" : ""}`}>
      <div className="cat-avatar__portrait"><img src={player.avatar || fallbackAvatars[0]} alt="" /></div>
      {showName && <span className="cat-avatar__name">{player.name}{player.bot ? " · BOT" : ""}</span>}
      {showCount && player.handCount !== undefined && <span className="cat-avatar__count">{player.handCount}</span>}
    </div>
  );
}

function ErrorToast({ error, onClose }) {
  if (!error) return null;
  return <div className="toast live-error"><Warning size={18} weight="fill" />{error}<button onClick={onClose}><X size={16} /></button></div>;
}

function LoginView({ send, pending, setError }) {
  return (
    <section className="screen screen--login">
      <div className="login-logo"><span>炸毛</span><strong>危机</strong><small>原创回合制卡牌游戏</small></div>
      <div className="login-cast"><img src="/assets/cat-cast.png" alt="四只原创猫咪角色" /></div>
      <div className="login-burst">今晚<br />谁先炸？</div>
      <div className="login-actions">
        <ComicButton disabled={Boolean(pending)} onClick={sends(send, command("Login", { provider: "wechat" }), setError)}>{pending ? "正在进入…" : "微信一键进入"}</ComicButton>
        <p>登录即表示同意《用户协议》与《隐私政策》</p>
      </div>
      <div className="loading-scratch"><i className={pending ? "active" : ""} /></div>
    </section>
  );
}

function HomeView({ view, openOverlay }) {
  return (
    <section className="screen screen--home">
      <div className="home-tools"><button className="icon-button" onClick={() => openOverlay("settings")}><Gear size={22} weight="fill" /></button></div>
      <div className="home-hero">
        <span className="kicker">危险！毛茸茸！还会爆！</span>
        <h1><span>炸毛</span><strong>危机</strong></h1>
        <div className="home-cat"><img src={view.user.avatar || fallbackAvatars[0]} alt="你的原创猫咪角色" /></div>
        <div className="boom-word">BOOM!</div>
      </div>
      <div className="home-actions">
        <ComicButton onClick={() => openOverlay("play-mode")} icon={<Plus size={24} weight="bold" />}>开一局</ComicButton>
        <ComicButton tone="cream" onClick={() => openOverlay("join")} icon={<UserPlus size={23} weight="bold" />}>加入房间</ComicButton>
        <div className="secondary-actions"><button onClick={() => openOverlay("tutorial")}><BookOpen size={20} weight="fill" />新手教学</button><button onClick={() => openOverlay("rules")}><Info size={20} weight="fill" />规则图鉴</button></div>
      </div>
      <p className="version-tag">原创美术概念 · ORIGINAL-2025@1</p>
    </section>
  );
}

function PlayModeView({ openOverlay, onBack }) {
  return (
    <section className="screen">
      <ScreenHeader title="开一局" eyebrow="选择你的混乱方式" onBack={onBack} />
      <div className="mode-hero"><img src={fallbackAvatars[0]} alt="" /><span>召集猫友！</span></div>
      <div className="mode-options">
        <button onClick={() => openOverlay("create")}><i>＋</i><span><strong>创建房间</strong><small>设置人数与节奏，邀请好友</small></span><CaretRight size={22} weight="bold" /></button>
        <button onClick={() => openOverlay("join")}><i>#</i><span><strong>加入房间</strong><small>输入好友分享的 6 位房间码</small></span><CaretRight size={22} weight="bold" /></button>
      </div>
      <div className="mode-tip"><Info size={18} weight="fill" />首版支持 2–5 人邀请码私房</div>
    </section>
  );
}

function CreateRoomView({ send, onBack, setError }) {
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [turnSeconds, setTurnSeconds] = useState(45);
  const [allowBots, setAllowBots] = useState(true);
  return (
    <section className="screen">
      <ScreenHeader title="创建房间" eyebrow="PRIVATE ROOM" onBack={onBack} />
      <div className="form-stack">
        <div className="paper-panel"><div className="field-label"><UsersThree size={19} weight="fill" />玩家人数</div><div className="stepper"><button onClick={() => setMaxPlayers(Math.max(2, maxPlayers - 1))}><Minus size={20} /></button><strong>{maxPlayers}<small>人</small></strong><button onClick={() => setMaxPlayers(Math.min(5, maxPlayers + 1))}><Plus size={20} /></button></div></div>
        <div className="paper-panel"><div className="field-label"><ClockCounterClockwise size={19} weight="fill" />行动计时</div><div className="segmented">{[[30, "快速"], [45, "轻松"], [0, "不限时"]].map(([value, label]) => <button key={value} className={turnSeconds === value ? "active" : ""} onClick={() => setTurnSeconds(value)}>{label}</button>)}</div><p className="field-help">否决窗口固定 5 秒，私密选择 15 秒</p></div>
        <button className={`toggle-row ${allowBots ? "active" : ""}`} onClick={() => setAllowBots(!allowBots)}><div><strong>允许机器人补位</strong><span>房主可在空座加入或移除 Bot</span></div><i><span /></i></button>
        <div className="ruleset-stamp"><Lock size={17} weight="fill" /><span>规则集</span><strong>基础版 2025</strong></div>
      </div>
      <ComicButton className="bottom-cta" onClick={sends(send, command("CreateRoom", { settings: { maxPlayers, turnSeconds, allowBots, rulesetVersion: "original-2025@1" } }), setError)}>创建并邀请</ComicButton>
    </section>
  );
}

function JoinRoomView({ send, onBack, setError }) {
  const [code, setCode] = useState("");
  return (
    <section className="screen">
      <ScreenHeader title="加入房间" eyebrow="JOIN THE CHAOS" onBack={onBack} />
      <div className="join-cat"><img src={fallbackAvatars[1]} alt="" /></div>
      <div className="join-copy"><h2>找到那群猫了吗？</h2><p>输入好友发来的 6 位房间码</p></div>
      <label className="code-input"><span>房间码</span><input value={code} maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="••••••" inputMode="numeric" /></label>
      <ComicButton className="bottom-cta" disabled={code.length !== 6} onClick={sends(send, command("JoinRoom", { code }), setError)}>进入房间</ComicButton>
    </section>
  );
}

function LobbyView({ view, send, openOverlay, setError }) {
  const isHost = view.room.ownerId === view.me.id || view.me.host;
  const allReady = view.players.length >= 2 && view.players.filter((player) => !player.bot).every((player) => player.ready || player.id === view.room.ownerId);
  const canStart = hasLegalAction(view, "START_MATCH", "START_GAME") || (isHost && allReady);
  const copyCode = async () => {
    try { await navigator.clipboard?.writeText(view.room.code); } catch { /* display-only environment */ }
  };
  const owner = view.players.find((player) => player.id === view.room.ownerId);
  const formattedCode = String(view.room.code || "------").replace(/(.{3})(?=.)/, "$1 ");
  const timerLabel = view.room.turnSeconds === 30 ? "快速计时" : view.room.turnSeconds === 45 ? "轻松计时" : "不限时";
  return (
    <section className="screen">
      <ScreenHeader title="等待开炸" eyebrow={`ROOM #${view.room.code || "------"}`} onBack={sends(send, command("LeaveRoom"), setError)} right={<button className="icon-button" onClick={copyCode}><ShareNetwork size={22} weight="fill" /></button>} />
      {isHost ? <div className="room-code"><span>房间码</span><strong>{formattedCode}</strong><button onClick={copyCode}><Copy size={18} />复制</button></div> : <div className="member-host"><PlayerAvatar player={owner || view.players[0]} size="sm" showName={false} showCount={false} /><span><strong>{owner?.name || "房主"}的房间</strong><small>房主正在调整规则</small></span></div>}
      <div className={`seat-grid ${isHost ? "" : "member-seats"} ${view.room.maxPlayers >= 5 ? "seat-grid--five" : ""}`}>
        {view.players.map((player) => <div key={player.id} className={`seat-card ${player.ready || player.id === view.room.ownerId ? "ready" : ""}`}><PlayerAvatar player={player} size="lg" showName={false} showCount={false} /><b>{player.id === view.me.id ? "你" : player.name}{player.id === view.room.ownerId ? " · 房主" : player.bot ? " · BOT" : ""}</b><span className={player.ready || player.id === view.room.ownerId ? "" : "waiting"}>{player.ready || player.id === view.room.ownerId ? <><Check size={14} />已准备</> : player.id === view.me.id ? "还没准备" : "等待准备"}</span>{isHost && player.bot && <button className="live-seat-action" onClick={sends(send, command("RemoveBot", { playerId: player.id }), setError)}>移除</button>}</div>)}
        {view.players.length < view.room.maxPlayers && <button className="seat-card seat-card--empty" onClick={isHost && view.room.allowBots ? sends(send, command("AddBot"), setError) : copyCode}>{isHost && view.room.allowBots ? <Plus size={32} weight="bold" /> : <UserPlus size={32} weight="bold" />}<b>{isHost && view.room.allowBots ? "加入 Bot" : "邀请好友"}</b><span>还有 {view.room.maxPlayers - view.players.length} 个座位</span></button>}
      </div>
      <div className="room-note"><span>{isHost ? `${view.room.maxPlayers} 人 · ` : ""}基础版 2025 · {timerLabel}{!isHost && view.room.allowBots ? " · 允许机器人" : ""}</span><button onClick={() => openOverlay("rules")}>查看规则</button></div>
      {isHost ? <ComicButton className="bottom-cta" tone="cyan" disabled={!canStart} onClick={sends(send, command("StartMatch"), setError)}>开始游戏</ComicButton> : <ComicButton className="bottom-cta" tone={view.me.ready ? "cream" : "yellow"} onClick={sends(send, command("SetReady", { ready: !view.me.ready }), setError)}>{view.me.ready ? "取消准备" : "我准备好了"}</ComicButton>}
    </section>
  );
}

function CardButton({ card, selected, onClick, disabled, style }) {
  return <button className={`playing-card ${selected ? "selected" : ""}`} style={style} onClick={onClick} disabled={disabled} aria-label={`${card.name}${selected ? "（已选择）" : ""}`}><img src={card.image} alt="" onError={(event) => { event.currentTarget.src = "/assets/cards/card-back.png"; }} /><span>{card.name}</span></button>;
}

function TargetPicker({ title, eyebrow, targets, selected, onSelect, onBack, onConfirm, declaredCardType, setDeclaredCardType, needsDeclaration }) {
  return (
    <section className="screen live-target-picker">
      <ScreenHeader title={title} eyebrow={eyebrow} onBack={onBack} />
      <div className="prompt-illustration"><img src="/assets/cards/peek.png" alt="" /></div>
      <div className="prompt-copy"><h2>谁来成为这次的目标？</h2><p>{needsDeclaration ? "选择玩家并声明一种牌" : "对方将秘密交出或失去一张牌"}</p></div>
      <div className="target-list">{targets.map((player) => <button key={player.id} onClick={() => onSelect(player.id)} className={selected === player.id ? "active" : ""}><PlayerAvatar player={player} size="sm" showName={false} /><span><b>{player.name}</b><small>{player.handCount} 张手牌</small></span>{selected === player.id ? <Check size={22} weight="bold" /> : <CaretRight size={20} />}</button>)}</div>
      {needsDeclaration && <label className="live-declaration"><span>声明牌型</span><select value={declaredCardType} onChange={(event) => setDeclaredCardType(event.target.value)}><option value="">请选择</option>{CARD_TYPE_OPTIONS.map((card) => <option value={card.type} key={card.type}>{card.name}</option>)}</select></label>}
      <ComicButton className="bottom-cta" disabled={!selected || (needsDeclaration && !declaredCardType)} onClick={onConfirm}>就选 TA</ComicButton>
    </section>
  );
}

function TableView({ view, send, openOverlay, setError, initialSelectedTokens = [] }) {
  const [selectedTokens, setSelectedTokens] = useState(initialSelectedTokens);
  const [targetId, setTargetId] = useState("");
  const [declaredCardType, setDeclaredCardType] = useState("");
  const isMyTurn = view.game.turnPlayerId === view.me.id || hasLegalAction(view, "DRAW", "PLAY_CARDS");
  const selected = view.hand.filter((card) => selectedTokens.includes(card.token));
  const deadline = useDeadline(view.game.deadline);
  const targets = eligibleTargets(view, selected);
  const needsTarget = selected.length === 2 || selected.length === 3 || (selected.length === 1 && selected[0]?.type === "FAVOR");
  const needsDeclaration = selected.length === 3;
  const validSelection = selected.length > 0 && selectedCardsAreCompatible(selected) && selected.every((card) => card.playable) && (selected.length > 1 || selected[0]?.singlePlayable) && (!needsTarget || targetId) && (!needsDeclaration || declaredCardType);
  const toggleCard = (card) => {
    if (!isMyTurn || !card.playable) return;
    setSelectedTokens((current) => {
      if (current.includes(card.token)) return current.filter((token) => token !== card.token);
      const currentCards = view.hand.filter((item) => current.includes(item.token));
      if (current.length >= 3 || (currentCards[0] && currentCards[0].type !== card.type)) return [card.token];
      return [...current, card.token];
    });
    setTargetId("");
    setDeclaredCardType("");
  };
  const play = async () => {
    try {
      await send(buildPlayCommand(selected, targetId, declaredCardType));
      setSelectedTokens([]); setTargetId(""); setDeclaredCardType("");
    } catch (error) { setError(error?.message || "这组牌现在不能打出"); }
  };
  if (selected.length > 0 && needsTarget) {
    return <TargetPicker title="选择目标" eyebrow={selected[0]?.type === "FAVOR" ? "帮忙 · FAVOR" : selected.length === 3 ? "三张同名组合" : "两张同名组合"} targets={targets} selected={targetId} onSelect={setTargetId} onBack={() => { setSelectedTokens([]); setTargetId(""); setDeclaredCardType(""); }} onConfirm={play} declaredCardType={declaredCardType} setDeclaredCardType={setDeclaredCardType} needsDeclaration={needsDeclaration} />;
  }
  const activePlayer = view.players.find((player) => player.id === view.game.turnPlayerId);
  const discard = view.game.discardTop.type === "UNKNOWN" ? null : view.game.discardTop;
  return (
    <section className="screen screen--game live-table">
      <div className="game-topbar game-topbar--menu"><div className="game-topbar__actions" role="group" aria-label="牌桌工具"><button onClick={() => openOverlay("menu")} aria-label="对局菜单"><Gear size={20} weight="fill" /></button><button onClick={() => openOverlay("history")} aria-label="行动记录"><ClockCounterClockwise size={20} /></button></div><span>第 {view.game.turnNumber} 回合 · {view.game.direction === "COUNTER_CLOCKWISE" ? "逆时针" : "顺时针"}{deadline != null ? ` · ${deadline}s` : ""}</span><button onClick={() => openOverlay("rules")} aria-label="规则图鉴"><BookOpen size={20} /></button></div>
      {(() => { const opponents = view.players.filter((player) => player.id !== view.me.id && player.alive); return <div className={`opponents opponents--${opponents.length}`}>{opponents.map((player) => <PlayerAvatar key={player.id} player={player} active={player.id === view.game.turnPlayerId} />)}</div>; })()}
      <div className="table-zone"><div className="turn-banner">{isMyTurn ? (view.game.turnsOwed > 1 ? `你还欠 ${view.game.turnsOwed} 个回合！` : "轮到你了") : `等待 ${activePlayer?.name || "其他玩家"} 行动…`}</div><div className="piles"><button className="pile pile--draw" disabled={!isMyTurn || !hasLegalAction(view, "DRAW")} onClick={sends(send, command("Draw", { turnId: view.game.turnId }), setError)}><div className="pile-card"><img src="/assets/cards/card-back.png" alt="牌背" /></div><strong>牌堆 <b>{view.game.drawPileCount}</b></strong></button><div className="pile pile--discard"><div className="pile-card">{discard ? <img src={discard.image} alt="" /> : null}</div><strong>弃牌堆</strong></div></div><button className="draw-burst" disabled={!isMyTurn || !hasLegalAction(view, "DRAW")} onClick={sends(send, command("Draw", { turnId: view.game.turnId }), setError)}>{!isMyTurn ? "现在不是你的回合" : view.game.turnsOwed > 1 ? "抽牌 · 完成 1 回合" : "抽一张"}</button></div>
      {isMyTurn && view.game.turnsOwed > 1 && <div className="debt-stamp"><b>{view.game.turnsOwed}×</b><span>跳过仅减少 1<br />再攻击会继续叠加</span></div>}
      <div className="hand-zone"><div className="hand-label"><span>{view.eliminated ? "已淘汰 · 仅公开信息" : "你的手牌"}</span><b>{view.hand.length}</b></div><div className="hand-cards">{view.eliminated ? <div className="live-spectator-note"><Lock size={18} />手牌已移入淘汰区</div> : view.hand.map((card, index) => {
        const center = (view.hand.length - 1) / 2;
        const spread = Math.min(48, 230 / Math.max(1, view.hand.length - 1));
        const angleStep = Math.min(4, 28 / Math.max(1, view.hand.length - 1));
        return <button className={`playing-card ${selectedTokens.includes(card.token) ? "selected" : ""}`} style={{ "--i": index, "--center": center, "--spread": `${spread}px`, "--angle-step": `${angleStep}deg` }} key={card.token} onClick={() => toggleCard(card)} disabled={!isMyTurn || !card.playable || (!card.singlePlayable && view.hand.filter((held) => held.type === card.type).length < 2)} aria-label={`${card.name}${selectedTokens.includes(card.token) ? "（已选择）" : ""}`}><img src={card.image} alt="" onError={(event) => { event.currentTarget.src = "/assets/cards/card-back.png"; }} /><span>{card.name}</span></button>;
      })}</div></div>
      {selected.length > 0 && <div className="play-dock live-play-dock"><button onClick={() => setSelectedTokens([])}><X size={20} /></button><div className="live-play-controls"><ComicButton onClick={play} disabled={!validSelection}>{selected.length === 1 ? "打出这张牌" : `打出 ${selected.length} 张组合`}</ComicButton></div></div>}
      {!isMyTurn && !view.pending && <div className="waiting-ribbon"><ClockCounterClockwise size={18} /><span>{activePlayer?.name || "其他玩家"}{deadline != null ? <>还有 <b>{deadline} 秒</b></> : "正在行动"}</span></div>}
      {!isMyTurn && !view.pending && view.hand.some((card) => card.type === "NOPE") && <div className="live-nope-ready">手里有否决 · 响应窗开启时可用</div>}
    </section>
  );
}

function ResponsePrompt({ view, send, setError }) {
  const pending = view.pending;
  const liveDeadline = useDeadline(pending?.deadline);
  const deadline = pending?.deadlineDisplay ?? liveDeadline;
  const nopeCount = Number(pending?.nopeCount || pending?.chainLength || 0);
  const canNope = hasLegalAction(view, "PLAY_NOPE", "NOPE") || pending?.canNope;
  const canPass = hasLegalAction(view, "PASS_RESPONSE", "PASS") || pending?.canPass === true;
  const passed = pending?.viewerPassed === true;
  const activePlayer = view.players.find((player) => player.id === view.game.turnPlayerId);
  const discard = view.game.discardTop.type === "UNKNOWN" ? null : view.game.discardTop;
  return (
    <section className="screen screen--game screen--dimmed live-response-screen">
      <div className="game-topbar"><span>{pending?.actionName || cardDefinition(pending?.cardType).name || "有人打出了一张牌"}</span></div>
      <div className="opponents">{view.players.filter((player) => player.id !== view.me.id && player.alive).map((player) => <PlayerAvatar key={player.id} player={player} active={player.id === view.game.turnPlayerId} />)}</div>
      <div className="table-zone"><div className="turn-banner">等待 {activePlayer?.name || "其他玩家"} 的动作结算</div><div className="piles"><div className="pile pile--draw"><div className="pile-card"><img src="/assets/cards/card-back.png" alt="牌背" /></div><strong>牌堆 <b>{view.game.drawPileCount}</b></strong></div><div className="pile pile--discard"><div className="pile-card">{discard ? <img src={discard.image} alt="" /> : null}</div><strong>弃牌堆</strong></div></div><button className="draw-burst" disabled>等待响应</button></div>
      <div className="hand-zone"><div className="hand-label"><span>你的手牌</span><b>{view.hand.length}</b></div><div className="hand-cards">{view.hand.slice(0, 6).map((card, index, visible) => <CardButton key={card.token} card={card} disabled style={{ "--i": index, "--center": (visible.length - 1) / 2, "--spread": "48px", "--angle-step": "4deg" }} />)}</div></div>
      <div className="response-sheet"><button className="close-sheet" aria-label="放弃响应" disabled={!canPass || passed} onClick={sends(send, command("PassResponse", { windowId: pending?.id }), setError)}><X size={20} /></button><div className="response-cat"><img src={(view.players.find((player) => player.id === pending?.playerId) || view.players[1] || view.me).avatar} alt="" /></div>
      <span className="response-kicker">所有存活玩家都可以响应</span><h2>有人要<span>否决</span>吗？</h2>
      <div className="countdown"><strong>{passed ? "✓" : deadline ?? "…"}</strong><span>{passed ? "已放弃" : "秒"}</span></div><p>否决链 {nopeCount} 张 · 每张新否决都会开启新窗口</p>
      {passed ? <p>等待其他玩家…</p> : <div className="response-actions"><ComicButton tone="red" disabled={!canNope} onClick={sends(send, command("PlayNope", { windowId: pending?.id }), setError)}>打出否决</ComicButton><button disabled={!canPass} onClick={sends(send, command("PassResponse", { windowId: pending?.id }), setError)}>放弃响应</button></div>}
      </div>
    </section>
  );
}

function ExplosionPrompt({ view, send, setError }) {
  const canDefuse = hasLegalAction(view, "USE_DEFUSE", "DEFUSE");
  return <section className="screen screen--explosion"><div className="explosion-word">砰！</div><div className="explosion-card"><img src="/assets/cards/danger.png" alt="原创危险猫牌" /></div><div className="explosion-copy"><span>你抽到了危险牌</span><h1>要炸了！</h1><p>{canDefuse ? "幸好手里还有一张拆弹。" : "手里没有拆弹，你将被淘汰。"}</p></div><div className="explosion-actions">{canDefuse ? <ComicButton onClick={sends(send, command("UseDefuse", { promptId: view.pending?.id }), setError)}>立即拆弹</ComicButton> : <span>即将进入淘汰结算…</span>}</div></section>;
}

function DefusePrompt({ view, send, setError }) {
  const max = Math.max(0, Number(view.pending?.deckSize ?? view.game.drawPileCount));
  const [position, setPosition] = useState(Math.floor(max / 2));
  const liveDeadline = useDeadline(view.pending?.deadline);
  const deadline = view.pending?.deadlineDisplay ?? liveDeadline;
  const cardCount = Math.min(9, Math.max(3, max + 1));
  const visualPosition = Math.round((Math.min(position, max) / Math.max(1, max)) * (cardCount - 1));
  return <section className="screen screen--danger live-private-screen"><ScreenHeader title="拆弹成功！" eyebrow={`活下来了 · 还剩 ${deadline == null ? 15 : deadline} 秒`} onBack={() => {}} /><div className="defuse-hero"><img src="/assets/cards/defuse.png" alt="" /><span>呼——</span></div><div className="prompt-copy"><h2>偷偷放回牌堆</h2><p>只有你知道危险猫的新位置</p></div><div className="deck-position"><div className="deck-stack-mini">{Array.from({ length: cardCount }, (_, index) => <i key={index} className={index === visualPosition ? "danger-card" : ""} />)}</div><input type="range" min="0" max={max} value={Math.min(position, max)} onChange={(event) => setPosition(Number(event.target.value))} /><div><span>最上面</span><strong>第 {Math.min(position, max) + 1} 张</strong><span>最下面</span></div></div><ComicButton className="bottom-cta" onClick={sends(send, command("Choose", { promptId: view.pending?.id, value: { position: Math.min(position, max) } }), setError)}>神不知，猫不觉</ComicButton></section>;
}

function GiveCardPrompt({ view, send, setError }) {
  const [token, setToken] = useState(view.hand[0]?.token || "");
  const liveDeadline = useDeadline(view.pending?.deadline);
  const deadline = view.pending?.deadlineDisplay ?? liveDeadline;
  const requester = view.players.find((player) => player.id === view.pending?.requesterId) || view.players.find((player) => player.id !== view.me.id) || view.me;
  const selectedCard = view.hand.find((card) => card.token === token);
  return <section className="screen live-private-screen"><ScreenHeader title="交出一张牌" eyebrow={`${view.pending?.requesterName || requester.name}请求你帮忙`} onBack={() => {}} /><div className="give-request"><PlayerAvatar player={requester} size="lg" showName={false} /><div><span>还剩 {deadline ?? 15} 秒</span><h2>选一张交给{view.pending?.requesterName || requester.name}</h2><p>只有你和对方会看到牌面</p></div></div><div className="private-hand-grid">{view.hand.map((card) => <CardButton key={card.token} card={card} selected={token === card.token} onClick={() => setToken(card.token)} />)}</div><div className="privacy-note"><Lock size={18} weight="fill" />超时后服务器会随机选择一张</div><ComicButton className="bottom-cta" disabled={!token} onClick={sends(send, command("Choose", { promptId: view.pending?.id, value: { cardToken: token } }), setError)}>交出「{selectedCard?.name || "这张牌"}」</ComicButton></section>;
}

function WaitingPrivatePrompt({ view }) {
  const liveDeadline = useDeadline(view.pending?.deadline);
  const deadline = view.pending?.deadlineDisplay ?? liveDeadline;
  const player = view.players.find((item) => item.id === view.pending?.playerId);
  return <section className="screen screen--network live-waiting-private"><Lock size={44} weight="fill" /><span className="response-kicker">私密选择不会公开</span><h1>等待{player?.name || "另一位玩家"}…</h1><p>对方正在完成私密操作{deadline == null ? "" : `，还剩 ${deadline} 秒`}。</p><div className="sync-progress"><i /></div></section>;
}

function FuturePrompt({ view, send, setError }) {
  const cards = (view.pending?.cards || view.pending?.peek || []).map((card, index) => ({ ...cardDefinition(card.type || card), ...(typeof card === "object" ? card : {}), key: card.token || index }));
  return <section className="screen live-private-screen"><ScreenHeader title="预见未来" eyebrow="嘘——只有你能看到" onBack={() => {}} /><div className="future-eye"><img src="/assets/cards/peek.png" alt="" /></div><div className="future-stack">{cards.map((card, index) => <div className="future-row" key={card.key}><b>{index + 1}</b><img src={card.image} alt="" /><span><strong>{card.name}</strong><small>{index === 0 ? "下一张" : `再过 ${index} 张`}</small></span></div>)}</div><div className="privacy-note"><Lock size={18} weight="fill" />顺序不会改变，其他人看不到</div><ComicButton className="bottom-cta" onClick={sends(send, command("Choose", { promptId: view.pending?.id, value: { acknowledged: true } }), setError)}>记住了</ComicButton></section>;
}

function PendingLayer({ view, send, setError }) {
  if (!view.pending) return null;
  const content = {
    RESPONSE: <ResponsePrompt view={view} send={send} setError={setError} />,
    EXPLOSION: <ExplosionPrompt view={view} send={send} setError={setError} />,
    DEFUSE_INSERTION: <DefusePrompt view={view} send={send} setError={setError} />,
    GIVE_CARD: <GiveCardPrompt view={view} send={send} setError={setError} />,
    PRIVATE_PEEK: <FuturePrompt view={view} send={send} setError={setError} />,
    WAITING_PRIVATE_CHOICE: <WaitingPrivatePrompt view={view} />,
  }[view.pending.kind];
  if (content) return <div className="live-fullscreen-layer">{content}</div>;
  return <div className="live-modal-backdrop"><div className="live-modal"><h2>等待你的选择</h2><p>{view.pending.copy || "请完成当前操作后继续。"}</p></div></div>;
}

function HistoryView({ view, onBack }) {
  const events = view.events.slice(-50).reverse();
  return <section className="screen screen--scroll"><ScreenHeader title="行动记录" eyebrow={`第 ${view.game.turnNumber} 回合`} onBack={onBack} />{events.length ? <div className="history-list">{events.map((event, index) => <div key={event.id || index} className={event.private ? "private" : ""}><i /><span><small>{event.time || event.sequence || `#${view.events.length - index}`}</small><strong>{eventCopyForView(event, view.players)}</strong>{event.private && <em><Lock size={12} />仅你可见</em>}</span></div>)}</div> : <div className="live-empty-state"><ClockCounterClockwise size={38} /><h2>还没有行动记录</h2><p>第一张牌打出后，公开事件会出现在这里。</p></div>}<div className="history-tip"><Info size={18} weight="fill" />私密手牌和牌堆顺序不会公开</div></section>;
}

function RulesView({ view, onBack }) {
  const [tab, setTab] = useState("cards");
  const [selectedCard, setSelectedCard] = useState(null);
  if (selectedCard) return <CardDetailView card={selectedCard} onBack={() => setSelectedCard(null)} />;
  return <section className="screen screen--scroll"><ScreenHeader title="规则图鉴" eyebrow={(view?.room.rulesetVersion || "original-2025@1").toUpperCase()} onBack={onBack} /><div className="tabs tabs--four"><button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>卡牌</button><button className={tab === "combos" ? "active" : ""} onClick={() => setTab("combos")}>组合技</button><button className={tab === "flow" ? "active" : ""} onClick={() => setTab("flow")}>回合流程</button><button className={tab === "platform" ? "active" : ""} onClick={() => setTab("platform")}>平台</button></div>{tab === "cards" && <div className="card-library">{BASE_CARDS.map((card) => <button className="live-rule-card" key={card.type} onClick={() => setSelectedCard(card)}><img src={card.image} alt="" onError={(event) => { event.currentTarget.src = "/assets/cards/card-back.png"; }} /><span><b>{card.name} ×{card.count}</b><small>{card.copy}</small></span><CaretRight size={19} /></button>)}</div>}{tab === "combos" && <div className="rule-articles"><article><span>2×</span><h2>两张同名牌</h2><p>忽略牌面效果，指定有手牌的玩家，服务器随机偷 1 张。</p></article><article><span>3×</span><h2>三张同名牌</h2><p>指定玩家并声明牌型；命中则交出 1 张，也可能落空。</p></article><div className="rule-warning"><Info size={20} weight="fill" />五种猫咪牌各 4 张；组合必须同名。基础版没有“五张不同牌”组合。</div></div>}{tab === "flow" && <div className="flow-list"><div><b>1</b><span><strong>打牌或跳过</strong><small>可以连续打牌，也可以什么都不出</small></span></div><div><b>2</b><span><strong>等待否决响应</strong><small>动作结算前所有存活玩家都能响应</small></span></div><div><b>3</b><span><strong>抽一张牌</strong><small>抽牌后结束当前欠回合</small></span></div></div>}{tab === "platform" && <div className="rule-articles"><article><span>5s</span><h2>否决窗口</h2><p>服务器先收到者优先；放弃后不可反悔，奇数取消、偶数生效。</p></article><article><span>15s</span><h2>私密选择</h2><p>超时后服务器用确定性随机数完成合法选择。</p></article><article><span>60s</span><h2>断线宽限</h2><p>倒计时继续；宽限结束后由 Bot 暂时代打。</p></article></div>}</section>;
}

function CardDetailView({ card, onBack }) {
  return <section className="screen screen--scroll"><ScreenHeader title={card.name} eyebrow="卡牌详情" onBack={onBack} /><div className="detail-card"><img src={card.image} alt="" /></div><div className="detail-copy"><span>基础版 · {card.category}</span><h2>{card.copy}</h2><p>{card.details}</p></div><div className="detail-facts"><div><b>可否决</b><span>{card.nopeable ? "是" : "否"}</span></div><div><b>结束回合</b><span>{card.endsTurn ? "是" : "否"}</span></div></div><ComicButton className="bottom-cta" tone="cream" onClick={onBack}>返回图鉴</ComicButton></section>;
}

export async function completeTutorial({ reviewOnly, send, onBack }) {
  if (!reviewOnly) await send(command("StartTutorial"));
  onBack();
}

export function TutorialView({ send, onBack, setError, openOverlay, reviewOnly = false, initialStep = 0 }) {
  const [step, setStep] = useState(initialStep);
  const tutorials = [
    ["先出牌，再抽牌", "你可以连续打出手牌，也可以什么都不出。抽牌会结束当前欠回合。", "/assets/cards/skip.png"],
    ["别抽到危险猫", "抽到危险猫会立刻出局，除非你手里有一张拆弹。", "/assets/cards/attack.png"],
    ["最后一只猫获胜", "观察牌堆、打乱计划、把危险留给下家。活到最后！", fallbackAvatars[0]],
  ];
  const current = tutorials[step];
  const finish = async () => {
    try { await completeTutorial({ reviewOnly, send, onBack }); } catch (error) { setError(error?.message || "教学局暂时无法开始"); openOverlay("play-mode"); }
  };
  return <section className="screen"><ScreenHeader title={reviewOnly ? "教学复习" : "新手教学"} eyebrow={`${step + 1} / ${tutorials.length}`} onBack={onBack} /><div className="tutorial-stage"><div className="tutorial-burst"><img src={current[2]} alt="" /></div></div><div className="tutorial-copy"><span>STEP {step + 1}</span><h2>{current[0]}</h2><p>{current[1]}</p></div><div className="progress-dots">{tutorials.map((_, index) => <i className={index === step ? "active" : ""} key={index} />)}</div><ComicButton className="bottom-cta" onClick={() => step < tutorials.length - 1 ? setStep(step + 1) : finish()}>{step < tutorials.length - 1 ? "下一步" : reviewOnly ? "复习完成，返回对局" : "我会了，开教学局！"}</ComicButton></section>;
}

function SettingsView({ view, send, onBack, setError, openOverlay }) {
  const [sound, setSound] = useState(view.settings?.sound !== false);
  const [vibration, setVibration] = useState(view.settings?.vibration !== false);
  useEffect(() => { setSound(view.settings?.sound !== false); }, [view.settings?.sound]);
  useEffect(() => { setVibration(view.settings?.vibration !== false); }, [view.settings?.vibration]);
  const update = async (next, rollback) => {
    try { await send(command("UpdateSettings", next)); } catch (error) { rollback(); setError(error?.message || "设置没有保存"); }
  };
  return <section className="screen"><ScreenHeader title="设置" eyebrow="让猫安静一点" onBack={onBack} /><div className="settings-profile"><PlayerAvatar player={{ ...view.me, avatar: view.user.avatar }} size="lg" showName={false} /><div><strong>{view.user.name}</strong><span>ID {view.user.id || "—"}</span></div></div><div className="settings-list"><button aria-pressed={sound} onClick={() => { const previous = sound; const next = !sound; setSound(next); void update({ sound: next }, () => setSound(previous)); }}><span>{sound ? <SpeakerHigh size={22} weight="fill" /> : <SpeakerSlash size={22} weight="fill" />}音效</span><i className={sound ? "on" : ""}><b /></i></button><button aria-pressed={vibration} onClick={() => { const previous = vibration; const next = !vibration; setVibration(next); void update({ vibration: next }, () => setVibration(previous)); }}><span><Gear size={22} weight="fill" />震动反馈</span><i className={vibration ? "on" : ""}><b /></i></button><button onClick={() => openOverlay("tutorial")}><span><BookOpen size={22} weight="fill" />重看教学</span><CaretRight size={20} /></button><button onClick={() => openOverlay("rules")}><span><Info size={22} weight="fill" />规则与版本</span><CaretRight size={20} /></button></div><div className="legal-note">规则 {view.room.rulesetVersion || "original-2025@1"}<br />原创概念设计 · 不含官方美术</div></section>;
}

function GameMenuView({ view, send, openOverlay, onBack, setError }) {
  const [confirming, setConfirming] = useState(false);
  return <section className="screen"><ScreenHeader title="对局菜单" eyebrow={`ROOM #${view.room.code || "------"}`} onBack={onBack} /><div className="menu-cat"><img src={view.user.avatar || fallbackAvatars[0]} alt="" /></div><div className="menu-list"><button onClick={() => openOverlay("rules")}><BookOpen size={23} weight="fill" /><span><b>查看规则</b><small>卡牌、组合与平台规则</small></span><CaretRight size={20} /></button><button onClick={() => openOverlay("settings")}><Gear size={23} weight="fill" /><span><b>声音与振动</b><small>只影响当前设备</small></span><CaretRight size={20} /></button><button onClick={() => openOverlay("network")}><WifiHigh size={23} weight="fill" /><span><b>网络状态</b><small>{view.connection.latency ? `${view.connection.latency}ms` : view.connection.state}</small></span><CaretRight size={20} /></button></div>{!confirming ? <button className="danger-link" onClick={() => setConfirming(true)}>认输并离开</button> : <div className="concede-confirm"><strong>确定认输？</strong><p>你的手牌会移入淘汰区，本局无法返回。</p><div><button onClick={() => setConfirming(false)}>再想想</button><button onClick={sends(send, command("Concede"), setError)}>确认认输</button></div></div>}<ComicButton className="bottom-cta" tone="cream" onClick={onBack}>返回牌桌</ComicButton></section>;
}

function NetworkView({ view, send, onBack, setError }) {
  const connected = ["CONNECTED", "ONLINE"].includes(view.connection.state);
  const inMatch = Boolean(view.game.id);
  return <section className="screen screen--network" aria-live="polite"><div className="network-icon"><i className={connected ? "connected" : ""} /><i className={connected ? "connected" : ""} /><i className={connected ? "connected" : ""} /></div><span className="response-kicker">{inMatch ? "对局仍在服务器继续" : "正在连接游戏服务"}</span><h1>{connected ? "连接稳定" : "正在找回牌桌…"}</h1><p>{connected ? "状态已同步，你可以继续行动。" : inMatch ? "别担心，倒计时仍以服务器为准。60 秒后机器人会暂时代打。" : "正在恢复你的登录与房间状态，请稍候。"}</p><div className="sync-progress"><i className={connected ? "done" : ""} /></div><strong>{connected ? "同步完成" : `正在同步第 ${view.game.turnNumber || 1} 回合`}</strong>{connected ? <ComicButton className="bottom-cta" onClick={onBack}>回到牌桌</ComicButton> : <button className="retry-link" onClick={sends(send, command("Reconnect", { lastAckSeq: view.lastAckSeq }), setError)}>立即重试</button>}</section>;
}

function EliminatedView({ view, send, setError, onSpectate }) {
  const reason = view.elimination?.reason || view.elimination?.type || "EXPLOSION";
  const copy = reason === "CONCEDE" ? ["已认输", "你离开了本局对抗。"] : reason === "DISCONNECT" ? ["连接判负", "断线宽限结束，本局已结束。"] : ["你炸毛了", "别灰心，猫有九条命。\n下一局把危险留给他们。"];
  return <section className="screen screen--eliminated"><div className="eliminated-copy"><span>砰！</span><h1>{copy[0]}</h1><p>{copy[1].split("\n").map((line) => <span key={line}>{line}<br /></span>)}</p></div><div className="eliminated-cat"><img src={view.user.avatar || fallbackAvatars[0]} alt="" /></div><div className="placement"><small>本局名次</small><strong>{view.elimination?.rank ? `第 ${view.elimination.rank} 名` : "等待结算"}</strong><span>{view.elimination?.turnSurvived ? `存活 ${view.elimination.turnSurvived} 回合` : "仍可查看公开牌桌"}</span></div><div className="stacked-actions"><ComicButton onClick={onSpectate}>继续观战</ComicButton><button onClick={sends(send, command("LeaveRoom"), setError)}>退出房间</button></div></section>;
}

function ResultView({ view, send, setError }) {
  const ranks = (view.result?.rankings || view.result?.players || view.players).slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const winner = ranks.find((player) => player.rank === 1 || player.winner) || ranks[0];
  const isHost = view.room.ownerId === view.me.id;
  return <section className="screen screen--result"><ScreenHeader title="本局结算" eyebrow="最后一只猫站着" onBack={sends(send, command("LeaveRoom"), setError)} /><div className="winner-hero"><span>WINNER</span><img src={winner?.avatar || fallbackAvatars[3]} alt="" /><h2>{winner?.name || "最后一只猫"}</h2><p>{view.result?.summary || "成功留到最后"}</p></div><div className="rank-list">{ranks.map((player, index) => <div key={player.id || index} className={(player.rank || index + 1) === 1 ? "winner" : ""}><b>{player.rank || index + 1}</b><img src={player.avatar || fallbackAvatars[index % 4]} alt="" /><span><strong>{player.name}</strong><small>{player.reason || (player.alive ? "存活" : "炸毛")}</small></span>{player.id === view.me.id && <i>YOU</i>}</div>)}</div><div className="result-actions"><ComicButton onClick={sends(send, command(isHost ? "RestartMatch" : "VoteRestart"), setError)}>{isHost ? "再来一局" : "申请再来一局"}</ComicButton><button onClick={sends(send, command("LeaveRoom"), setError)}>回到首页</button></div></section>;
}

export function transitionOverlay({ overlay, history }, action) {
  if (action.type === "reset") return { overlay: null, history: [] };
  if (action.type === "open") return { overlay: action.overlay, history: overlay ? [...history, overlay] : history };
  if (action.type === "back") {
    const nextHistory = history.slice();
    return { overlay: nextHistory.pop() || null, history: nextHistory };
  }
  return { overlay, history };
}

export function LiveGameApp({ session, className = "", initialOverlay = null, initialSelectedTokens = [] }) {
  const { view, send, pendingCommand, commandError } = useLiveSession(session);
  const [navigation, setNavigation] = useState({ overlay: initialOverlay, history: [] });
  const [localError, setLocalError] = useState(null);
  const [spectating, setSpectating] = useState(false);
  const scene = deriveScene(view);
  const { overlay } = navigation;

  useEffect(() => {
    if (view.pending) setNavigation((current) => transitionOverlay(current, { type: "reset" }));
  }, [view.pending?.id, view.pending?.kind]);

  useEffect(() => {
    if ((overlay === "create" || overlay === "join") && view.room.id) setNavigation((current) => transitionOverlay(current, { type: "reset" }));
  }, [overlay, view.room.id]);

  useEffect(() => {
    if (!view.eliminated) setSpectating(false);
  }, [view.game.id, view.eliminated]);

  useEffect(() => {
    const deadline = view.pending?.deadline ?? view.game.deadline;
    const at = typeof deadline === "number" ? deadline : Date.parse(deadline);
    if (!Number.isFinite(at) || at >= Number.MAX_SAFE_INTEGER) return undefined;
    const delay = Math.max(0, at - Date.now());
    const timer = window.setTimeout(() => {
      void send(command("DeadlineElapsed", { deadlineId: view.pending?.deadlineId || view.game.deadlineId }));
    }, delay + 20);
    return () => window.clearTimeout(timer);
  }, [send, view.pending?.deadline, view.pending?.deadlineId, view.game.deadline, view.game.deadlineId]);

  const openOverlay = (next) => {
    setNavigation((current) => transitionOverlay(current, { type: "open", overlay: next }));
  };
  const closeOverlay = () => {
    setNavigation((current) => transitionOverlay(current, { type: "back" }));
  };
  const common = { view, send, setError: setLocalError };
  let content;
  if (overlay === "play-mode") content = <PlayModeView openOverlay={openOverlay} onBack={closeOverlay} />;
  else if (overlay === "create") content = <CreateRoomView {...common} onBack={closeOverlay} />;
  else if (overlay === "join") content = <JoinRoomView {...common} onBack={closeOverlay} />;
  else if (overlay === "history") content = <HistoryView view={view} onBack={closeOverlay} />;
  else if (overlay === "rules") content = <RulesView view={view} onBack={closeOverlay} />;
  else if (overlay === "tutorial") content = <TutorialView {...common} openOverlay={openOverlay} onBack={closeOverlay} reviewOnly={Boolean(view.game.id)} />;
  else if (overlay === "settings") content = <SettingsView {...common} openOverlay={openOverlay} onBack={closeOverlay} />;
  else if (overlay === "menu") content = <GameMenuView {...common} openOverlay={openOverlay} onBack={closeOverlay} />;
  else if (overlay === "network") content = <NetworkView {...common} onBack={closeOverlay} />;
  else if (overlay === "response") content = <TableView {...common} openOverlay={openOverlay} initialSelectedTokens={initialSelectedTokens} />;
  else if (scene === "login") content = <LoginView {...common} pending={pendingCommand} />;
  else if (scene === "home") content = <HomeView {...common} openOverlay={openOverlay} />;
  else if (scene === "lobby") content = <LobbyView {...common} openOverlay={openOverlay} />;
  else if (scene === "network") content = <NetworkView {...common} onBack={() => {}} />;
  else if (scene === "result") content = <ResultView {...common} />;
  else if (scene === "eliminated" && !spectating) content = <EliminatedView {...common} onSpectate={() => setSpectating(true)} />;
  else content = <TableView {...common} openOverlay={openOverlay} initialSelectedTokens={initialSelectedTokens} />;

  return (
    <div className={`live-game-app ${className}`}>
      <div className="mobile-prototype">{content}<PendingLayer key={view.pending?.id || "none"} view={view} send={send} setError={setLocalError} /><ErrorToast error={localError || commandError?.message} onClose={() => setLocalError(null)} />{pendingCommand && <div className="live-command-pending" aria-live="polite">正在同步…</div>}</div>
    </div>
  );
}

export default LiveGameApp;
