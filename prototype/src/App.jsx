import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CaretRight,
  ClockCounterClockwise,
  Copy,
  Gear,
  House,
  Info,
  Lock,
  Minus,
  Plus,
  ShareNetwork,
  SpeakerHigh,
  SpeakerSlash,
  UserPlus,
  UsersThree,
  X,
} from "@phosphor-icons/react";

const cats = {
  orange: "/assets/cats/a-ju.png",
  gray: "/assets/cats/xiao-hui.png",
  white: "/assets/cats/tuan-zi.png",
  player: "/assets/cats/player.png",
};

const cards = [
  { id: "attack", name: "攻击", image: "/assets/cards/attack.png", tone: "red", copy: "结束回合，下家连续行动 2 次" },
  { id: "skip", name: "跳过", image: "/assets/cards/skip.png", tone: "cyan", copy: "不抽牌，结束当前回合" },
  { id: "defuse", name: "拆弹", image: "/assets/cards/defuse.png", tone: "yellow", copy: "化解爆炸，并秘密放回牌堆" },
  { id: "shuffle", name: "洗牌", image: "/assets/cards/shuffle.png", tone: "cream", copy: "立即洗混整个抽牌堆" },
  { id: "peek", name: "透视", image: "/assets/cards/peek.png", tone: "cyan", copy: "私下查看牌堆顶 3 张" },
  { id: "favor", name: "帮忙", image: "/assets/cards/reverse.png", tone: "purple", copy: "指定玩家，由对方交给你 1 张牌" },
];

const navGroups = [
  {
    label: "开始",
    items: [
      ["login", "启动登录"],
      ["home", "首页"],
      ["play-mode", "开局方式"],
      ["create", "创建房间"],
      ["join", "加入房间"],
      ["lobby", "房主房间"],
      ["lobby-member", "成员房间"],
    ],
  },
  {
    label: "对局",
    items: [
      ["game", "我的回合"],
      ["other-turn", "他人回合"],
      ["response", "否决窗口"],
      ["favor", "帮忙选择"],
      ["give-card", "赠送手牌"],
      ["defuse", "拆弹放回"],
      ["future", "预见未来"],
      ["explosion", "爆炸揭示"],
      ["attack-debt", "攻击欠回合"],
      ["eliminated", "爆炸淘汰"],
      ["result", "对局结算"],
    ],
  },
  {
    label: "帮助",
    items: [
      ["tutorial", "新手教程"],
      ["rules", "规则图鉴"],
      ["card-detail", "卡牌详情"],
      ["history", "行动记录"],
      ["game-menu", "对局菜单"],
      ["network", "断线重连"],
      ["settings", "设置"],
    ],
  },
];

function CatAvatar({ src, name, count, active, size = "md" }) {
  return (
    <div className={`cat-avatar cat-avatar--${size} ${active ? "is-active" : ""}`}>
      <div className="cat-avatar__portrait"><img src={src} alt="" /></div>
      {name && <span className="cat-avatar__name">{name}</span>}
      {count !== undefined && <span className="cat-avatar__count">{count}</span>}
    </div>
  );
}

function ComicButton({ children, tone = "yellow", className = "", onClick, icon, disabled = false }) {
  return (
    <button className={`comic-button comic-button--${tone} ${className}`} onClick={onClick} disabled={disabled}>
      {icon}{children}
    </button>
  );
}

function ScreenHeader({ title, eyebrow, back = "home", onNavigate, right }) {
  return (
    <header className="screen-header">
      <button className="icon-button" onClick={() => onNavigate(back)} aria-label="返回"><ArrowLeft size={22} weight="bold" /></button>
      <div className="screen-header__title">
        {eyebrow && <span>{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      {right || <div className="icon-button icon-button--ghost" />}
    </header>
  );
}

function LoginScreen({ onNavigate }) {
  const [loading, setLoading] = useState(false);
  const enter = () => {
    setLoading(true);
    setTimeout(() => onNavigate("home"), 650);
  };
  return (
    <section className="screen screen--login">
      <div className="login-logo"><span>炸毛</span><strong>危机</strong><small>原创回合制卡牌游戏</small></div>
      <div className="login-cast"><img src="/assets/cat-cast.png" alt="四只原创猫咪角色" /></div>
      <div className="login-burst">今晚<br />谁先炸？</div>
      <div className="login-actions">
        <ComicButton onClick={enter}>{loading ? "正在进入…" : "微信一键进入"}</ComicButton>
        <p>登录即表示同意《用户协议》与《隐私政策》</p>
      </div>
      <div className="loading-scratch"><i className={loading ? "active" : ""} /></div>
    </section>
  );
}

function PlayModeScreen({ onNavigate }) {
  return (
    <section className="screen">
      <ScreenHeader title="开一局" eyebrow="选择你的混乱方式" onNavigate={onNavigate} />
      <div className="mode-hero"><img src={cats.player} alt="" /><span>召集猫友！</span></div>
      <div className="mode-options">
        <button onClick={() => onNavigate("create")}><i>＋</i><span><strong>创建房间</strong><small>设置人数与节奏，邀请好友</small></span><CaretRight size={22} weight="bold" /></button>
        <button onClick={() => onNavigate("join")}><i>#</i><span><strong>加入房间</strong><small>输入好友分享的 6 位房间码</small></span><CaretRight size={22} weight="bold" /></button>
      </div>
      <div className="mode-tip"><Info size={18} weight="fill" />首版支持 2–5 人邀请码私房</div>
    </section>
  );
}

function HomeScreen({ onNavigate }) {
  return (
    <section className="screen screen--home">
      <div className="home-tools">
        <button className="icon-button" onClick={() => onNavigate("settings")}><Gear size={22} weight="fill" /></button>
      </div>
      <div className="home-hero">
        <span className="kicker">危险！毛茸茸！还会爆！</span>
        <h1><span>炸毛</span><strong>危机</strong></h1>
        <div className="home-cat"><img src={cats.player} alt="原创蓝色猫咪角色" /></div>
        <div className="boom-word">BOOM!</div>
      </div>
      <div className="home-actions">
        <ComicButton tone="yellow" onClick={() => onNavigate("play-mode")} icon={<Plus size={24} weight="bold" />}>开一局</ComicButton>
        <ComicButton tone="cream" onClick={() => onNavigate("join")} icon={<UserPlus size={23} weight="bold" />}>加入房间</ComicButton>
        <div className="secondary-actions">
          <button onClick={() => onNavigate("tutorial")}><BookOpen size={20} weight="fill" />新手教学</button>
          <button onClick={() => onNavigate("rules")}><Info size={20} weight="fill" />规则图鉴</button>
        </div>
      </div>
      <p className="version-tag">原创美术概念 · ORIGINAL-2025@1</p>
    </section>
  );
}

function CreateRoomScreen({ onNavigate }) {
  const [players, setPlayers] = useState(4);
  const [timer, setTimer] = useState("轻松");
  const [bots, setBots] = useState(true);
  return (
    <section className="screen">
      <ScreenHeader title="创建房间" eyebrow="PRIVATE ROOM" onNavigate={onNavigate} />
      <div className="form-stack">
        <div className="paper-panel">
          <div className="field-label"><UsersThree size={19} weight="fill" />玩家人数</div>
          <div className="stepper">
            <button onClick={() => setPlayers(Math.max(2, players - 1))}><Minus size={20} /></button>
            <strong>{players}<small>人</small></strong>
            <button onClick={() => setPlayers(Math.min(5, players + 1))}><Plus size={20} /></button>
          </div>
        </div>
        <div className="paper-panel">
          <div className="field-label"><ClockCounterClockwise size={19} weight="fill" />行动计时</div>
          <div className="segmented">
            {["快速", "轻松", "不限时"].map((item) => <button className={timer === item ? "active" : ""} onClick={() => setTimer(item)} key={item}>{item}</button>)}
          </div>
          <p className="field-help">轻松模式：回合 45 秒，否决窗口 5 秒</p>
        </div>
        <button className={`toggle-row ${bots ? "active" : ""}`} onClick={() => setBots(!bots)}>
          <div><strong>允许机器人补位</strong><span>好友没到齐也能开局</span></div>
          <i><span /></i>
        </button>
        <div className="ruleset-stamp"><Lock size={17} weight="fill" /><span>规则集</span><strong>基础版 2025</strong></div>
      </div>
      <ComicButton className="bottom-cta" onClick={() => onNavigate("lobby")}>创建并邀请</ComicButton>
    </section>
  );
}

function JoinRoomScreen({ onNavigate }) {
  const [code, setCode] = useState("");
  return (
    <section className="screen">
      <ScreenHeader title="加入房间" eyebrow="JOIN THE CHAOS" onNavigate={onNavigate} />
      <div className="join-cat"><img src={cats.orange} alt="" /></div>
      <div className="join-copy"><h2>找到那群猫了吗？</h2><p>输入好友发来的 6 位房间码</p></div>
      <label className="code-input">
        <span>房间码</span>
        <input value={code} maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="••••••" inputMode="numeric" />
      </label>
      <ComicButton className="bottom-cta" disabled={code.length < 6} onClick={() => onNavigate("lobby-member")}>进入房间</ComicButton>
    </section>
  );
}

function LobbyScreen({ onNavigate }) {
  return (
    <section className="screen">
      <ScreenHeader title="等待开炸" eyebrow="ROOM #582913" onNavigate={onNavigate} right={<button className="icon-button"><ShareNetwork size={22} weight="fill" /></button>} />
      <div className="room-code"><span>房间码</span><strong>582 913</strong><button><Copy size={18} />复制</button></div>
      <div className="seat-grid">
        <div className="seat-card ready"><CatAvatar src={cats.player} size="lg" /><b>你 · 房主</b><span><Check size={14} />已准备</span></div>
        <div className="seat-card ready"><CatAvatar src={cats.orange} size="lg" /><b>阿橘</b><span><Check size={14} />已准备</span></div>
        <div className="seat-card ready"><CatAvatar src={cats.gray} size="lg" /><b>小灰</b><span><Check size={14} />已准备</span></div>
        <button className="seat-card seat-card--empty"><UserPlus size={32} weight="bold" /><b>邀请好友</b><span>还差 1 人</span></button>
      </div>
      <div className="room-note"><span>4 人 · 基础版 2025 · 轻松计时</span></div>
      <ComicButton className="bottom-cta" tone="cyan" onClick={() => onNavigate("game")}>开始游戏</ComicButton>
    </section>
  );
}

function LobbyMemberScreen({ onNavigate }) {
  const [ready, setReady] = useState(false);
  return (
    <section className="screen">
      <ScreenHeader title="等待开炸" eyebrow="ROOM #582913" onNavigate={onNavigate} right={<button className="icon-button"><ShareNetwork size={22} weight="fill" /></button>} />
      <div className="member-host"><CatAvatar src={cats.orange} size="sm" /><span><strong>阿橘的房间</strong><small>房主正在调整规则</small></span></div>
      <div className="seat-grid member-seats">
        <div className="seat-card ready"><CatAvatar src={cats.orange} size="lg" /><b>阿橘 · 房主</b><span><Check size={14} />已准备</span></div>
        <div className={`seat-card ${ready ? "ready" : ""}`}><CatAvatar src={cats.player} size="lg" /><b>你</b><span className={ready ? "" : "waiting"}>{ready ? "已准备" : "还没准备"}</span></div>
        <div className="seat-card ready"><CatAvatar src={cats.gray} size="lg" /><b>小灰</b><span><Check size={14} />已准备</span></div>
        <div className="seat-card ready"><CatAvatar src={cats.white} size="lg" /><b>团子</b><span><Check size={14} />已准备</span></div>
      </div>
      <div className="room-note"><span>基础版 2025 · 轻松计时 · 允许机器人</span></div>
      <ComicButton className="bottom-cta" tone={ready ? "cream" : "yellow"} onClick={() => setReady(!ready)}>{ready ? "取消准备" : "我准备好了"}</ComicButton>
    </section>
  );
}

function Opponents() {
  return (
    <div className="opponents">
      <CatAvatar src={cats.orange} name="阿橘" count={5} />
      <CatAvatar src={cats.gray} name="小灰" count={7} active />
      <CatAvatar src={cats.white} name="团子" count={4} />
    </div>
  );
}

function PlayingCard({ card, index, selected, onClick, compact = false }) {
  return (
    <button className={`playing-card ${selected ? "selected" : ""} ${compact ? "compact" : ""}`} style={{ "--i": index }} onClick={onClick} disabled={!onClick}>
      <img src={card.image} alt="" />
      <span>{card.name}</span>
    </button>
  );
}

function TablePiles({ onDraw, label = "轮到你了", drawLabel = "抽一张", disabled = false }) {
  return (
    <div className="table-zone">
      <div className="turn-banner">{label}</div>
      <div className="piles">
        <button className="pile pile--draw" onClick={onDraw} disabled={disabled}>
          <div className="pile-card"><img src="/assets/cards/card-back.png" alt="原创猫爪图案牌背" /></div>
          <strong>牌堆 <b>18</b></strong>
        </button>
        <div className="pile pile--discard">
          <div className="pile-card"><img src="/assets/cards/defuse.png" alt="" /></div>
          <strong>弃牌堆</strong>
        </div>
      </div>
      <button className="draw-burst" onClick={onDraw} disabled={disabled}>{drawLabel}</button>
    </div>
  );
}

function Hand({ selected, setSelected, disabled = false }) {
  return (
    <div className="hand-zone">
      <div className="hand-label"><span>你的手牌</span><b>6</b></div>
      <div className="hand-cards">
        {cards.map((card, index) => {
          const playable = !disabled && card.id !== "defuse";
          return <PlayingCard card={card} index={index} key={card.id} selected={selected === card.id} onClick={playable ? () => setSelected(selected === card.id ? null : card.id) : undefined} />;
        })}
      </div>
    </div>
  );
}

function GameScreen({ onNavigate }) {
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState("");
  const play = () => {
    const routes = { attack: "response", peek: "future", favor: "favor" };
    if (routes[selected]) return onNavigate(routes[selected]);
    setToast(`已打出「${cards.find((card) => card.id === selected)?.name}」`);
    setSelected(null);
    setTimeout(() => setToast(""), 1700);
  };
  return (
    <section className="screen screen--game">
      <div className="game-topbar"><button aria-label="行动记录" onClick={() => onNavigate("history")}><ClockCounterClockwise size={20} /></button><span>第 8 回合 · 顺时针</span><button aria-label="查看规则" onClick={() => onNavigate("rules")}><BookOpen size={20} /></button></div>
      <Opponents />
      <TablePiles onDraw={() => onNavigate("explosion")} />
      <Hand selected={selected} setSelected={setSelected} />
      {selected && <div className="play-dock"><button onClick={() => setSelected(null)}><X size={20} /></button><ComicButton onClick={play}>打出这张牌</ComicButton></div>}
      {toast && <div className="toast"><Check size={18} weight="bold" />{toast}</div>}
    </section>
  );
}

function OtherTurnScreen({ onNavigate }) {
  return (
    <section className="screen screen--game">
      <div className="game-topbar"><button aria-label="对局菜单" onClick={() => onNavigate("game-menu")}><Gear size={20} /></button><span>第 9 回合 · 顺时针</span><button aria-label="行动记录" onClick={() => onNavigate("history")}><ClockCounterClockwise size={20} /></button></div>
      <Opponents />
      <TablePiles onDraw={() => {}} label="等待阿橘行动…" drawLabel="现在不是你的回合" disabled />
      <Hand selected={null} setSelected={() => {}} disabled />
      <div className="waiting-ribbon"><ClockCounterClockwise size={18} /><span>阿橘还有 <b>31 秒</b></span></div>
    </section>
  );
}

function ResponseScreen({ onNavigate }) {
  const [passed, setPassed] = useState(false);
  return (
    <section className="screen screen--game screen--dimmed">
      <div className="game-topbar"><span>阿橘打出了一张牌</span></div>
      <Opponents />
      <TablePiles onDraw={() => {}} label="攻击！下家欠 2 回合" drawLabel="等待响应" disabled />
      <Hand selected={null} setSelected={() => {}} disabled />
      <div className="response-sheet">
        <button className="close-sheet" aria-label="放弃响应" onClick={() => setPassed(true)}><X size={20} /></button>
        <div className="response-cat"><img src={cats.orange} alt="" /></div>
        <span className="response-kicker">所有人都可以响应</span>
        <h2>有人要<span>否决</span>吗？</h2>
        <div className="countdown"><strong>{passed ? "✓" : "4"}</strong><span>{passed ? "已放弃" : "秒"}</span></div>
        {!passed ? <div className="response-actions"><ComicButton tone="red" onClick={() => onNavigate("game")}>打出否决</ComicButton><button onClick={() => setPassed(true)}>放弃响应</button></div> : <p>等待其他玩家…</p>}
      </div>
    </section>
  );
}

function FavorScreen({ onNavigate }) {
  const [target, setTarget] = useState("orange");
  return (
    <section className="screen">
      <ScreenHeader title="选择目标" eyebrow="帮忙 · FAVOR" back="game" onNavigate={onNavigate} />
      <div className="prompt-illustration"><img src="/assets/cards/peek.png" alt="" /></div>
      <div className="prompt-copy"><h2>谁来帮你一个忙？</h2><p>对方将自行选择 1 张手牌交给你</p></div>
      <div className="target-list">
        {[['orange','阿橘',5],['gray','小灰',7],['white','团子',4]].map(([id, name, count]) => (
          <button key={id} onClick={() => setTarget(id)} className={target === id ? "active" : ""}>
            <CatAvatar src={cats[id]} size="sm" /><span><b>{name}</b><small>{count} 张手牌</small></span>{target === id ? <Check size={22} weight="bold" /> : <CaretRight size={20} />}
          </button>
        ))}
      </div>
      <ComicButton className="bottom-cta" onClick={() => onNavigate("give-card")}>就选 TA</ComicButton>
    </section>
  );
}

function GiveCardScreen({ onNavigate }) {
  const [selected, setSelected] = useState("skip");
  return (
    <section className="screen">
      <ScreenHeader title="交出一张牌" eyebrow="团子请求你帮忙" back="game" onNavigate={onNavigate} />
      <div className="give-request"><CatAvatar src={cats.white} size="lg" /><div><span>还剩 12 秒</span><h2>选一张交给团子</h2><p>只有你和团子会看到牌面</p></div></div>
      <div className="private-hand-grid">
        {cards.slice(0, 4).map((card, index) => <PlayingCard card={card} index={index} compact key={card.id} selected={selected === card.id} onClick={() => setSelected(card.id)} />)}
      </div>
      <div className="privacy-note"><Lock size={18} weight="fill" />超时后服务器会随机选择一张</div>
      <ComicButton className="bottom-cta" onClick={() => onNavigate("game")}>交出「{cards.find(card => card.id === selected)?.name}」</ComicButton>
    </section>
  );
}

function DefuseScreen({ onNavigate }) {
  const [position, setPosition] = useState(3);
  return (
    <section className="screen screen--danger">
      <ScreenHeader title="拆弹成功！" eyebrow="活下来了，但还没完" back="defuse" onNavigate={onNavigate} />
      <div className="defuse-hero"><img src="/assets/cards/defuse.png" alt="" /><span>呼——</span></div>
      <div className="prompt-copy"><h2>偷偷放回牌堆</h2><p>只有你知道爆炸牌的新位置</p></div>
      <div className="deck-position">
        <div className="deck-stack-mini">
          {Array.from({ length: 7 }, (_, index) => <i key={index} className={index === position ? "danger-card" : ""} />)}
        </div>
        <input type="range" min="0" max="6" value={position} onChange={(event) => setPosition(Number(event.target.value))} />
        <div><span>最上面</span><strong>第 {position + 1} 张</strong><span>最下面</span></div>
      </div>
      <ComicButton className="bottom-cta" onClick={() => onNavigate("game")}>神不知，猫不觉</ComicButton>
    </section>
  );
}

function FutureScreen({ onNavigate }) {
  const future = [cards[1], cards[0], cards[4]];
  return (
    <section className="screen">
      <ScreenHeader title="预见未来" eyebrow="嘘——只有你能看到" back="game" onNavigate={onNavigate} />
      <div className="future-eye"><img src="/assets/cards/peek.png" alt="" /></div>
      <div className="future-stack">
        {future.map((card, index) => <div className="future-row" key={card.id}><b>{index + 1}</b><img src={card.image} alt="" /><span><strong>{card.name}</strong><small>{index === 0 ? "下一张" : `再过 ${index} 张`}</small></span></div>)}
      </div>
      <div className="privacy-note"><Lock size={18} weight="fill" />顺序不会改变，其他人看不到</div>
      <ComicButton className="bottom-cta" onClick={() => onNavigate("game")}>记住了</ComicButton>
    </section>
  );
}

function ExplosionScreen({ onNavigate }) {
  return (
    <section className="screen screen--explosion">
      <div className="explosion-word">砰！</div>
      <div className="explosion-card"><img src="/assets/cards/danger.png" alt="原创危险牌插画" /></div>
      <div className="explosion-copy"><span>你抽到了危险牌</span><h1>要炸了！</h1><p>幸好手里还有一张拆弹。</p></div>
      <div className="explosion-actions"><ComicButton onClick={() => onNavigate("defuse")}>立即拆弹</ComicButton><button onClick={() => onNavigate("eliminated")}>查看无拆弹状态</button></div>
    </section>
  );
}

function AttackDebtScreen({ onNavigate }) {
  const [debt, setDebt] = useState(3);
  const settleOneTurn = () => {
    if (debt > 1) setDebt(debt - 1);
    else onNavigate("other-turn");
  };
  return (
    <section className="screen screen--game">
      <div className="game-topbar"><button aria-label="对局菜单" onClick={() => onNavigate("game-menu")}><Gear size={20} /></button><span>攻击状态</span><button aria-label="查看规则" onClick={() => onNavigate("rules")}><BookOpen size={20} /></button></div>
      <Opponents />
      <TablePiles onDraw={settleOneTurn} label={`你还欠 ${debt} 个回合！`} drawLabel="抽牌 · 完成 1 回合" />
      <Hand selected={null} setSelected={() => {}} disabled />
      <div className="debt-stamp"><b>{debt}×</b><span>跳过仅减少 1<br />再攻击将转移 5 回合</span></div>
    </section>
  );
}

function EliminatedScreen({ onNavigate }) {
  return (
    <section className="screen screen--eliminated">
      <div className="eliminated-copy"><span>砰！</span><h1>你炸毛了</h1><p>别灰心，猫有九条命。<br />下一局把炸弹塞给他们。</p></div>
      <div className="eliminated-cat"><img src={cats.player} alt="" /></div>
      <div className="placement"><small>本局名次</small><strong>第 3 名</strong><span>存活 12 回合</span></div>
      <div className="stacked-actions"><ComicButton onClick={() => onNavigate("other-turn")}>继续观战</ComicButton><button onClick={() => onNavigate("home")}>退出房间</button></div>
    </section>
  );
}

function ResultScreen({ onNavigate }) {
  const ranks = [
    ["团子", cats.white, "冠军", "1"], ["阿橘", cats.orange, "差一点", "2"], ["你", cats.player, "炸毛", "3"], ["小灰", cats.gray, "先走一步", "4"],
  ];
  return (
    <section className="screen">
      <ScreenHeader title="本局结算" eyebrow="最后一只猫站着" back="home" onNavigate={onNavigate} />
      <div className="winner-hero"><span>WINNER</span><img src={cats.white} alt="" /><h2>团子</h2><p>成功躲过 3 次爆炸</p></div>
      <div className="rank-list">
        {ranks.map(([name, image, status, rank]) => <div key={name} className={rank === "1" ? "winner" : ""}><b>{rank}</b><img src={image} alt="" /><span><strong>{name}</strong><small>{status}</small></span>{name === "你" && <i>YOU</i>}</div>)}
      </div>
      <div className="result-actions"><ComicButton onClick={() => onNavigate("lobby")}>再来一局</ComicButton><button onClick={() => onNavigate("home")}>回到首页</button></div>
    </section>
  );
}

function TutorialScreen({ onNavigate }) {
  const [step, setStep] = useState(0);
  const tutorials = [
    ["先出牌，再抽牌", "你可以打出任意张手牌，也可以什么都不出。抽牌会结束当前回合。", "/assets/cards/skip.png"],
    ["别抽到爆炸牌", "抽到爆炸牌会立刻出局，除非你手里有一张拆弹。", "/assets/cards/attack.png"],
    ["最后一只猫获胜", "观察牌堆、打乱计划、把危险留给下家。活到最后！", "/assets/cats/player.png"],
  ];
  const current = tutorials[step];
  return (
    <section className="screen">
      <ScreenHeader title="新手教学" eyebrow={`${step + 1} / ${tutorials.length}`} onNavigate={onNavigate} />
      <div className="tutorial-stage"><div className="tutorial-burst"><img src={current[2]} alt="" /></div></div>
      <div className="tutorial-copy"><span>STEP {step + 1}</span><h2>{current[0]}</h2><p>{current[1]}</p></div>
      <div className="progress-dots">{tutorials.map((_, index) => <i className={index === step ? "active" : ""} key={index} />)}</div>
      <ComicButton className="bottom-cta" onClick={() => step < tutorials.length - 1 ? setStep(step + 1) : onNavigate("play-mode")}>{step < tutorials.length - 1 ? "下一步" : "我会了，开炸！"}</ComicButton>
    </section>
  );
}

function RulesScreen({ onNavigate }) {
  const [tab, setTab] = useState("cards");
  return (
    <section className="screen screen--scroll">
      <ScreenHeader title="规则图鉴" eyebrow="ORIGINAL-2025@1" onNavigate={onNavigate} />
      <div className="tabs"><button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>卡牌</button><button className={tab === "combos" ? "active" : ""} onClick={() => setTab("combos")}>组合技</button><button className={tab === "flow" ? "active" : ""} onClick={() => setTab("flow")}>回合流程</button></div>
      {tab === "cards" && <div className="card-library">{cards.map((card) => <button key={card.id} onClick={() => onNavigate("card-detail", { card: card.id })}><img src={card.image} alt="" /><span><b>{card.name}</b><small>{card.copy}</small></span><CaretRight size={19} /></button>)}</div>}
      {tab === "combos" && <div className="rule-articles"><article><span>2×</span><h2>两张同名牌</h2><p>忽略牌面效果，指定一名玩家并随机偷取 1 张手牌。</p></article><article><span>3×</span><h2>三张同名牌</h2><p>指定玩家并喊出牌名；对方有就必须交出一张。</p></article><div className="rule-warning"><Info size={20} weight="fill" />当前版没有“五张不同牌”组合。</div></div>}
      {tab === "flow" && <div className="flow-list"><div><b>1</b><span><strong>打牌或跳过</strong><small>想打几张就打几张</small></span></div><div><b>2</b><span><strong>响应否决</strong><small>动作结算前所有人可响应</small></span></div><div><b>3</b><span><strong>抽一张牌</strong><small>抽牌后回合结束</small></span></div></div>}
    </section>
  );
}

function CardDetailScreen({ onNavigate, params }) {
  const card = cards.find((item) => item.id === params?.card) || cards[0];
  const isDefuse = card.id === "defuse";
  return (
    <section className="screen">
      <ScreenHeader title={card.name} eyebrow="卡牌详情" back="rules" onNavigate={onNavigate} />
      <div className="detail-card"><img src={card.image} alt="" /></div>
      <div className="detail-copy"><span>基础版 · {isDefuse ? "救援牌" : "动作牌"}</span><h2>{card.copy}</h2><p>{isDefuse ? "抽到危险牌时自动进入拆弹流程；不能在普通回合主动打出，也不进入否决窗口。" : "打出后先进入否决响应窗口。若无人否决，效果立即结算。"}</p></div>
      <div className="detail-facts"><div><b>可否决</b><span>{isDefuse ? "否" : "是"}</span></div><div><b>结束回合</b><span>{card.id === "skip" || card.id === "attack" ? "是" : "否"}</span></div></div>
      <ComicButton className="bottom-cta" tone="cream" onClick={() => onNavigate("rules")}>返回图鉴</ComicButton>
    </section>
  );
}

function HistoryScreen({ onNavigate }) {
  const events = [
    ["刚刚", "你", "查看了未来 3 张牌", "private"], ["8 秒前", "阿橘", "打出「洗牌」", ""], ["13 秒前", "团子", "放弃否决", ""], ["20 秒前", "小灰", "抽了 1 张牌", ""], ["35 秒前", "你", "用拆弹躲过爆炸", "highlight"],
  ];
  return (
    <section className="screen screen--scroll">
      <ScreenHeader title="行动记录" eyebrow="第 8 回合" back="game" onNavigate={onNavigate} />
      <div className="history-list">{events.map(([time, name, copy, type], index) => <div className={type} key={index}><i /><span><small>{time}</small><strong>{name} · {copy}</strong>{type === "private" && <em><Lock size={12} />仅你可见</em>}</span></div>)}</div>
      <div className="history-tip"><Info size={18} weight="fill" />私密手牌和牌堆顺序不会公开</div>
    </section>
  );
}

function GameMenuScreen({ onNavigate }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="screen">
      <ScreenHeader title="对局菜单" eyebrow="ROOM #582913" back="game" onNavigate={onNavigate} />
      <div className="menu-cat"><img src={cats.player} alt="" /></div>
      <div className="menu-list">
        <button onClick={() => onNavigate("rules")}><BookOpen size={23} weight="fill" /><span><b>查看规则</b><small>卡牌、组合与平台规则</small></span><CaretRight size={20} /></button>
        <button onClick={() => onNavigate("settings")}><Gear size={23} weight="fill" /><span><b>声音与振动</b><small>不会影响其他玩家</small></span><CaretRight size={20} /></button>
        <button onClick={() => onNavigate("network")}><Info size={23} weight="fill" /><span><b>网络状态</b><small>延迟 42ms · 连接稳定</small></span><CaretRight size={20} /></button>
      </div>
      {!confirming ? <button className="danger-link" onClick={() => setConfirming(true)}>认输并离开</button> : <div className="concede-confirm"><strong>确定认输？</strong><p>你的手牌将移入淘汰区，本局无法返回。</p><div><button onClick={() => setConfirming(false)}>再想想</button><button onClick={() => onNavigate("eliminated")}>确认认输</button></div></div>}
      <ComicButton className="bottom-cta" tone="cream" onClick={() => onNavigate("game")}>返回牌桌</ComicButton>
    </section>
  );
}

function NetworkScreen({ onNavigate }) {
  const [connected, setConnected] = useState(false);
  const reconnect = () => { setConnected(false); setTimeout(() => setConnected(true), 900); };
  return (
    <section className="screen screen--network">
      <div className="network-icon"><i className={connected ? "connected" : ""} /><i className={connected ? "connected" : ""} /><i className={connected ? "connected" : ""} /></div>
      <span className="response-kicker">对局仍在服务器继续</span>
      <h1>{connected ? "已重新连接" : "正在找回牌桌…"}</h1>
      <p>{connected ? "状态已同步，你可以继续行动。" : "别担心，倒计时仍以服务器为准。60 秒后机器人会暂时代打。"}</p>
      <div className="sync-progress"><i className={connected ? "done" : ""} /></div>
      <strong>{connected ? "同步完成" : "正在同步第 8 回合"}</strong>
      {connected ? <ComicButton className="bottom-cta" onClick={() => onNavigate("game")}>回到牌桌</ComicButton> : <button className="retry-link" onClick={reconnect}>立即重试</button>}
    </section>
  );
}

function SettingsScreen({ onNavigate }) {
  const [sound, setSound] = useState(true);
  const [vibrate, setVibrate] = useState(true);
  return (
    <section className="screen">
      <ScreenHeader title="设置" eyebrow="让猫安静一点" onNavigate={onNavigate} />
      <div className="settings-profile"><CatAvatar src={cats.player} size="lg" /><div><strong>蓝耳队长</strong><span>ID 582913</span></div><button>编辑</button></div>
      <div className="settings-list">
        <button onClick={() => setSound(!sound)}><span>{sound ? <SpeakerHigh size={22} weight="fill" /> : <SpeakerSlash size={22} weight="fill" />}音效</span><i className={sound ? "on" : ""}><b /></i></button>
        <button onClick={() => setVibrate(!vibrate)}><span><Gear size={22} weight="fill" />震动反馈</span><i className={vibrate ? "on" : ""}><b /></i></button>
        <button onClick={() => onNavigate("tutorial")}><span><BookOpen size={22} weight="fill" />重看教学</span><CaretRight size={20} /></button>
        <button onClick={() => onNavigate("rules")}><span><Info size={22} weight="fill" />规则与版本</span><CaretRight size={20} /></button>
      </div>
      <div className="legal-note">原创概念设计 · 不含任何官方美术<br />Prototype v0.1</div>
    </section>
  );
}

const screenMap = {
  login: LoginScreen,
  home: HomeScreen,
  "play-mode": PlayModeScreen,
  create: CreateRoomScreen,
  join: JoinRoomScreen,
  lobby: LobbyScreen,
  "lobby-member": LobbyMemberScreen,
  game: GameScreen,
  "other-turn": OtherTurnScreen,
  response: ResponseScreen,
  favor: FavorScreen,
  "give-card": GiveCardScreen,
  defuse: DefuseScreen,
  future: FutureScreen,
  explosion: ExplosionScreen,
  "attack-debt": AttackDebtScreen,
  eliminated: EliminatedScreen,
  result: ResultScreen,
  tutorial: TutorialScreen,
  rules: RulesScreen,
  "card-detail": CardDetailScreen,
  history: HistoryScreen,
  "game-menu": GameMenuScreen,
  network: NetworkScreen,
  settings: SettingsScreen,
};

function getScreenFromHash() {
  const hashScreen = window.location.hash.replace(/^#gallery\/?/, "").replace(/^#/, "");
  return screenMap[hashScreen] ? hashScreen : "home";
}

function GalleryNav({ current, onNavigate, collapsed, setCollapsed }) {
  return (
    <aside className={`gallery-nav ${collapsed ? "collapsed" : ""}`}>
      <div className="gallery-brand"><span>炸毛<br />危机</span><button onClick={() => setCollapsed(!collapsed)}>{collapsed ? <CaretRight size={20} /> : <X size={20} />}</button></div>
      {!collapsed && <>
        <p>全流程设计稿 · 390×844</p>
        {navGroups.map((group) => <nav key={group.label}><b>{group.label}</b>{group.items.map(([id, label]) => <button key={id} className={current === id ? "active" : ""} onClick={() => onNavigate(id)}><span>{label}</span><CaretRight size={15} /></button>)}</nav>)}
        <div className="gallery-legend"><i /><span>爆裂漫画工坊<br /><small>25 个交互界面</small></span></div>
      </>}
    </aside>
  );
}

export function App() {
  const [screen, setScreen] = useState(getScreenFromHash);
  const [params, setParams] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const ScreenComponent = useMemo(() => screenMap[screen] || HomeScreen, [screen]);

  useEffect(() => {
    const syncScreenWithHash = () => setScreen(getScreenFromHash());
    syncScreenWithHash();
    window.addEventListener("hashchange", syncScreenWithHash);
    return () => window.removeEventListener("hashchange", syncScreenWithHash);
  }, []);

  const navigate = (next, nextParams = {}) => {
    window.location.hash = `gallery/${next}`;
    setScreen(screenMap[next] ? next : "home");
    setParams(nextParams);
  };
  return (
    <div className="prototype-stage">
      <GalleryNav current={screen} onNavigate={navigate} collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="phone-wrap">
        <div className="mobile-prototype">
          <ScreenComponent onNavigate={navigate} params={params} />
        </div>
        <div className="viewport-label">390 × 844 · 可点击设计稿</div>
      </div>
    </div>
  );
}
