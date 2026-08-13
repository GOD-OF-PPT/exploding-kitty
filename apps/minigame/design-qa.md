# 微信小游戏视觉 QA

- evidence target: 微信开发者工具或 iOS/Android 真机运行 `apps/minigame/release/` 的真实截图
- design reference: `prototype/audit/current/after/`
- checked at: 2026-08-13

当前工作环境没有可验证的微信开发者工具截图捕获结果，也没有真机截图。仓库中的 Web 原型截图只作为设计基准，未被当作正式小游戏运行证据。因此本轮不能逐页证明安全区、DPR、滚动、Canvas 命中区域及平台字体渲染与设计稿一致。

后续应在微信开发者工具中依次捕获 25 个 scene registry 场景，并至少在一台 iOS、一台 Android 设备抽查登录、房间、牌桌、响应窗、私密选择、结算和长滚动页面；将每个差异按 P0/P1/P2 登记并复测。

final result: blocked
