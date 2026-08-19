# 服务实现审查报告

> 审查日期:2026-08-19
> 审查范围:`apps/game-server`(权威服务端全部模块:auth/room/match/deadline/persistence/transport)+ `packages/game-core`(规则内核)+ `packages/protocol`(传输协议)+ `packages/session-client`(客户端会话层)+ `apps/minigame` 中调用服务的部分(WxAuth、WxSocketTransport、RemoteGameSession 等鉴权/会话/传输适配器)。
> **不在范围内**:`prototype/`(仅设计基准)、`apps/minigame` 的 Canvas 渲染/场景 UI/资源管线等与服务调用无关的部分。
> 审查方法:5 轮独立深度审查 —— 4 个并行的分区域审查(服务端请求管道;对局/房间/定时器/持久化事务核心;规则内核+协议包;客户端会话层+小游戏服务调用层)+ 1 个跨领域协调 / STRIDE 安全扫描 / 验收矩阵映射复核。覆盖架构合规性、安全性、并发与数据一致性、代码质量与测试覆盖四个维度。所有发现均基于实际代码追踪与可复现的测试/命令证据,而非猜测。原始分区域报告(含逐行代码引用)保存在本地 `tmp/service-review/*.md`(未纳入版本控制,如需完整取证细节可临时恢复审查过程)。

## 总体结论

代码库工程纪律总体较高:对局命令流水线(match command pipeline)的单事务原子性、行锁、幂等性和 revision 冲突检测均正确实现并有专门回归测试;卡牌不透明 token 轮换机制正确且有测试锁定;隐藏信息投影(`PlayerView`)、协议 schema 白名单校验、生产环境启动防护(密钥长度、dev-auth 禁用、无密钥泄漏)均扎实;56 张牌守恒、Attack 欠回合公式、Nope 链、组合技等规则正确性也已验证。

但发现了 **1 项严重级别、且已证实可被房主稳定复现触发**的数据一致性缺陷(房间类命令幂等性缺失),以及 **4 项高优先级**问题——其中三项都指向"文档中已知承认、但代码零缓解"的速率限制/连接数上限缺失,叠加连接重连时的级联广播机制后,会放大成真实的拒绝服务风险。此外还有一批中低优先级的测试覆盖缺口、纵深防御加固点和文档-代码不一致之处。

**共发现 32 项问题**(1 严重 / 4 高 / 13 中 / 9 低 / 3 仅供参考),另有 2 项经跨领域复核后从"疑似严重"降级确认为"当前无实际风险,但值得加固"。

## 优先级修复清单

### 🔴 P0 — 建议在任何生产发布前修复

#### 1. 房间类命令(AddBot/CreateRoom/StartMatch/RestartMatch/RemoveBot/StartTutorial)缺少事务级幂等保护,已证实可被房主稳定复现触发

**Severity: Critical(F-TXN-01 + F-XCUT-02)| 位置**:`apps/game-server/src/transport/sessionGateway.ts:91-115`、`apps/game-server/src/room/roomCoordinator.ts`(`addBot`/`create`/`#startRoom`/`removeBot` 等)

对局(match)命令的幂等检查在 `MatchCoordinator.execute()` 内部、与状态变更**同一行锁事务**中完成,已验证正确且有回归测试锁定。但房间(room)命令走的是 `SessionGateway.command()` 的通用 `session_command_receipts` 检查——这个检查发生在锁**之外**,且 `RoomCoordinator` 本身完全不感知 `commandId`。

结果:同一 `commandId` 的重复请求(**不需要进程崩溃**,普通的客户端超时重发或并发请求即可触发)可能导致:
- **重复生效**:如 `addBot` 无条件在每次调用时追加一个新 Bot,两次并发的 "AddBot" 请求会加入两个 Bot 而不是一个;
- **永久记录错误回执**:`create`/`#startRoom`/`startTutorial` 在状态已变更后重放会抛出 `ALREADY_IN_ROOM`/`MATCH_ALREADY_STARTED` 等业务错误,而 `saveCommandReceipt` 使用"先到先得"的 upsert——这个失败回执会被**永久保存**,即使该操作事实上已经成功。

更严重的是,跨领域复核(F-XCUT-02)证实这**不是理论上的小概率竞态**:同一玩家的鉴权 token 可重复用于任意多个并发 WebSocket 连接(`AuthService.authenticate` 无单次使用限制),单个 socket 内的消息虽然严格串行(`messageQueue` 链式处理),但**跨 socket 完全不做互斥**。因此任意房主只需开启几个并发连接、在每个连接上发送相同 `commandId` 的 `AddBot`/`StartMatch` 指令,即可在当前代码下**稳定、可控地复现**这个缺陷——不依赖任何时序运气,不需要特殊工具。

值得注意:`JoinRoom`/`LeaveRoom` 已经在领域层做到了幂等(`join()`:已是成员则直接返回;`leave()`:已不在房间则返回安全的 HOME 快照),说明代码库里已经有正确模式,只是没有统一应用到其余房间命令。房间人数上限(2-5 人)本身在协议层和 `join`/`addBot` 层各自独立强制,所以这个缺陷不会导致房间人数突破上限,但仍会导致"多出一个不该存在的 Bot"或"永久错误的客户端命令历史"。

**影响**:破坏"无重复处理、无状态损坏"这一并发设计的核心保证。目前**没有任何自动化测试覆盖这个场景**(`scopeGapFixes.test.ts` 现有的两个测试与此无关;`coordinators.test.ts` 里对应的"崩溃后恢复"测试只覆盖了安全的 match 命令路径)。同时(见 P2 #6)房间命令没有任何审计记录,一旦触发,运维/客服无法追溯发生了什么。

**建议修复**:参照 `MatchTransaction.findReceipt`/`saveReceipt` 的模式,给 `RoomCoordinator` 增加自己的事务内 `(actorId, commandId)` 幂等检查(例如新增 `room_command_receipts` 表,在 `transactRoom` 同一行锁下检查+写入)。过渡阶段,至少应让 `addBot`/`removeBot`/`start`/`restart`/`startTutorial`/`create` 都采用 `join()`/`leave()` 那种"先检查目标状态再决定是否变更"的幂等写法。同时需要补充回归测试:模拟 `rooms.addBot()` 直接调用(视为"已生效"),再通过 `gateway.command()` 用同一 `commandId` 重放,断言不会二次生效且返回原结果。

**文档更正需求**:`docs/ACCEPTANCE.md` 中"幂等 | 房间业务提交与通用会话回执之间的崩溃窗口 | 部分;已记录"这一行低估了实际缺陷——它把问题描述成"崩溃后回执缺失",但实际是"无需崩溃、可被主动触发的重复生效或永久错误回执"。同一矩阵里"幂等 | 相同 commandId 返回原结果,复用不同 payload 被拒绝 | 必须"这一行对 match 命令成立,但对房间命令不成立,矩阵未做区分。详见下方"文档准确性问题"。

---

### 🟠 P1 — 高优先级,建议尽快修复

#### 2. 重连/连接量放大成拒绝服务风险
**Severity: High(F-XCUT-01)| 位置**:`apps/game-server/src/app.ts`、`transport/connectionHub.ts`、`transport/sessionGateway.ts::broadcast`、`persistence/mysqlStore.ts::observePlayerSnapshot`、`main.ts:19-21`

每次 WebSocket 认证成功都会触发 `setConnected` 事务 + `broadcast()`(遍历房间内每个非 Bot 成员,**每个成员各自开一个独立数据库事务**调用 `observePlayerSnapshot`)+ 重连方自己的 `resume` 事务。一次 5 人房间的重连即可产生 10+ 次数据库往返、占用最多 6 个独立连接池连接,且这部分开销完全不计入现有的每连接消息计数器(该计数器只在 `handleMessage` 内生效,而这条级联发生在鉴权成功后、消息处理之前)。而生产 MySQL 连接池固定为 20(`main.ts:19-21`),且**没有任何单玩家/单 IP 并发连接数上限**——`ConnectionHub.add()` 无条件把新连接加入集合,不会关闭同玩家的旧连接。叠加下一条(无速率限制)和"鉴权 token 可重复用于任意多个连接",攻击者可用适度的重连爆发耗尽整个连接池,拖累所有玩家和房间的正常请求。

**建议修复**:限制单玩家并发 WS 连接数(新连接到达时关闭旧连接,复用现有的同 socket rebind 逻辑但改为跨 socket 生效);对新连接建立做限流;考虑合并/防抖同一房间连续 connect/disconnect 事件触发的 `broadcast()` 调用;评估 `observePlayerSnapshot` 是否可以合并进已有事务以减少连接池占用。

#### 3. HTTP 鉴权接口与 WS 连接建立完全没有速率限制
**Severity: High(F-SRV-01)| 位置**:`apps/game-server/src/app.ts:38-56`(`/v1/auth/dev`、`/v1/auth/wechat`)、`app.ts:69-101`(WS 连接建立)

唯一的限流是已鉴权 WS 连接内的 30 条/秒消息计数器(且如下条 #10 所述可被重连绕过)。非可信头模式下 `/v1/auth/wechat` 每次请求都会调用微信 `jscode2session`(8 秒超时),可被空转造成资源与配额消耗;`DEV_AUTH_ENABLED=true` 的环境(非生产,但真实存在于测试/预发布环境)可无限铸造有效会话;WS 端点本身也没有连接建立速率限制。这是文档中已经承认的待办项("生产入口仍应补充基础设施级速率限制与滥用防护"),但目前代码零缓解,且如 #2 所示,这不仅是"消息量"问题,还会放大成连接池耗尽风险。

**建议修复**:引入 `@fastify/rate-limit`(或等价方案)按 IP 限制 `/v1/auth/*` 与新连接建立频率。README 明确直连(非 WeChat 云托管私网)部署场景仍受支持,这类场景下这是必需项,不能仅依赖"云托管基础设施职责"这一假设。

#### 4. 登录场景在真实会话上会发送必然被拒绝的 `Login` 命令
**Severity: High(F-CLI-01)| 位置**:`apps/minigame/src/ui/sceneRegistry.ts:47`、`ui/screenHost.ts:465-500,565`、`packages/presentation-model/src/index.ts:461`、`apps/game-server/src/transport/sessionGateway.ts:51`

共享的 "login" 场景在 `DemoGameSession` 和 `RemoteGameSession` 下走同一套 UI 逻辑;在真实模式下点击会通过已鉴权的 `RemoteGameSession` 发送 `{ type: "Login", provider: "wechat", loginCode: "demo-login" }`,而服务端(`sessionGateway.ts:51`)必定以 `LOGIN_OVER_HTTP_ONLY` 拒绝。这个场景在"首个快照到达前"(`authenticated: false`,弱网重连期间可持续数秒——恰好是这个架构专门为之设计的场景)是**真实可达**的:用户可能在此期间点击登录按钮,看到一个令人困惑的"登录失败"提示,而实际上他们已经通过 HTTP 完成鉴权。

**建议修复**:在 `ScreenHost.perform()` 中将 `"Login"` 视为本地拦截意图(远端会话下可 no-op 或触发 `session.reconnect?.()`),而不是继续走 `materialize()`/`session.send()`。

#### 5. "生产环境禁止静默回退 Demo 模式"目前仅由构建脚本单点保障
**Severity: High(F-CLI-02)| 位置**:`apps/minigame/src/composition/runtime.ts:45-57`(`readRuntimeConfig`)、对照 `apps/minigame/scripts/build-environment.mjs:33-46`

`readRuntimeConfig` 中 `developerToolsWithoutServer` 分支只要"无远端配置 + 运行在开发者工具"就会强制 `forceDemo: true`,这个分支本身**不检查** `NODE_ENV`/`developmentRuntime()`。今天之所以安全,完全依赖 `build-environment.mjs` 保证生产/预览构建一定带有合法 `cloudEnvironmentId`。仓库自己的测试(`runtime.test.ts:80-89`)已经证明:手动设置 `NODE_ENV=production` 且缺少云配置时,该分支确实会静默进入 Demo 模式——这恰好违反了 `IMPLEMENTED_SCOPE.md` "缺失云环境配置会显示启动失败"的承诺,且最容易在最需要正确性的场景(微信开发者工具生产构建校验)下被忽视。

**建议修复**:让 `developerToolsWithoutServer` 分支也受 `developmentRuntime()` 门控,使运行时配置模块本身独立保证该不变量,而不仅依赖构建脚本这一个执行点。

---

### 🟡 P2 — 中优先级,建议在后续迭代中修复

| # | 发现 | 类别 | 位置 | 摘要 |
|---|---|---|---|---|
| 6 | F-XCUT-03 | Repudiation | `room/roomCoordinator.ts` 全部变更方法 | 房间类命令(建房/加房/踢人/开局等)完全没有审计记录;`appendAudit` 目前只被 match 命令调用。一旦 #1 触发,运维/客服无从排查"这个房间为什么有 6 个成员"。建议参照 `match_events` 增加轻量级 `room_events` 表,与房间行更新同一事务写入。 |
| 7 | F-CORE-01(复核后由 Critical 降级) | Architecture-Compliance | `packages/game-core/src/index.ts:198,206,278,294` | 规则内核的领域事件(`KITTEN_REINSERTED.position`、`DECK_SHUFFLED.cardIds`、`PRIVATE_PEEK_GRANTED.cardIds`、`CARD_DRAWN.cardId`)本身携带了文档明确禁止出现在审计/日志中的隐藏信息。**跨领域复核证实今天不存在真实泄漏**——`sanitizeAudit`(白名单式重建对象,而非 spread)、`match_events` 表结构(物理上只有 6 列,无法存储这些字段)、以及 wire 协议 `parseSnapshotEvent` 的字段白名单,三层独立防护均已确认生效,且未发现任何日志语句、debug 路由或错误序列化路径会转发原始事件对象。但这个安全性质是"三份需要分别维护的白名单恰好都没漏"这种涌现属性,而不是内核从源头上就不产生敏感字段——建议在内核边界本身做脱敏(只保留 count 等非标识信息),让保证从"结构上不可能"变成现实,而不是依赖"目前每个消费者都记得脱敏"。 |
| 8 | F-TXN-03 | Concurrency/Architecture-Compliance | `transport/connectionHub.ts` | 进程内连接广播没有任何机制探测"意外多实例部署"——如果真的水平扩容而未加跨实例通知总线(文档已声明这是扩容前提),故障表现为**静默丢失推送**而非报错,难以定位。建议加启动期断言/日志(如按副本数环境变量做校验)。 |
| 9 | F-TXN-04 | Test-Coverage | `scopeGapFixes.test.ts` | 与 #1 直接相关:目前唯一的"崩溃窗口恢复"回归测试只覆盖 match 命令路径,房间命令路径的重复生效/错误回执场景零覆盖。应与 #1 的修复一起补测试。 |
| 10 | F-SRV-02 | Security | `app.ts:73-74,110-112` | 现有的每连接 30 条/秒节流器作用域是单个 socket 实例,重连即重置计数,对"简单重连绕过限流"提供不了真实防护。 |
| 11 | F-CLI-03 | Concurrency/UX | `packages/session-client/src/index.ts` `#sendOne` | 传输层发送失败或 ack 超时时,调用方 Promise 会 resolve 为"失败"(`retryable:true`),但 outbox 并不清空,命令会在下次重连时静默后台重试。用户看到"操作失败"提示后,该操作却可能在后台真的成功了,UI 无法感知这个后续结果,容易困惑或导致不必要的手动重试(不会造成数据损坏,因为单命令 outbox 本身是安全的,但体验上会误导用户)。 |
| 12 | F-PROTOCOL-01 | Security(纵深防御) | `packages/protocol/src/index.ts` `parseOwnedCard` | wire 协议的 `token` 字段只校验是 1-256 字符的字符串,没有格式/熵值约束(如固定长度十六进制),无法在 schema 层面拦截"不小心把内部 id 当 token 发出"这类回归——即便当前审查已确认服务端未犯这个错误(见"已验证合规"),schema 层缺少这道防线。 |
| 13 | F-SRV-03 | Test-Coverage | `auth/authService.ts` `WechatCode2SessionProvider` | 真实 `jscode2session` 兑换路径(所有非云托管可信头模式的生产部署都会用到)零测试覆盖,URL 构造、超时、微信侧错误码、异常 openid 等场景均无回归保护。 |
| 14 | F-CORE-05 | Test-Coverage | `packages/game-core/src/index.test.ts` | SKIP 牌没有直接单元测试;`validateAction` 约 10 个失败分支里只有 2 个被直接断言覆盖。 |
| 15 | F-CORE-06 | Test-Coverage | `packages/game-core/src/random.ts` | 手写的 SHA-256/ChaCha20 已通过标准测试向量独立验证为**当前正确**,但仓库里没有对应的回归测试锁定这个正确性——现有测试只验证自洽性(可重放),未来重构可能悄悄引入偏差而不被发现。 |
| 16 | F-PROTOCOL-04 | Test-Coverage | `packages/protocol/src/index.test.ts` | `CreateRoom`/`JoinRoom`/`PlayNope`/`InsertKitten`/`UpdateSettings` 等多个 `ClientAction` 变体缺少专门的正向/负向测试,以及 `LOBBY`/`FINISHED` 阶段限定字段集的测试。 |
| 17 | F-CLI-04 | Test-Coverage | `packages/session-client/src/index.test.ts` | 作为架构文档明确点名的"四个深模块"之一,`session-client` 只有 3 个测试;`LocalGameSession`、ack 超时路径、传输失败路径、命令进行中收到快照的交织场景均无覆盖(#11 正是因此未被现有测试捕获)。 |
| 18 | F-CORE-03 | Code-Quality | `packages/game-core/tsconfig.json:9` | 显式关闭了共享基线要求的 `noUncheckedIndexedAccess`;强制打开后暴露约 50 处潜在的未检查索引访问(`index.ts`/`random.ts`)。这恰好是最容易在手牌/牌堆索引、自实现 PRNG 缓冲区索引里捕获"差一"类 bug 的编译期检查,建议移除覆盖并逐一修复暴露出的位置。 |

---

### 🟢 P3 — 低优先级 / 代码质量与文档一致性

| # | 发现 | 位置 | 摘要 |
|---|---|---|---|
| 19 | F-TXN-02 | `persistence/mysqlStore.ts::claimDueDeadlines` | 文档写的是 `FOR UPDATE SKIP LOCKED`,实际实现是普通 `FOR UPDATE` + 租约列(`deadline_lease_until`)。单实例下功能等价,但文档与代码不一致;未来若照抄代码到多实例场景,行为(阻塞而非跳过)会和文档预期不同。 |
| 20 | F-TXN-05 | `sessionGateway.ts` / `matchCoordinator.ts` | 两处独立实现了完全相同的"规范化 JSON 指纹"算法,目前一致但存在漂移风险,建议抽成共享函数。 |
| 21 | F-CORE-04(复核后由 Medium 降级) | `packages/game-core/src/index.ts` | 内核自身的 256 条命令结果缓存会被裁剪,但跨领域复核已证实 `MatchCoordinator` 的数据库级 `command_receipts` 检查(无裁剪、无 TTL)总是先于内核调用执行(生产环境唯一两个内核入口 `execute()`/`executeDeadline()` 均如此),因此内核这层缓存是冗余的纵深防御,不承担生产正确性责任。建议在代码注释/README 中明确标注这一点,避免未来有新调用方误以为内核缓存本身是权威的幂等保证。 |
| 22 | F-PROTOCOL-03 | `packages/protocol/src/index.ts` `parseProblem` | `problem.message` 等自由文本字段只做长度/类型校验,不做内容校验,理论上不能阻止未来某个调用方把敏感状态拼进错误消息。 |
| 23 | F-CLI-05 | `apps/minigame/src/ui/screenHost.ts:415,565` | `UpdateSettings` 在"始终允许本地处理"的集合里有一条不可达的重复项(功能上无影响,`UpdateSettings` 已在更早处被拦截),属于可读性问题。 |
| 24 | F-CLI-06 | `apps/minigame/src/platform/auth.ts` | 客户端没有主动检测微信基础库版本(生产要求 ≥2.23.0),低版本设备上会看到通用错误提示而非"请升级微信"的明确指引。 |
| 25 | F-CLI-07 | `packages/session-client/src/index.ts` | "resume 消息一定先于业务命令发出"目前依赖 `WxSocketTransport` 同步派发 `socket.send()` 这一实现细节,没有显式状态守卫锁定,重构存在悄悄破坏此顺序保证的风险。 |
| 26 | F-SRV-04 | `apps/game-server/src/app.ts:44-56` | `/v1/auth/wechat` 把所有错误类型统一映射成 HTTP 401,配置错误(语义上应为 5xx)、参数缺失(应为 400)在 HTTP 状态码层面不准确(响应体里的机器可读 `code` 字段本身仍然正确,主要影响依赖状态码分类的监控面板)。 |
| 27 | F-SRV-06 | `config.test.ts`/`logging.test.ts` | 部分代码注释中做出的具体承诺(如"日志序列化器绝不输出请求头")缺少直接测试锁定;`AUTH_SECRET` 短密钥在非生产分支下的校验、`PORT`/`DEADLINE_POLL_MS` 非法值也未测试。 |

**仅供参考,无需处理(Info)**:
- **F-TXN-06**:定时器与命令的竞争已通过共享行锁正确处理,只是缺少专门测试显式锁定这个场景,不是功能缺陷。
- **F-PROTOCOL-02**:协议版本双版本兼容机制在 v1 正式发布前本就不需要,当前的硬性版本拒绝符合文档预期。
- **F-SRV-05**:`WECHAT_TRUST_CLOUD_HEADERS` 可信头模式的信任边界完全是运维/网络拓扑层面的(依赖云托管网关剥离客户端伪造的 `X-WX-*` 头),代码已按文档设计实现,这是一个正确记录的固有信任边界而非代码缺陷。可选加固:启动时打印一条警告级日志,让"当前处于可信头模式"这个关键决策在生产日志第一时间可见。

## 文档准确性问题

跨领域审查发现以下文档描述与实际代码行为存在落差,建议在处理上述缺陷的同时一并修正:

1. **`docs/ACCEPTANCE.md`**:"幂等 | 相同 commandId 返回原结果,复用不同 payload 被拒绝 | 必须"这一行对 match 命令成立(有 DB 级无裁剪的权威检查),但对房间命令不成立(见 P0 #1),矩阵目前未做区分,应拆分为两行分别标注状态。
2. **`docs/ACCEPTANCE.md`**:"幂等 | 房间业务提交与通用会话回执之间的崩溃窗口 | 部分;已记录"低估了实际缺陷的性质——实际是"无需崩溃、可被房主主动稳定复现"的重复生效/永久错误回执缺陷,建议重写描述并将自动化测试列标注为"无"/"已知失败"直至修复。
3. **`docs/ACCEPTANCE.md`**:"房间 | 建房、入房、准备、Bot、仅房主开局 | 必须"这一行的自动化测试目前只覆盖 happy path,应补注"已知幂等性缺口未覆盖,见 F-TXN-01"。
4. **`docs/ARCHITECTURE.md`** 中对该崩溃窗口的叙述("后续应把房间命令执行与会话回执纳入统一事务边界")同样需要更新为反映"非崩溃触发、可主动复现"这一更严重的定性,而不是仅描述为低概率的崩溃时序问题。

## 已验证合规的亮点

审查过程中也确认了大量正确、扎实的实现,决定修复优先级时值得一并参考——这不是一个整体质量堪忧的代码库,而是在一个总体扎实的基础上存在若干需要收口的具体缺口:

- **对局命令流水线完全正确**:单事务六步序列(鉴权绑定 → 行锁 + 回执检查 → 解析 token 注入身份时间 → 执行内核 → revision+1/快照/回执/审计 → 提交后广播)全部在同一事务内完成并有专门测试锁定;两个并发命令、命令与定时器同时到达等场景均已逐一验证安全。
- **卡牌不透明 token 机制正确**:`match/projection.ts` 的 `reconcileCardTokens` 使用 `randomUUID()` 为每张进入手牌的牌生成新 token,离手立即失效、换主人必换 token,内部 `Card.id` 在类型层面就不可能出现在 wire 协议里,并有专门回归测试(`!("id" in card)`)断言。
- **隐藏信息投影正确**:`PlayerView` 不包含牌堆顺序、对手手牌、RNG 状态;拆弹私密插入位置在客户端可见的投影里也不会暴露;审计事件的隐藏信息(见 P2 #7)经三层独立验证今天不会外泄。
- **协议校验严格**:所有字段走白名单式 `exact()` 校验,伪造 `actorId`/`sentAt`/`DeadlineElapsed` 系统命令、非法 `protocolVersion` 均被拒绝且有测试锁定。
- **牌局规则正确性**:56 张牌守恒(每次命令后校验)、2/3/4/5 人对应 35/29/23/16 张牌的开局配方、Attack 欠回合公式、Nope-of-Nope 链、pair/triple 组合技均已验证与规则文档一致。
- **生产启动防护到位**:`AUTH_SECRET` 长度、MySQL 配置完整性有硬编码强制 + 测试锁定;`/v1/auth/dev` 生产环境无论如何配置都会返回 404;日志/错误响应中未发现任何密钥(`AUTH_SECRET`/`WECHAT_APP_SECRET`/数据库密码)泄漏路径。
- **客户端结构性安全**:`ClientAction` 从类型层面就不可能携带 `actorId`/服务器时间等禁止字段;Bearer token 只作为建连后第一条 `resume.resumeToken` 发送,从未出现在任何 URL 中(含开发直连兜底路径),有专门测试锁定。
- **房间人数上限正确**:2-5 人的限制在协议层(`CreateRoom` schema)和房间协调器层(`join`/`addBot` 各自独立检查)双重强制,即使遇到 P0 #1 的重复生效缺陷也不会突破上限。
- **未发现 SQL 注入风险**:所有查询均使用参数化占位符;唯一的原始 SQL 拼接(数据库名)有正则白名单 + `escapeId` 双重防护。
- **房主权限校验抗竞态**:`assertHost`/`assertMember` 均在同一行锁事务内针对最新状态校验,主机转移(玩家离开时)与并发操作请求之间的竞态已验证安全,不存在越权窗口。
- **健康检查接口不泄漏内部状态**:`/health/live`、`/health/ready` 均只返回极简状态字段,不会向未鉴权调用方暴露数据库错误细节或内部状态。

## 建议的后续步骤

如果决定启动修复 mission,建议按以下顺序分阶段:

1. **M1(阻断项)**:修复 P0 #1(房间命令幂等性)+ 补充回归测试(P2 #9)+ 补充房间审计日志(P2 #6)——这三者紧密相关,建议作为一个整体交付并做端到端并发场景验证(多连接同 commandId 竞争测试)。
2. **M2(加固)**:P1 剩余四项(#2 重连放大 DoS、#3 速率限制缺失、#4 登录场景 UX bug、#5 Demo 回退防线)——均为边界清晰、可独立并行修复的项目。
3. **M3(测试覆盖与代码质量)**:P2 中的测试覆盖类发现(#13/#14/#15/#16/#17)+ P3 全部项 + 上述文档更正,可合并为一到两个收尾性质的迭代。

需要您决策的点:
- **P0 #1 是否视为发布阻断项**——个人建议是,因为已证实可被房主主动、稳定触发,而不是理论上的低概率风险。
- **是否现在启动正式的修复 mission**——如果启动,我会据此重新设计 milestone、编写 validation contract(每条建议修复都会转化为可验证的行为断言)并分配 worker;如果您想先自行消化这份报告、调整优先级或范围,也可以稍后再启动。
