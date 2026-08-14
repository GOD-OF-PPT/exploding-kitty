# exploding-kitty

微信端回合制卡牌游戏方案与可运行参考实现仓库。

仓库现已实现 `original-2025@1` 的微信小游戏与权威服务端功能切片：2–5 人、确定性 Bot、56 张基础牌、全部基础牌效、Nope 响应链、组合、拆弹私密插回、淘汰、结算、弱网恢复、三步规则说明、服务端权威教学局引导与 25 个产品场景。规则内核、会话、持久化、传输和表现层通过可替换 adapter 分离；`prototype/` 仅保留为设计与回归基准。微信工具、真机与生产环境仍须按验收矩阵联调，不能仅凭代码视为已发布。

## 文档

- [规则基线与微信端实现方案](docs/EXPLODING_KITTENS_RULES_AND_IMPLEMENTATION.md)
- [已实现范围与上线前配置](docs/IMPLEMENTED_SCOPE.md)
- [正式架构](docs/ARCHITECTURE.md)
- [验收矩阵](docs/ACCEPTANCE.md)
- [微信云托管部署清单](docs/WECHAT_CLOUD_RUN_DEPLOYMENT.md)

## 运行与验证

```powershell
npm install
npm run dev:server
# 另开终端
npm run dev:minigame
```

小游戏正式构建只需设置微信云托管的 `MINIGAME_CLOUD_ENV_ID` 和 `MINIGAME_CLOUD_SERVICE_NAME`，再将 `apps/minigame` 导入微信开发者工具。生产链路使用 `wx.cloud.callContainer` 登录、使用 `wx.cloud.connectContainer` 建立实时会话，服务保持关闭公网访问且无需配置通讯域名。由于登录依赖 `callContainer`，小游戏基础库最低版本须设为 `2.23.0`。`demo=1` 只对开发模式构建生效且必须显式提供；生产构建忽略调试 query，不会静默回退到 Demo、开发身份或 query 指定的服务器。

```powershell
npm test
npm run typecheck
npm run build
```

生产服务当前限定为单实例：连接广播仍在进程内，加入跨实例通知总线前不可水平扩容。`callContainer` 登录返回的 Bearer 会话凭证只放入 `connectContainer` 建连后的首个 `resume.resumeToken`，绝不进入 URL；服务端验证通过前不接受业务命令。生产还必须提供 MySQL、至少 32 字符的随机 `AUTH_SECRET` 和可信微信云托管身份头模式；内存存储与开发认证仅用于本地开发。客户端没有“断线 60 秒后由 Bot 托管”功能。

## 当前实现结构

```text
packages/game-core/         确定性规则内核与玩家投影
packages/protocol/          严格版本化传输协议
packages/session-client/    全量快照、outbox 与恢复
packages/presentation-model/产品页面模型与动作构造
apps/game-server/           权威 Node.js/WebSocket/MySQL 服务
apps/minigame/              微信原生小游戏客户端
prototype/                  设计与视觉回归基准
```

## 重要说明

Exploding Kittens 的名称、商标、卡图、角色与原文文案可能受到知识产权保护。本实现使用原创名称、角色、卡图与中文文案，不收录官方美术；商业发布前仍需完成知识产权、微信 AppID、权威服务器、实名/防沉迷、隐私与审核配置。
