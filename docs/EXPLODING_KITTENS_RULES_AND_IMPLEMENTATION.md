# 《爆炸猫咪》规则基线与微信端实现方案

> 文档状态：实施基线<br>
> 规则基线：`original-2025@1`<br>
> 调研日期：2026-08-12<br>
> 目标载体：微信小游戏（正式产品）；普通微信小程序可作为低保真验证壳

## 1. 结论先行

首版只实现官方 **Exploding Kittens: Original Edition 2025** 基础规则，2-5 人，56 张牌，不混入 Party Pack、2-Player Edition、旧版“五种不同牌”组合或任何扩展牌。

正式产品采用：

- 微信原生小游戏 + TypeScript + `minigame-canvas-engine`：Flex 风格 UI、触摸、滚动和九宫格资源；牌桌高频动画封装在局部 Canvas2D 表面；
- Node.js + TypeScript 模块化单体：WSS、认证、房间、权威规则、计时和重连；
- 纯 TypeScript `game-core`：确定性状态机，不依赖微信、渲染器或网络；
- PostgreSQL：权威快照、命令回执、审计事件和可恢复截止时间；Redis 只在连接路由成为实测瓶颈后引入；
- React/Vite 原型继续作为交互和视觉回归基准，不进入小游戏生产包。

不采用 Cocos Creator 作为首版前置依赖。当前产品是 UI 密集的 2D 回合制卡牌游戏，不需要物理、地图、3D 或完整场景编辑器；轻量 Canvas UI 足以覆盖首版。若真机 PoC 证明牌桌动画无法达到目标，再只替换 `CardTableSurface` 的渲染 adapter，不改规则、协议、会话或页面模型。

## 2. 官方规则基线

### 2.1 游戏目标与基本流程

- 2-5 人，最后一名未爆炸的玩家获胜。
- 玩家顺时针行动。自己的一个回合是：先打出任意数量的牌（也可以不出），最后从抽牌堆顶抽 1 张牌。
- 抽到“爆炸猫咪”时必须立即展示。若不能打出“拆弹”，该玩家被淘汰。
- 若打出“拆弹”，拆弹进入弃牌堆；玩家秘密地把该爆炸猫咪插回抽牌堆任意位置，不重排、不查看其他牌，然后该回合立即结束。
- 未拆弹而淘汰时，爆炸猫咪正面和其余手牌背面留在该玩家面前，均不进入弃牌堆。
- 手牌没有上限或下限；零手牌不会触发补牌。抽牌堆中的爆炸猫咪数量始终足以淘汰除一人外的所有玩家。

### 2.2 开局

1. 从 56 张牌中暂时移出 4 张爆炸猫咪和 6 张拆弹。
2. 每名玩家先获得 1 张拆弹。
3. 将普通牌洗混，每人再发 7 张；每名玩家起手共 8 张。
4. 剩余拆弹中，向抽牌堆洗入至多 2 张：2-4 人洗入 2 张，5 人只有 1 张可洗入；其余移出本局。
5. 向抽牌堆洗入 `玩家人数 - 1` 张爆炸猫咪，其余爆炸猫咪移出本局。
6. 随机或由房主设置第一位玩家，之后顺时针进行。

标准局完成初始化后，2/3/4/5 人的抽牌堆分别为 35/29/23/16 张；这组数字应作为卡组配方的快照测试。

官方另给出 2/3 人“快速局”变体：在放回爆炸猫咪前，随机移出约三分之一普通牌，再加入正确数量的爆炸猫咪。它不是首版默认规则，可在后续作为房间开关。

### 2.3 2025 基础版牌表

| 牌 | 数量 | 规则效果 | 数字实现重点 |
|---|---:|---|---|
| 爆炸猫咪 Exploding Kitten | 4 | 抽到立即展示；拆弹或淘汰 | 不能主动打出、不能被 Nope；服务器处理抽牌结果 |
| 拆弹 Defuse | 6 | 代替死亡，秘密插回爆炸猫咪；回合结束 | 不能被 Nope；需要私密“插入位置”选择与超时默认值 |
| 否决 Nope | 5 | 在动作开始前取消该动作；可以 Nope 另一张 Nope | 不能取消爆炸猫咪或拆弹；可取消组合；已打出的牌仍弃置 |
| 攻击 Attack (2x) | 4 | 自己不抽牌并结束回合；下一人欠 2 个回合 | 遭 Nope 后仍是原玩家回合；欠回合用整数表示 |
| 帮忙 Favor | 4 | 指定一名其他玩家，由对方自行选择给你 1 张牌 | 目标与赠牌为两阶段选择；目标无牌时的处理需产品规则见 4.3 |
| 洗牌 Shuffle | 4 | 随机洗混抽牌堆 | 服务器权威 PRNG；Nope 窗关闭前不执行 |
| 跳过 Skip | 4 | 不抽牌，立即完成当前一个回合 | 处于攻击时仅抵消 1 个欠回合；两张 Skip 才能完成 2 个欠回合 |
| 预见未来 See the Future (3x) | 5 | 私下查看抽牌堆顶 3 张并保持原顺序 | 少于 3 张则查看实际剩余张数；结果只发给施法者 |
| 猫咪牌 Cat Cards | 20 | 5 种图案各 4 张；单独无效果 | 可参与 2/3 张组合；组合时忽略牌面文字/效果 |

合计：`4 + 6 + 5 + 4 + 4 + 4 + 4 + 5 + 20 = 56`。

### 2.4 Attack 的欠回合算法

- 普通回合打出 Attack：当前玩家不抽牌并结束行动，下一位存活玩家欠 2 个回合；若当前本来就在 Attack 批次中，则把该批次尚未完成的全部回合连同新增 2 个回合转给下一位存活玩家。
- 受攻击者在自己的任意一个欠回合中再打 Attack：其尚未完成的全部欠回合，加上新的 2 个欠回合，一并转移给下一位存活玩家。
- 官方示例：刚欠 2 回合时立即打 Attack，下一人欠 `2 + 2 = 4`；若先完成 1 回合，再于第 2 回合打 Attack，下一人欠 `1 + 2 = 3`。
- 每完成一次正常抽牌或打出一次 Skip，`turnsOwed -= 1`；仍大于零时仍由同一玩家开始下一回合。
- 打出 Defuse 后当前回合结束，按完成一个欠回合处理；若仍有欠回合则继续由该玩家行动。

因此不要只用 `isAttacked` 布尔值，也不能只存一个没有来源的数字。建议使用：

```ts
type TurnBatch = {
  remaining: number; // 正整数，包含正在进行的这一回合
  source: "NORMAL" | "ATTACK";
};
```

普通回合是 `{ remaining: 1, source: "NORMAL" }`；普通回合出 Attack 时，下家得到 `{ remaining: 2, source: "ATTACK" }`；Attack 批次中再出 Attack 时，下家得到 `{ remaining: current.remaining + 2, source: "ATTACK" }`。这样即使 Attack 批次只剩 1 回合，也能与普通的 1 回合正确区分。

### 2.5 Nope 链与响应窗口

官方桌游写法是“动作开始前，甚至不是自己回合也可出 Nope”。实时网络中必须将这个模糊的人类时机转换为明确协议：

1. 原动作牌先公开进入弃牌堆，效果暂不解析。
2. 服务端向所有存活玩家开启固定时长的 `windowId`，不泄露谁持有 Nope。
3. 窗口接受的第一张合法 Nope 进入弃牌堆并关闭旧窗口，随后为“对该 Nope 的 Nope”开启新窗口。
4. 任何存活玩家（包括原动作玩家、上一张 Nope 的玩家）均可继续 Nope。
5. 所有人 Pass 可提前关闭；否则到期自动 Pass。
6. Nope 总数为奇数时取消原动作，为偶数时执行原动作。原动作牌与全部 Nope 都留在弃牌堆。
7. 已过期 `windowId` 返回 `STALE_WINDOW`，不消耗牌；同一窗口先到服务器者优先。
8. 爆炸猫咪、拆弹不可被 Nope；普通动作牌与两张/三张组合可以被 Nope。

建议私房响应窗 5 秒，教程/单机 2 秒，竞技模式另行压测后决定。倒计时只信服务端截止时间，不信客户端时钟。

### 2.6 特殊组合（2025 版）

组合打出时忽略卡牌自身文字：

- **Two of a Kind**：两张同类型牌（不限猫咪牌）作为一个动作，指定一名其他玩家，从其手牌中随机偷 1 张。示例：两张 Shuffle、两张 Attack 均可。
- **Three of a Kind**：三张同类型牌作为一个动作，指定玩家并声明一种具体牌型；若目标持有该牌，必须交出 1 张，否则无事发生。

版本警告：旧版说明常见“仅同图案猫咪牌成对偷牌”，以及“五种不同牌从弃牌堆取任意一张”的组合。2025 官方基础版已将前两种组合扩到任何同类型牌，且当前说明书未列五异牌组合。首版不得把这些版本混在一起。

## 3. 产品范围

### 3.1 MVP 必须有

- 2-5 人邀请码私房，房主开始、准备状态、Bot 补位；
- 一套 `original-2025@1` 规则，完整牌效、组合、淘汰和结算；
- 教程局与基础 Bot；
- 微信登录换取服务端会话；
- 服务端权威牌堆/手牌，Nope 和选择倒计时；
- 退后台、断线重连、重复命令幂等、弱网提示；
- 对局事件日志、快照和受限运维回放；
- 中文原创 UI 文案、占位/自有授权美术。

MVP 暂不做：扩展包、Party Pack、快速匹配、段位、观战、聊天、支付、广告、公开全信息回放、自定义规则。

### 3.2 页面/场景

1. 首页：开始游戏、教程、规则、设置。
2. 房间：邀请码、座位、准备、Bot、规则集与计时信息。
3. 对局：玩家座位与手牌数、抽/弃牌堆、自己的手牌、行动区、事件摘要、倒计时。
4. 私密选择层：帮忙赠牌、三张组合声明、拆弹插入位置、预见未来结果。
5. 结算：名次、淘汰原因、再来一局。
6. 规则图鉴：牌效、组合、规则版本号。

## 4. 规则产品决策（开发前冻结）

### 4.1 建议默认值

| 项目 | 建议 |
|---|---|
| 规则集 | `original-2025@1` |
| 人数 | 2-5；2/3 人仍用完整牌堆，快速局为关闭的可选项 |
| Nope 窗 | 5 秒；全员显式 Pass 可提前结束 |
| 普通回合 | 45 秒；超时自动抽牌 |
| 私密选择 | 15 秒；服务端按确定性 RNG 合法代选 |
| 掉线 | 当前实现保持原玩家席位并允许重连恢复；服务端计时照常。尚未实现按离线时长 Bot 托管或自动判负 |
| 并发 Nope | 服务端接收顺序优先 |
| 认输 | 视为平台淘汰，手牌正面移入 `eliminatedZone`；不触发爆炸牌，也不进入弃牌堆 |

### 4.2 数字端必须写明、官方无需规定的规则

- 响应窗时长、超时行为、并发请求裁决；
- 目标没有手牌时，Favor/偷牌是禁止选择目标，还是动作无效；
- 玩家离开/认输后手牌与排序（这是平台补充规则，不等同于官方爆炸淘汰）；
- 最后一名玩家何时立即获胜（建议淘汰事件后原子判定）；
- 后续若引入断线托管或多设备会话，需先确定并版本化其裁决策略；当前不提供托管；
- 是否允许玩家在同一个 Nope 窗先 Pass 后再改为 Nope（建议不允许）。

### 4.3 建议的 Favor/组合边界

- Favor 只允许选择仍存活且至少有 1 张手牌的其他玩家；若无人可选，该牌不可打出。
- 两张组合同上；随机牌由服务端选择。
- 三张组合允许选择任意仍存活的其他玩家；即使没有指定牌也可打出并落空。
- 所有目标与牌型声明都在动作提交时锁定；被 Nope 后不重新选择。

这些属于数字化补充规则，应在规则页“平台规则”中透明披露。

### 4.4 版本扩展边界

- **2-Player Edition（独立牌组）**：32 张，不是从 56 张中随机裁半；牌表为爆炸猫咪 1、拆弹 3、Attack 2、Favor 3、Nope 3、Shuffle 2、Skip 3、预见未来 3、三种猫咪牌各 4。每人 1 拆弹 + 7 张，另 1 拆弹和唯一爆炸猫咪洗回，初始抽牌堆 16 张。
- **Party Pack**：2-10 人、120 张、9 张爆炸猫咪；按牌角爪印为不同人数选牌池，并加入 Targeted Attack、Alter the Future (3x)、Draw from Bottom、Feral Cat。它必须是独立 ruleset/deck recipe。
- **扩展包**：Imploding、Streaking、Barking、Zombie 等改变卡表与基础不变量，后续应以显式依赖的规则模块加载，不以客户端条件分支拼接。

### 4.5 后续三扩展摘要（不进入 MVP）

| 扩展 | 新增牌/配件 | 改变的核心规则 |
|---|---|---|
| Imploding Kittens（20 张 + 耻辱锥） | Imploding Kitten；Feral Cat；Targeted Attack；Reverse；Draw from the Bottom；Alter the Future | Imploding Kitten 第一次背面抽到后正面插回，再抽到不可 Defuse/Nope；致死猫总数仍为 `P-1`，因此最多可扩到 6 人；Feral 只能冒充猫咪牌 |
| Streaking Kittens（15 张） | Streaking Kitten；额外 Exploding Kitten；Catomic Bomb；Mark；Curse；Swap Top/Bottom；Garbage Collection；Super Skip；未来 5x | 持有 Streaking 时可安全持有 1 张爆炸猫咪，因此爆炸猫咪总数改为 `P`；Streaking 离手会触发所藏爆炸猫咪；随机偷牌和盲手会引入新的即时爆炸路径 |
| Barking Kittens（20 张 + 皇冠） | Barking Kitten；Alter Future NOW；Tower of Power；I'll Take That；Super Skip；Potluck；Bury；Personal Attack；Share the Future | 开局从牌堆移 6 张为 Stash；Tower 将所有偷取重定向至 Stash；Barking Kitten 是不可 Nope 的独立致死/消耗 Defuse 效果；与“同标题对子组合”有动作模式冲突，数字端必须显式选择模式 |

多扩展组合时，卡牌能力应数据化为 `lethal / defusable / nopeable / turnDebt / stealRedirect` 等能力，不根据牌名散落条件判断；setup 规则则按依赖顺序组合并验证最终不变量。

## 5. 深模块设计

### 5.1 外部 seam

把复杂规则放在一个深模块 `GameKernel` 后面。客户端、服务器房间与测试都只学习同一个小 Interface：

```ts
type GameKernel = {
  decide(state: CanonicalState, command: Command): DomainEvent[];
  evolve(state: CanonicalState, events: DomainEvent[]): CanonicalState;
  project(state: CanonicalState, viewer: Viewer): PlayerView;
  legalActions(state: CanonicalState, actorId: PlayerId): LegalAction[];
};
```

调用方只提交命令、接收自己的视图事件，不直接修改 `GameState`，也不知道卡牌效果、随机数或隐藏信息的内部结构。测试与生产跨过相同 seam。

### 5.2 稳定状态

```text
SETUP
  -> AWAITING_TURN_ACTION
  -> AWAITING_RESPONSE
  -> AWAITING_CHOICE
  -> AWAITING_DEFUSE_INSERTION
  -> FINISHED
```

效果解析是内核内部瞬态，一次运行到下一个稳定状态。`pending` 同一时刻最多一个：`ResponseWindow | ChoicePrompt | ExplosionPrompt`。这条不变量能显著降低 Nope、Favor、Defuse 交错时的复杂度。

### 5.3 命令

```text
StartMatch
PlayCards(cardTokens, target?, declaredCardType?)
Draw(turnId)
PlayNope(cardToken, windowId)
PassResponse(windowId)
Choose(promptId, value)
Concede
DeadlineElapsed(deadlineId) // 仅服务端内部系统命令
```

每个玩家命令必须带 `commandId`、`matchId`、目标 `turnId/windowId/promptId` 和客户端最后观察到的 `revision`。玩家身份来自认证连接，客户端不得提交或覆盖 `actorId`、服务端时间、随机结果或 `DeadlineElapsed`。重复 `commandId` 返回原回执；过期标识返回结构化错误，绝不扣牌。

### 5.4 事件

```text
MatchStarted / TurnStarted / CardsCommitted
ResponseWindowOpened / NopePlayed / ActionCancelled / ActionResolved
ChoiceRequested / CardGiven / CardStolen
CardDrawn / ExplodingKittenRevealed
DefuseConsumed / KittenReinserted
DeckShuffled / PrivatePeekGranted
PlayerEliminated / GameFinished
```

数据库事务提交成功后才广播。`MatchCoordinator` 对 `matchId` 行加锁形成逻辑单写者：验证命令 -> 生成事件 -> `revision + 1` -> 更新权威快照和截止时间 -> 写入幂等回执与审计事件 -> 提交 -> 按玩家投影视图并广播。领域事件 `sequence` 只用于审计；客户端同步使用独立 `revision`，全量快照允许跨 revision 恢复。

## 6. 隐藏信息、防作弊与恢复

- 完整状态只在服务器；客户端绝不能收到“全状态然后自己隐藏”。
- 自己看到牌面；他人只看到手牌数量；抽牌堆只显示数量。
- `See the Future` 只发送给施法者；拆弹插入位置只存在服务端私密事件。
- 卡牌对客户端使用短期 opaque token，不暴露可跨区域追踪的内部 `cardId`。
- 服务器验证所有权、时机、目标、Prompt、窗口、规则版本；客户端不提交抽牌/洗牌/偷牌结果。
- 禁止 `Math.random()`；正式牌局由服务端 CSPRNG 生成 256 位种子，再使用固定版本的确定性 PRNG。种子永不下发，随机结果写入受限事件。
- 保存 `rulesetVersion`、卡牌目录版本、内核版本、PRNG 版本、事件 schema 版本。
- 每局单调 `revision`；客户端记录最后应用的 revision。重连始终发送最新玩家专属全量快照，正确性不依赖通知历史。
- 超时记录绝对 `deadlineAt` 与 `deadlineId`；PostgreSQL 到期扫描器使用 `FOR UPDATE SKIP LOCKED` 领取并补发内部系统命令，不能只依赖进程内 `setTimeout`。
- 日志与报错也必须脱敏，避免打印对手牌、牌堆顺序和秘密插入位置。

## 7. 仓库结构

```text
exploding-kitty/
├─ apps/
│  ├─ minigame/              # 微信小游戏、Layout UI、Canvas2D 牌桌和平台 adapters
│  └─ game-server/           # HTTP/WSS、认证、Coordinator 和可靠定时器
├─ packages/
│  ├─ game-core/             # 纯 TS GameKernel 深模块（含 eliminated zone）
│  ├─ protocol/              # 版本化 wire DTO、运行时 codec 和错误码
│  ├─ session-client/        # Local/Remote GameSession、恢复和 outbox
│  └─ presentation-model/    # 严格 ClientView 到场景模型与意图
├─ prototype/                # React 视觉回归与浏览器试玩基准
└─ docs/
   └─ EXPLODING_KITTENS_RULES_AND_IMPLEMENTATION.md
```

页面只依赖 presentation model，不直接调用规则内核、具体 Canvas 引擎或 `wx.*`。平台能力集中在 adapter，牌桌集中在可替换的 `CardTableSurface`；不要在触摸处理器中复制规则逻辑。

## 8. 测试与验收

### 8.1 规则测试

- 牌数守恒：每个牌实例恰处于一个区域（手牌、抽牌堆、弃牌堆、移出区或 `eliminatedZone`），牌数永不凭空增减；
- 所有人起手 8 张，拆弹/爆炸猫咪人数公式正确；
- 每张牌的正常、非法时机、非法目标、被 Nope 场景；
- Nope 奇偶性、重复响应、过期窗口、效果只解析一次；
- Attack 为 2、叠加、完成一回合后再转移为 3；Skip 每次只清 1 个欠回合；
- Defuse 插回顶/底/中间，秘密位置不泄漏；
- 两张组合随机偷牌，三张组合命中/落空，组合可被 Nope；
- 同 seed + 同命令序列生成同事件流与状态哈希；
- 洗牌始终是原集合的排列；
- 任意玩家视图不含对手牌面、牌堆顺序或私密选择。

### 8.2 联机测试

- 两人并发 Nope、Nope 与 deadline 同时到达；
- 重复包、乱序包、旧 window/prompt、双设备登录；
- 退后台、断网、弱网、重连风暴；
- 事件追加失败、服务实例崩溃、快照恢复和超时补偿；
- 伪造 card token、越权查看、刷命令与限流；
- 批量 Bot 完整模拟至少 100,000 局，无死锁、负数计数、重复牌或无赢家。

每条正式规则应有稳定的 `ruleId`，并在测试名中引用，形成“规则 -> 场景 -> 测试”追踪表。

## 9. 迭代计划

| 阶段 | 产出 | 建议时间（小团队） | 退出条件 |
|---|---|---:|---|
| 0. 授权与规则冻结 | IP/商标/美术/文案授权结论；规则 ADR | 1 周 | `original-2025@1` 与平台补充规则签字 |
| 1. 内核 | 卡组、命令/事件、全部基础牌、回放、属性测试 | 2-3 周 | 100k Bot 局无不变量失败 |
| 2. 本地切片 | 对局 UI、教程、基础 Bot、完整一局 | 2-3 周 | 2-5 人本地局可闭环 |
| 3. 联网 MVP | 登录、邀请码房、权威服务器、计时、重连 | 3-4 周 | 弱网/退后台/并发 Nope 验收通过 |
| 4. 上线加固 | 压测、安全、监控、审核材料、灰度 | 2-3 周 | 审核与 SLO 达标 |

最早可玩的本地版本约 4-6 周；可灰度联网 MVP 约 8-12 周。时间只作量级参考，取决于美术授权、动画量和微信审核。

## 10. 主要风险

1. **知识产权**：名称、商标、卡图、角色和原文文案均可能受保护。玩法机制可研究实现不等于可以使用品牌素材；立项第一周必须确认商业授权。无授权时应使用原创名称、美术、文案与世界观，并让专业法律顾问评估整体表达是否构成侵权/混淆。
2. **版号/备案与平台合规**：正式发布前按届时中国大陆和微信小游戏政策核验游戏审批/备案、实名认证、防沉迷、未成年人、隐私和数据处理要求。
3. **规则版本漂移**：规则集与牌目录必须版本化；老对局回放永远绑定原版本。
4. **网络时机争议**：Nope 是桌游自然交互，数字端必须公开响应窗、超时和先到先得规则。
5. **信息泄漏**：开发日志、分析事件、Bot Interface 和客户端 token 都是隐藏信息风险面。

## 11. 来源与版本说明

以下均为 2026-08-12 访问：

- [官方 Instructions 索引](https://www.explodingkittens.com/pages/instructions)：用于确认官方现行产品与各版本规则入口。
- [官方 Original Edition 规则页](https://www.explodingkittens.com/pages/rules-kittens)：现行基础版入口。
- [官方 Original Edition 2025 英文说明书 PDF](https://cdn.shopify.com/s/files/1/0345/9180/1483/files/ekoe-instructions-english.pdf?v=1743802429)：本方案的规则权威来源；说明书页脚标注 `EKOE-Instructions-English-2025-04-79`，内容为 56 张牌、2-5 人。
- [官方 2-Player Edition 规则页](https://www.explodingkittens.com/pages/how-to-play-exploding-kittens-2-player)：用于确认双人专版是独立产品，未混入首版。
- [官方 2-Player Edition 2023 英文说明书 PDF](https://cdn.shopify.com/s/files/1/0345/9180/1483/files/EKG-2PLAY_Instructions_21FEB2023_3.pdf?v=1694111964)：用于核对双人独立牌表，并明确拆弹只完成一个 Attack 欠回合。
- [官方 Party Pack 规则页](https://www.explodingkittens.com/pages/rules-kittens-party)：用于划分版本边界，未混入首版。
- [官方 Party Pack 2025 英文说明书 PDF](https://cdn.shopify.com/s/files/1/0345/9180/1483/files/ekpp-instructions-english.pdf?v=1743819467)：用于核对 2-10 人分池与新增卡牌。
- [官方 Imploding Kittens 规则页](https://www.explodingkittens.com/pages/rules-imploding-kittens)、[Streaking Kittens 规则页](https://www.explodingkittens.com/pages/rules-streaking-kittens)、[Barking Kittens 规则页](https://www.explodingkittens.com/pages/rules-barking-kittens)：扩展包入口，仅作为后续规划。
- [官方 Imploding Kittens 英文说明书 PDF](https://cdn.shopify.com/s/files/1/0345/9180/1483/files/imploding-english.pdf?v=1734625756)、[Streaking Kittens 英文说明书 PDF](https://cdn.shopify.com/s/files/1/0345/9180/1483/files/EKG-2EXP_Instructions_3OCT2023-R2.pdf?v=1698873331)、[Barking Kittens 英文说明书 PDF](https://cdn.shopify.com/s/files/1/0345/9180/1483/files/EKG-3EXP_Instructions_23FEB23_Web_1.pdf?v=1759766219)：用于后续能力模型与兼容性规划。
- [旧版英文规则 PDF 存档](https://www.szellemlovas.hu/szabalyok/robbanocicakEN.pdf)：仅用于证明旧版曾包含 Five Different Cards；它不是当前官方基线。

当第三方中文译名与官方英文发生冲突时，引擎 `cardType` 使用稳定英文枚举，中文仅是可替换的本地化资源。不要直接复制官方卡面、插图或大段文案进仓库。
