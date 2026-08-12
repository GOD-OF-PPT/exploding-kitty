# exploding-kitty

微信端回合制卡牌游戏方案与实现仓库。

当前阶段已完成《爆炸猫咪》官方规则基线、数字化边界与微信小游戏实现方案的调研。首版计划锁定 `original-2025@1`，将确定性规则内核、客户端表现层和服务器权威状态分离。

## 文档

- [规则基线与微信端实现方案](docs/EXPLODING_KITTENS_RULES_AND_IMPLEMENTATION.md)

## 计划中的结构

```text
apps/
  minigame/       微信小游戏客户端
  server/         权威房间与长连接服务器
packages/
  game-core/      纯 TypeScript 规则内核
  protocol/       命令、事件与视图协议
  rulesets/       版本化卡组与规则配置
```

## 重要说明

本项目尚处于规则研究和技术设计阶段。Exploding Kittens 的名称、商标、卡图、角色与原文文案可能受到知识产权保护；在获得相应授权前，本仓库不会收录或发布官方美术和卡面素材。
