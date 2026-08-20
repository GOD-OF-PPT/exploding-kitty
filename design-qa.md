# 首页方案一 Design QA（实现侧）

- source visual truth path: `C:\Users\KSG\.codex\generated_images\01a018de-0bc3-7cb0-9041-4ca0f2b3bb44\exec-2085243c-41cb-4383-9b8c-d840a651faa2.png`
- implementation screenshot path: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\all-pages-audit\home-spotlight-implementation-final.png`
- full-view comparison evidence: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\all-pages-audit\home-spotlight-comparison-final.png`
- viewport: `390 × 844`
- state: 已鉴权、存在未完成牌局的首页恢复态

## Browser Fixture Findings

浏览器 Canvas 夹具中没有遗留的 P0、P1 或 P2 问题；该结果只用于实现侧回归，不能替代微信平台视觉验收。

- Fonts and typography: 标题、问候、主次动作和小字号状态信息层级清晰；中文无截断、异常换行或额外字距。实现使用小游戏现有系统字体和描边能力，保留漫画标题的重量感。
- Spacing and layout rhythm: 角色舞台、恢复卡、两级动作和工具入口均完整落在 390 × 844 内；没有横向滚动、底部裁切或安全区冲突。主动作位于拇指易达区。
- Colors and visual tokens: 黑、奶油、黄、青、红与选中稿及现有品牌一致；主动作、次动作和状态链接的语义对比明确，未引入渐变或闪烁。
- Image quality and asset fidelity: 使用仓库现有蓝猫、牌背和卡牌图片，缩放后边缘清晰，无透明底光晕或拉伸。没有用 CSS 图形、emoji 或占位符替代可见资产。
- Copy and content: `继续牌局`、`加入房间`、`新手教学`、`规则图鉴`、`设置` 及恢复状态信息均准确；无未完成牌局时主动作会切换为 `创建房间`。

## Comparison History

1. Initial pass
   - Earlier findings: `[P2]` 红色满屏漫画背景抢夺主动作注意力；`[P2]` 角色舞台偏小；`[P2]` 底部工具入口盒子感过重，与选中稿的轻量工具区不符。
   - Fixes made: 收回到纯黑主场，放大猫咪舞台和角色，移除工具卡背景并改用细分隔线。
   - Post-fix evidence: `.codex-tmp/all-pages-audit/home-spotlight-comparison-v2.png`。
2. Proportion pass
   - Earlier finding: `[P2]` 品牌标题和上半屏纵向比例仍弱于选中稿。
   - Fix made: 提升标题字号与品牌区高度，把舞台、恢复卡和主动作整体下移到目标节奏。
   - Post-fix evidence: `.codex-tmp/all-pages-audit/home-spotlight-comparison-final.png`。

## Primary Interactions Tested

- `继续牌局`：恢复到当前对局的准确派生页面。
- `创建房间`：直接进入房间设置，不再经过“开一局 → 模式选择”。
- `加入房间`：进入 6 位房间码输入页。
- `新手教学`、`规则图鉴`、`设置`：均进入对应页面。
- Browser console: 无 warning 或 error。

## WeChat Platform Evidence

- 微信开发者工具 CLI 已使用正式 AppID `wxd8938809dbb08d94` 成功打开 `apps/minigame`，并对生产构建执行 `preview`。
- 预览上传信息：总大小 `3,433,051` bytes；生产包内包含云托管环境 `prod-d0g8qcwrb047789af`、服务 `exploding-kitty-api` 与 `cloudContainer`，不包含 `localhost` 或 `127.0.0.1`。
- 尚未取得微信开发者工具渲染截图，以及 iOS / Android 真机截图；因此首页视觉与触摸验收仍按 `docs/ACCEPTANCE.md` 标记为 blocked。

## Focused Region Comparison

未另做裁剪：最终并排图按 390 × 844 原生内容比例展示，标题、恢复卡、按钮标签和底部工具文字均可直接辨认，关键细节没有因缩放而丢失。

## Follow-up Polish

- `[P3]` 选中稿中的双色手绘标题和“猫咪持牌”姿态没有新增专用大图；实现优先复用现有品牌资产，以控制微信主包体积并保持角色一致性。

final result: blocked
