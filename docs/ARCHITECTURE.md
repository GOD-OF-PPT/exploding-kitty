# 正式产品架构

> 决策日期：2026-08-13<br>
> 载体：微信小游戏<br>
> 状态：实施中

## 架构目标

首版要在不引入完整游戏引擎和分布式平台的前提下，实现 2-5 人隐藏信息卡牌对局、弱网重连、权威计时、三步规则说明、权威教学局引导和 25 个产品界面。复杂性集中在四个深模块后面：

```text
ScreenHost -> GameSession -> WxSocketTransport -> MatchCoordinator -> GameKernel
                                              \-> PostgreSQL
```

- `GameKernel` 隐藏牌效、随机、稳定状态与玩家投影；
- `GameSession` 隐藏本地/远端差异、命令确认、恢复和单命令 outbox；
- `ScreenHost` 隐藏 Canvas 布局、输入、资源和页面生命周期；
- `MatchCoordinator` 隐藏认证绑定、单写、幂等、时钟、持久化和私有广播。

## 客户端

小游戏使用 TypeScript 和 `minigame-canvas-engine`。它提供微信小游戏原生 Canvas 适配、Flex 风格布局、文本、触摸、滚动和九宫格图片。产品只封装实际需要的页面模块，不建设通用 UI 框架。

- 固定 390 x 844 逻辑设计坐标，再映射安全区、窗口尺寸和 DPR；
- 漫画边框、撕纸、网点和复杂阴影预烘焙为纹理；
- `CardTableSurface` 使用局部 Canvas2D 绘制手牌扇形和牌堆动画；
- 页面状态来自纯 presentation model；页面不直接解释牌效；
- `WxAuth`、`WxSocketTransport`、`WxSessionRepository`、`WxKeyboard`、`WxAudio`、`WxHaptics` 和 `WxShare` 封装平台调用；
- 三步教程说明是客户端页面状态；最后一步通过 `RemoteGameSession` 发送 `StartTutorial`，服务端创建带 Bot 和固定教学 seed 的权威教学局。客户端依据快照中的 `room.tutorial` 展示渐进提示，不在本地运行教学局规则；显式开发 Demo 才使用本地演示会话。

如果真机验证发现局部 Canvas2D 动画不达标，可以用 PixiJS 替换 `CardTableSurface`。不能让页面或会话层直接依赖 Pixi，以免一次渲染器调整演变为全量迁移。

## 协议与恢复

协议采用 JSON 和运行时 schema 校验。客户端只发送意图：

```text
command { protocolVersion, sessionId, commandId, expectedRevision, action }
resume  { protocolVersion, sessionId, lastRevision, resumeToken? }
```

客户端 action 不含 `actorId`、`sentAt`、seed、随机结果或 `DeadlineElapsed`。服务端发出：

```text
command.ack { sessionId, commandId, ok, revision? | problem? }
snapshot    { sessionId, revision, snapshot, resumeToken? }
```

首版始终推送玩家专属全量快照。快照很小，允许 revision 跳跃，能显著简化断线、乱序和通知丢失处理。网络语义是“至少一次提交 + 幂等结果”，不是 exactly-once。客户端断线后重连并恢复快照；没有按离线时长把真人替换为 Bot 的托管机制。

WSS 握手在 `Authorization: Bearer <session>` Header 中携带会话凭证；URL 固定为 `/v1/session`，不使用 query 传递长期 token。Header 行为已有平台 fake adapter 与真实 Fastify WSS 自动测试，仍须在微信开发者工具、真机和生产 WSS 入口复核。

当前协议仍标记为未发布的 v1；`room.tutorial` 是该首发协议的一部分。若在正式发布 v1 后再增加任何严格必填字段，必须提升协议版本或提供双版本兼容窗口，不能在相同版本下直接改变精确 schema。

## 权威服务端

服务端是 Node.js + TypeScript 模块化单体。HTTP/WSS gateway 处理认证、协议校验和连接管理；规则、随机、计时与隐藏信息全部由 `MatchCoordinator` 和 `GameKernel` 处理。生产入口仍应补充基础设施级速率限制与滥用防护。

一次玩家命令在单个数据库事务中完成：

1. 绑定认证用户，校验协议、成员资格和命令大小；
2. 锁定 match 行并检查 `(matchId, actorId, commandId)` 回执；
3. 解析本人 opaque card token，由服务端注入身份和当前时间；
4. 执行 `GameKernel`，生成下一状态、事件和下一截止时间；
5. `revision + 1`，更新快照，写回执和可见性受控的审计事件；
6. 提交后通知连接实例，并为每位玩家分别投影快照。

PostgreSQL 是 MVP 的唯一事实源。首版运行时按单 server 实例部署；房间与牌局状态仍全部持久化，进程重启后由客户端重连恢复。Redis、Kafka、微服务和 Kubernetes 都不是首版依赖。扩展到多实例前，必须增加 PostgreSQL `LISTEN/NOTIFY`（或等价通知总线）来唤醒持有其他玩家连接的实例。

上面的单事务保证适用于对局内核命令：match 快照、对局回执和审计事件一起提交。房间变更本身使用房间行锁和事务，开局时 `createMatch + saveRoom` 原子提交；但 Session Gateway 的通用 `session_command_receipts` 仍在业务事务之后单独写入，进程若恰在两者之间崩溃，房间命令可能已经生效但会话回执尚未落库。首版以单实例、客户端 revision 冲突恢复和房间不变量减轻影响，不宣称该窗口具备 exactly-once；后续应把房间命令执行与会话回执纳入统一事务边界。

生产进程拒绝在缺少 `DATABASE_URL`、微信 AppID/AppSecret 或至少 32 字符 `AUTH_SECRET` 时启动。小游戏生产构建固定注入 `MINIGAME_API_BASE_URL`，并忽略 query 中的调试 endpoint、Demo 和开发认证开关；开发身份与内存存储不属于生产信任边界。

## 定时器与隐藏信息

- 到期 worker 周期查询 `deadline_at <= now()` 的活动局，使用 `FOR UPDATE SKIP LOCKED` 领取；
- 系统命令 ID 固定为 `timer:{matchId}:{deadlineId}`，回执和 `deadlineId` 共同保证重复执行无害；
- 客户端倒计时只显示 `deadlineAt - correctedServerTime`，不能决定截止结果；
- 完整牌堆、所有手牌和随机种子只在服务端；
- 内部 card ID 不下发。牌进入某玩家手里时生成 128 位随机 token，离手失效，转移所有权时换 token；
- 审计和错误日志禁止记录牌堆顺序、手牌、seed、秘密插入位置和 card token。

## 存储和部署

核心表包括 `users`、`rooms`、`room_members`、`matches`、`command_receipts` 和 `match_events`。活动局以 JSONB 快照恢复，不采用纯事件溯源；事件表用于受限回放和客服审计。

首版生产拓扑为一个 server 实例、一个高可用 PostgreSQL 和支持 WSS 的入口。实例没有本地权威牌局状态，但连接广播目前是进程内的，因此不得在未加入跨实例通知前水平扩容。滚动发布会触发客户端短暂重连；后续先加入 PostgreSQL通知，再按指标决定是否引入 Redis presence/pub-sub。

## 验收门槛

下列条目是发布门槛，不代表当前已通过。仓库自动门禁已覆盖协议、规则、构建和内存存储链路；当前机器因 Docker daemon 不可用而未完成真实 PostgreSQL 运行时验证，微信开发者工具与真机视觉 QA 也仍为 blocked。

- 微信开发者工具、iOS 和 Android 真机能完成登录、建/加房、完整一局和重连；
- 规则长滚动、十张手牌、Nope 遮罩、键盘输入和拆弹滑杆无触摸偏移；
- 并发 Nope、重复命令、旧 token、到期竞争和服务实例重启测试通过；
- 微信开发者工具统计的主包留至少 20% 余量；当前清单图片已经降采样和压缩，是否需要分包以工具统计为准；
- 低端基准机连续十局无崩溃、明显输入延迟或持续内存增长；
- 正式发布前完成 AppID、合法域名、TLS、备案、实名/防沉迷、隐私、审核和知识产权配置。
