# exploding-kitty

微信端回合制卡牌游戏方案与可运行参考实现仓库。

仓库现已实现 `original-2025@1` 的本地完整切片：2–5 人、确定性 Bot、56 张基础牌、全部基础牌效、Nope 响应链、组合、拆弹私密插回、淘汰、结算、存档恢复与 25 个产品界面。规则内核、会话、持久化、传输和 React 表现层通过可替换 adapter 分离。

## 文档

- [规则基线与微信端实现方案](docs/EXPLODING_KITTENS_RULES_AND_IMPLEMENTATION.md)
- [已实现范围与上线前配置](docs/IMPLEMENTED_SCOPE.md)

## 运行与验证

```powershell
cd prototype
npm install
npm run dev
```

打开 `http://localhost:4173/` 即可游玩。默认入口是完整游戏；`http://localhost:4173/#gallery` 保留 25 屏设计 QA 画廊。

```powershell
npm test
npm run typecheck
npm run build
```

## 当前实现结构

```text
prototype/src/game/       确定性规则内核与玩家投影
prototype/src/session/    Local/Remote GameSession
prototype/src/adapters/   浏览器存档与 WebSocket adapter
prototype/src/app/        本地产品流程与内核组合根
prototype/src/live/       方案 1 的完整可玩界面
```

## 重要说明

Exploding Kittens 的名称、商标、卡图、角色与原文文案可能受到知识产权保护。本实现使用原创名称、角色、卡图与中文文案，不收录官方美术；商业发布前仍需完成知识产权、微信 AppID、权威服务器、实名/防沉迷、隐私与审核配置。
