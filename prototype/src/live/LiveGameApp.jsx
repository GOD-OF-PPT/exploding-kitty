import { useEffect, useMemo, useState } from "react";
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
  eventCopy,
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

function PlayerAvatar({ player, active, compact = false }) {
  return (
    <div className={`cat-avatar cat-avatar--${compact ? "sm" : "md"} ${active ? "is-active" : ""} ${!player.connected ? "is-offline" : ""}`}>
      <div className="cat-avatar__portrait"><img src={player.avatar || fallbackAvatars[0]} alt="" /></div>
      <span className="cat-avatar__name">{player.name}{player.bot ? " · BOT" : ""}</span>
      {player.handCount !== undefined && <span className="cat-avatar__count">{player.handCount}</span>}
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
    </section>
  );
}

function HomeView({ view, send, openOverlay, setError }) {
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
        <ComicButton onClick={() => openOverlay("create")} icon={<Plus size={24} weight="bold" />}>创建房间</ComicButton>
        <ComicButton tone="cream" onClick={() => openOverlay("join")} icon={<UserPlus size={23} weight="bold" />}>加入房间</ComicButton>
        <div className="secondary-actions"><button onClick={() => openOverlay("rules")}><BookOpen size={20} weight="fill" />规则图鉴</button><button onClick={sends(send, command("StartTutorial"), setError)}><Info size={20} weight="fill" />教学局</button></div>
      </div>
      <p className="version-tag">原创美术概念 · ORIGINAL-2025@1</p>
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
  return (
    <section className="screen">
      <ScreenHeader title="等待开炸" eyebrow={`ROOM #${view.room.code || "------"}`} onBack={sends(send, command("LeaveRoom"), setError)} right={<button className="icon-button" onClick={copyCode}><ShareNetwork size={22} weight="fill" /></button>} />
      <div className="room-code"><span>房间码</span><strong>{view.room.code || "------"}</strong><button onClick={copyCode}><Copy size={18} />复制</button></div>
      <div className="seat-grid">
        {view.players.map((player) => <div key={player.id} className={`seat-card ${player.ready || player.id === view.room.ownerId ? "ready" : ""}`}><PlayerAvatar player={player} compact /><b>{player.name}{player.id === view.room.ownerId ? " · 房主" : ""}</b><span>{player.ready || player.id === view.room.ownerId ? <><Check size={14} />已准备</> : "等待准备"}</span>{isHost && player.bot && <button className="live-seat-action" onClick={sends(send, command("RemoveBot", { playerId: player.id }), setError)}>移除</button>}</div>)}
        {view.players.length < view.room.maxPlayers && <button className="seat-card seat-card--empty" onClick={isHost && view.room.allowBots ? sends(send, command("AddBot"), setError) : copyCode}>{isHost && view.room.allowBots ? <Plus size={32} weight="bold" /> : <UserPlus size={32} weight="bold" />}<b>{isHost && view.room.allowBots ? "加入 Bot" : "邀请好友"}</b><span>还有 {view.room.maxPlayers - view.players.length} 个座位</span></button>}
      </div>
      <div className="room-note"><span>{view.players.length}/{view.room.maxPlayers} 人 · {view.room.rulesetVersion} · {view.room.turnSeconds || "不限"} 秒</span><button onClick={() => openOverlay("rules")}>查看规则</button></div>
      {isHost ? <ComicButton className="bottom-cta" tone="cyan" disabled={!canStart} onClick={sends(send, command("StartMatch"), setError)}>开始游戏</ComicButton> : <ComicButton className="bottom-cta" tone={view.me.ready ? "cream" : "yellow"} onClick={sends(send, command("SetReady", { ready: !view.me.ready }), setError)}>{view.me.ready ? "取消准备" : "我准备好了"}</ComicButton>}
    </section>
  );
}

function CardButton({ card, selected, onClick, disabled }) {
  return <button className={`playing-card ${selected ? "selected" : ""}`} onClick={onClick} disabled={disabled} aria-label={`${card.name}${selected ? "（已选择）" : ""}`}><img src={card.image} alt="" onError={(event) => { event.currentTarget.src = "/assets/cards/card-back.png"; }} /><span>{card.name}</span></button>;
}

function TableView({ view, send, openOverlay, setError }) {
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [declaredCardType, setDeclaredCardType] = useState("");
  const isMyTurn = view.game.turnPlayerId === view.me.id || hasLegalAction(view, "DRAW", "PLAY_CARDS");
  const selected = view.hand.filter((card) => selectedTokens.includes(card.token));
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
  const cardPointerDown = (event, card) => {
    event.preventDefault();
    toggleCard(card);
  };
  const play = async () => {
    try {
      await send(buildPlayCommand(selected, targetId, declaredCardType));
      setSelectedTokens([]); setTargetId(""); setDeclaredCardType("");
    } catch (error) { setError(error?.message || "这组牌现在不能打出"); }
  };
  const deadline = useDeadline(view.game.deadline);
  const activePlayer = view.players.find((player) => player.id === view.game.turnPlayerId);
  const discard = view.game.discardTop.type === "UNKNOWN" ? null : view.game.discardTop;
  return (
    <section className="screen screen--game live-table">
      <div className="game-topbar"><button onClick={() => openOverlay("history")}><ClockCounterClockwise size={20} /></button><span>第 {view.game.turnNumber} 回合 · {view.game.direction === "COUNTER_CLOCKWISE" ? "逆时针" : "顺时针"}{deadline != null ? ` · ${deadline}s` : ""}</span><button onClick={() => openOverlay("menu")}><Gear size={20} /></button></div>
      <div className="opponents">{view.players.filter((player) => player.id !== view.me.id && player.alive).map((player) => <PlayerAvatar key={player.id} player={player} active={player.id === view.game.turnPlayerId} />)}</div>
      <div className="table-zone"><div className="turn-banner">{isMyTurn ? (view.game.turnsOwed > 1 ? `你还欠 ${view.game.turnsOwed} 个回合` : "轮到你了") : `等待 ${activePlayer?.name || "其他玩家"} 行动…`}</div><div className="piles"><button className="pile pile--draw" disabled={!isMyTurn || !hasLegalAction(view, "DRAW")} onClick={sends(send, command("Draw", { turnId: view.game.turnId }), setError)}><div className="pile-card"><img src="/assets/cards/card-back.png" alt="牌背" /></div><strong>牌堆 <b>{view.game.drawPileCount}</b></strong></button><div className="pile pile--discard"><div className="pile-card">{discard ? <img src={discard.image} alt="" /> : null}</div><strong>弃牌堆</strong></div></div><button className="draw-burst" disabled={!isMyTurn || !hasLegalAction(view, "DRAW")} onClick={sends(send, command("Draw", { turnId: view.game.turnId }), setError)}>抽一张</button></div>
      <div className="hand-zone"><div className="hand-label"><span>{view.eliminated ? "已淘汰 · 仅公开信息" : "你的手牌"}</span><b>{view.hand.length}</b></div><div className="hand-cards">{view.eliminated ? <div className="live-spectator-note"><Lock size={18} />手牌已移入淘汰区</div> : view.hand.map((card, index) => {
        const center = (view.hand.length - 1) / 2;
        const spread = Math.min(48, 230 / Math.max(1, view.hand.length - 1));
        return <button className={`playing-card ${selectedTokens.includes(card.token) ? "selected" : ""}`} style={{ "--i": index, "--center": center, "--spread": `${spread}px` }} key={card.token} onPointerDown={(event) => cardPointerDown(event, card)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleCard(card); } }} disabled={!isMyTurn || !card.playable || (!card.singlePlayable && view.hand.filter((held) => held.type === card.type).length < 2)} aria-label={`${card.name}${selectedTokens.includes(card.token) ? "（已选择）" : ""}`}><img src={card.image} alt="" onError={(event) => { event.currentTarget.src = "/assets/cards/card-back.png"; }} /><span>{card.name}</span></button>;
      })}</div></div>
      {selected.length > 0 && <div className="play-dock live-play-dock"><button onClick={() => setSelectedTokens([])}><X size={20} /></button><div className="live-play-controls">{needsTarget && <select aria-label="选择目标" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">选择目标</option>{targets.map((player) => <option value={player.id} key={player.id}>{player.name} · {player.handCount} 张</option>)}</select>}{needsDeclaration && <select aria-label="声明牌型" value={declaredCardType} onChange={(event) => setDeclaredCardType(event.target.value)}><option value="">声明牌型</option>{CARD_TYPE_OPTIONS.map((card) => <option value={card.type} key={card.type}>{card.name}</option>)}</select>}<ComicButton onClick={play} disabled={!validSelection}>{selected.length === 1 ? "打出这张牌" : `打出 ${selected.length} 张组合`}</ComicButton></div></div>}
      {!isMyTurn && !view.pending && hasLegalAction(view, "PLAY_NOPE", "NOPE") && <button className="live-nope-ready" onClick={() => openOverlay("response")}>手里有否决 · 等待响应窗</button>}
    </section>
  );
}

function ResponsePrompt({ view, send, setError }) {
  const pending = view.pending;
  const deadline = useDeadline(pending?.deadline);
  const nopeCount = Number(pending?.nopeCount || pending?.chainLength || 0);
  const canNope = hasLegalAction(view, "PLAY_NOPE", "NOPE") || pending?.canNope;
  const canPass = hasLegalAction(view, "PASS_RESPONSE", "PASS") || pending?.canPass !== false;
  return (
    <div className="live-modal response-sheet">
      <span className="response-kicker">所有存活玩家都可以响应</span><h2>{pending?.actionName || cardDefinition(pending?.cardType).name || "这个动作"}<br /><span>{nopeCount % 2 ? "当前被否决" : "当前会生效"}</span></h2>
      <div className="countdown"><strong>{deadline ?? "…"}</strong><span>秒</span></div><p>否决链 {nopeCount} 张 · 每张新否决都会开启新窗口</p>
      <div className="response-actions"><ComicButton tone="red" disabled={!canNope} onClick={sends(send, command("PlayNope", { windowId: pending?.id }), setError)}>打出否决</ComicButton><button disabled={!canPass} onClick={sends(send, command("PassResponse", { windowId: pending?.id }), setError)}>放弃响应</button></div>
    </div>
  );
}

function ExplosionPrompt({ view, send, setError }) {
  const canDefuse = hasLegalAction(view, "USE_DEFUSE", "DEFUSE") || view.hand.some((card) => card.type === "DEFUSE");
  return <div className="live-modal live-explosion"><span className="explosion-word">砰！</span><img src="/assets/cards/danger.png" alt="原创危险猫牌" /><h1>危险猫出现了！</h1><p>{canDefuse ? "你有拆弹，立即化解危机。" : "手里没有拆弹，你将被淘汰。"}</p>{canDefuse && <ComicButton onClick={sends(send, command("UseDefuse", { promptId: view.pending?.id }), setError)}>立即拆弹</ComicButton>}</div>;
}

function DefusePrompt({ view, send, setError }) {
  const max = Math.max(0, Number(view.pending?.deckSize ?? view.game.drawPileCount));
  const [position, setPosition] = useState(Math.floor(max / 2));
  const deadline = useDeadline(view.pending?.deadline);
  return <div className="live-modal live-private"><Lock size={24} weight="fill" /><h2>偷偷放回危险猫</h2><p>只有你知道位置 · {deadline == null ? "15" : deadline} 秒</p><input type="range" min="0" max={max} value={Math.min(position, max)} onChange={(event) => setPosition(Number(event.target.value))} /><div className="live-range-labels"><span>最上面</span><strong>第 {Math.min(position, max) + 1} 张</strong><span>最下面</span></div><div className="live-inline-actions"><button onClick={sends(send, command("Choose", { promptId: view.pending?.id, value: { random: true } }), setError)}>服务器随机</button><ComicButton onClick={sends(send, command("Choose", { promptId: view.pending?.id, value: { position: Math.min(position, max) } }), setError)}>秘密放回</ComicButton></div></div>;
}

function GiveCardPrompt({ view, send, setError }) {
  const [token, setToken] = useState(view.hand[0]?.token || "");
  const deadline = useDeadline(view.pending?.deadline);
  return <div className="live-modal live-private"><Lock size={24} weight="fill" /><h2>交出一张牌</h2><p>{view.pending?.requesterName || "另一位玩家"} 请求帮忙 · {deadline ?? 15} 秒</p><div className="private-hand-grid">{view.hand.map((card) => <CardButton key={card.token} card={card} selected={token === card.token} onClick={() => setToken(card.token)} />)}</div><ComicButton disabled={!token} onClick={sends(send, command("Choose", { promptId: view.pending?.id, value: { cardToken: token } }), setError)}>交出这张</ComicButton></div>;
}

function WaitingPrivatePrompt({ view }) {
  const deadline = useDeadline(view.pending?.deadline);
  const player = view.players.find((item) => item.id === view.pending?.playerId);
  return <div className="live-modal"><Lock size={24} weight="fill" /><h2>等待秘密选择</h2><p>{player?.name || "另一位玩家"} 正在完成私密操作{deadline == null ? "" : ` · ${deadline} 秒`}</p></div>;
}

function FuturePrompt({ view, send, setError }) {
  const cards = (view.pending?.cards || view.pending?.peek || []).map((card, index) => ({ ...cardDefinition(card.type || card), ...(typeof card === "object" ? card : {}), key: card.token || index }));
  return <div className="live-modal live-private"><Lock size={24} weight="fill" /><h2>预见未来</h2><p>顺序不会改变，其他人看不到</p><div className="future-stack">{cards.map((card, index) => <div className="future-row" key={card.key}><b>{index + 1}</b><img src={card.image} alt="" /><span><strong>{card.name}</strong><small>{index === 0 ? "下一张" : `再过 ${index} 张`}</small></span></div>)}</div><ComicButton onClick={sends(send, command("Choose", { promptId: view.pending?.id, value: { acknowledged: true } }), setError)}>记住了</ComicButton></div>;
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
  if (content) return <div className="live-modal-backdrop">{content}</div>;
  return <div className="live-modal-backdrop"><div className="live-modal"><h2>等待你的选择</h2><p>{view.pending.copy || "请完成当前操作后继续。"}</p></div></div>;
}

function HistoryView({ view, onBack }) {
  return <section className="screen screen--scroll"><ScreenHeader title="行动记录" eyebrow={`第 ${view.game.turnNumber} 回合`} onBack={onBack} /><div className="history-list">{view.events.slice().reverse().map((event, index) => <div key={event.id || index} className={event.private ? "private" : ""}><i /><span><small>{event.time || event.sequence || `#${view.events.length - index}`}</small><strong>{eventCopy(event)}</strong>{event.private && <em><Lock size={12} />仅你可见</em>}</span></div>)}</div><div className="history-tip"><Info size={18} weight="fill" />记录只显示你有权限查看的信息</div></section>;
}

function RulesView({ onBack }) {
  const [tab, setTab] = useState("cards");
  return <section className="screen screen--scroll"><ScreenHeader title="规则图鉴" eyebrow="ORIGINAL-2025@1" onBack={onBack} /><div className="tabs"><button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>卡牌</button><button className={tab === "combos" ? "active" : ""} onClick={() => setTab("combos")}>组合</button><button className={tab === "platform" ? "active" : ""} onClick={() => setTab("platform")}>平台规则</button></div>{tab === "cards" && <div className="card-library">{BASE_CARDS.map((card) => <div className="live-rule-card" key={card.type}><img src={card.image} alt="" onError={(event) => { event.currentTarget.src = "/assets/cards/card-back.png"; }} /><span><b>{card.name} ×{card.count}</b><small>{card.type === "EXPLODING_KITTEN" ? "抽到立即揭示；拆弹或淘汰" : card.type === "DEFUSE" ? "不可主动打出、不可否决" : card.type === "CAT_CARD" ? "单张无效果，用于同名组合" : card.nopeable ? "动作结算前可被否决" : "不可否决"}</small></span></div>)}</div>}{tab === "combos" && <div className="rule-articles"><article><span>2×</span><h2>两张同名牌</h2><p>忽略牌面效果，指定有手牌的玩家，服务器随机偷 1 张。</p></article><article><span>3×</span><h2>三张同名牌</h2><p>指定玩家并声明牌型；命中则交出 1 张，也可能落空。</p></article><div className="rule-warning"><Info size={20} weight="fill" />2025 基础版没有“五张不同牌”组合。</div></div>}{tab === "platform" && <div className="rule-articles"><article><span>5s</span><h2>否决窗口</h2><p>服务器先收到者优先；放弃后不可反悔，奇数取消、偶数生效。</p></article><article><span>15s</span><h2>私密选择</h2><p>超时后服务器用确定性随机数完成合法选择。</p></article><article><span>60s</span><h2>断线宽限</h2><p>倒计时继续；宽限结束后由 Bot 暂时代打。</p></article></div>}</section>;
}

function SettingsView({ view, send, onBack, setError }) {
  const [sound, setSound] = useState(view.settings?.sound !== false);
  const [vibration, setVibration] = useState(view.settings?.vibration !== false);
  const update = (next) => sends(send, command("UpdateSettings", next), setError)();
  return <section className="screen"><ScreenHeader title="设置" eyebrow="让猫安静一点" onBack={onBack} /><div className="settings-profile"><PlayerAvatar player={{ ...view.me, avatar: view.user.avatar }} compact /><div><strong>{view.user.name}</strong><span>ID {view.user.id || "—"}</span></div></div><div className="settings-list"><button onClick={() => { const next = !sound; setSound(next); update({ sound: next }); }}><span>{sound ? <SpeakerHigh size={22} weight="fill" /> : <SpeakerSlash size={22} weight="fill" />}音效</span><i className={sound ? "on" : ""}><b /></i></button><button onClick={() => { const next = !vibration; setVibration(next); update({ vibration: next }); }}><span><Gear size={22} weight="fill" />震动反馈</span><i className={vibration ? "on" : ""}><b /></i></button></div><div className="legal-note">规则 original-2025@1<br />原创概念设计 · 不含官方美术</div></section>;
}

function GameMenuView({ view, send, openOverlay, onBack, setError }) {
  const [confirming, setConfirming] = useState(false);
  return <section className="screen"><ScreenHeader title="对局菜单" eyebrow={`ROOM #${view.room.code || "------"}`} onBack={onBack} /><div className="menu-cat"><img src={view.user.avatar || fallbackAvatars[0]} alt="" /></div><div className="menu-list"><button onClick={() => openOverlay("rules")}><BookOpen size={23} weight="fill" /><span><b>查看规则</b><small>卡牌、组合与平台规则</small></span><CaretRight size={20} /></button><button onClick={() => openOverlay("settings")}><Gear size={23} weight="fill" /><span><b>声音与振动</b><small>只影响当前设备</small></span><CaretRight size={20} /></button><button onClick={() => openOverlay("network")}><WifiHigh size={23} weight="fill" /><span><b>网络状态</b><small>{view.connection.latency ? `${view.connection.latency}ms` : view.connection.state}</small></span><CaretRight size={20} /></button></div>{!confirming ? <button className="danger-link" onClick={() => setConfirming(true)}>认输并离开</button> : <div className="concede-confirm"><strong>确定认输？</strong><p>你的手牌会移入淘汰区，本局无法返回。</p><div><button onClick={() => setConfirming(false)}>再想想</button><button onClick={sends(send, command("Concede"), setError)}>确认认输</button></div></div>}<ComicButton className="bottom-cta" tone="cream" onClick={onBack}>返回牌桌</ComicButton></section>;
}

function NetworkView({ view, send, onBack, setError }) {
  const connected = ["CONNECTED", "ONLINE"].includes(view.connection.state);
  return <section className="screen screen--network"><div className="network-icon"><i className={connected ? "connected" : ""} /><i className={connected ? "connected" : ""} /><i className={connected ? "connected" : ""} /></div><span className="response-kicker">对局仍在服务器继续</span><h1>{connected ? "连接稳定" : "正在找回牌桌…"}</h1><p>{connected ? "玩家专属快照已同步。" : "倒计时仍以服务器为准，60 秒后 Bot 暂时代打。"}</p>{connected ? <ComicButton className="bottom-cta" onClick={onBack}>回到牌桌</ComicButton> : <button className="retry-link" onClick={sends(send, command("Reconnect", { lastAckSeq: view.raw?.lastAckSeq }), setError)}>立即重试</button>}</section>;
}

function ResultView({ view, send, setError }) {
  const ranks = view.result?.rankings || view.result?.players || view.players;
  const winner = ranks.find((player) => player.rank === 1 || player.winner) || ranks[0];
  const isHost = view.room.ownerId === view.me.id;
  return <section className="screen"><div className="winner-hero"><span>WINNER</span><img src={winner?.avatar || fallbackAvatars[3]} alt="" /><h2>{winner?.name || "最后一只猫"}</h2><p>{view.result?.summary || "成功留到最后"}</p></div><div className="rank-list">{ranks.map((player, index) => <div key={player.id || index} className={(player.rank || index + 1) === 1 ? "winner" : ""}><b>{player.rank || index + 1}</b><img src={player.avatar || fallbackAvatars[index % 4]} alt="" /><span><strong>{player.name}</strong><small>{player.reason || (player.alive ? "存活" : "炸毛")}</small></span>{player.id === view.me.id && <i>YOU</i>}</div>)}</div><div className="result-actions"><ComicButton onClick={sends(send, command(isHost ? "RestartMatch" : "VoteRestart"), setError)}>{isHost ? "再来一局" : "申请再来一局"}</ComicButton><button onClick={sends(send, command("LeaveRoom"), setError)}>回到首页</button></div></section>;
}

export function LiveGameApp({ session, className = "" }) {
  const { view, send, pendingCommand, commandError } = useLiveSession(session);
  const [overlay, setOverlay] = useState(null);
  const [localError, setLocalError] = useState(null);
  const scene = deriveScene(view);

  useEffect(() => {
    if (view.pending) setOverlay(null);
  }, [view.pending?.id, view.pending?.kind]);

  useEffect(() => {
    if ((overlay === "create" || overlay === "join") && view.room.id) setOverlay(null);
  }, [overlay, view.room.id]);

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

  const closeOverlay = () => setOverlay(null);
  const common = { view, send, setError: setLocalError };
  let content;
  if (overlay === "create") content = <CreateRoomView {...common} onBack={closeOverlay} />;
  else if (overlay === "join") content = <JoinRoomView {...common} onBack={closeOverlay} />;
  else if (overlay === "history") content = <HistoryView view={view} onBack={closeOverlay} />;
  else if (overlay === "rules") content = <RulesView onBack={closeOverlay} />;
  else if (overlay === "settings") content = <SettingsView {...common} onBack={closeOverlay} />;
  else if (overlay === "menu") content = <GameMenuView {...common} openOverlay={setOverlay} onBack={closeOverlay} />;
  else if (overlay === "network") content = <NetworkView {...common} onBack={closeOverlay} />;
  else if (overlay === "response") content = <TableView {...common} openOverlay={setOverlay} />;
  else if (scene === "login") content = <LoginView {...common} pending={pendingCommand} />;
  else if (scene === "home") content = <HomeView {...common} openOverlay={setOverlay} />;
  else if (scene === "lobby") content = <LobbyView {...common} openOverlay={setOverlay} />;
  else if (scene === "network") content = <NetworkView {...common} onBack={() => {}} />;
  else if (scene === "result") content = <ResultView {...common} />;
  else content = <TableView {...common} openOverlay={setOverlay} />;

  return (
    <div className={`live-game-app ${className}`}>
      <div className="mobile-prototype">{content}<PendingLayer view={view} send={send} setError={setLocalError} /><ErrorToast error={localError || commandError?.message} onClose={() => setLocalError(null)} />{pendingCommand && <div className="live-command-pending" aria-live="polite">正在同步…</div>}</div>
    </div>
  );
}

export default LiveGameApp;
