# 首页设计稿还原 Design QA

- source visual truth path: `C:\Users\KSG\AppData\Local\Temp\codex-clipboard-dbbe87d0-91b8-4efe-b755-c50056c64e31.png`
- normalized source path: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\home-target-390x844.png`
- implementation screenshot path: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\home-implementation-resume-main-final.png`
- viewport: `390 × 844`
- state: 已鉴权，存在未完成牌局；3/8 名玩家存活；第 2 回合
- full-view comparison evidence: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\home-comparison-main-final.png`
- focused controls comparison evidence: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\home-comparison-controls-main-final.png`
- focused hero comparison evidence: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\home-comparison-hero-main-final.png`

## Findings

没有遗留的 P0、P1 或 P2 问题。

- Fonts and typography: 漫画主标题和气泡文案直接来自设计稿海报资产；状态、按钮与工具标签的字号、字重、行高和不换行规则均与目标层级一致，没有截断或拥挤。小字号文字只剩 Canvas 与设计稿栅格化方式造成的 P3 级抗锯齿差异。
- Spacing and layout rhythm: 采用固定 `528 + 56 + 128 + 33 + 99 = 844` 的纵向分区；海报、状态条、两枚按钮、“更多”和工具入口与设计稿同序、同宽并居中。不存在溢出、底部裁切或区域重叠。
- Colors and visual tokens: 黑、奶油、亮黄和青色状态强调与设计稿一致；边框、分隔线和按钮表面没有额外阴影、渐变或通用卡片化处理。
- Image quality and asset fidelity: 顶部海报和装饰图标均使用真实位图资产；海报为 `1170 × 1584`、工具图标和状态装饰为 3× 资源，比例与 CSS 槽位一一对应，无拉伸、透明光晕或占位图。没有使用 CSS 图形、emoji、内联 SVG 或手绘代码替代目标资产。
- Copy and content: `你有一场未完成的牌局`、`对局中 · 3/8人 · 第2回合`、`查看详情 ›`、`继续牌局`、`加入房间`、`新手教学`、`规则图鉴`、`设置` 与目标状态一致；无恢复牌局时保持同尺寸状态条并切换为 `快速开局` / `创建房间`。
- Accessibility and behavior: 所有核心入口保持独立点击区域；主按钮 310×61、次按钮 310×57、工具入口 97–113×99，满足移动端可触达性。页面没有自动动画或闪烁。

## Expected Platform Difference

- 设计稿右上角包含微信系统胶囊；浏览器 Canvas 夹具不绘制平台 chrome。应用已清除海报内的静态胶囊并保留黑色净空，真机由微信系统在同一区域覆盖。这是预期平台差异，不是实现缺失。

## Comparison History

1. Pass 1 — `.codex-tmp/home-comparison-pass1.png`
   - Earlier findings: `[P2]` 状态条、按钮和工具区整体缩小，底部视觉密度明显低于设计稿；工具图标比例偏小。
   - Fixes made: 将内容改为 390×844 固定分区，按钮宽度统一为 310，工具图标按设计稿槽位重新量测。
2. Pass 2 — `.codex-tmp/home-comparison-pass2.png`
   - Earlier findings: `[P2]` 状态信息与右侧详情按钮横向分配仍偏松；底部标签光学位置偏低。
   - Fixes made: 收紧状态复制区和间隔，锁定详情按钮 76×30，调整工具标签相对偏移。
3. Pass 3 — `.codex-tmp/home-comparison-pass3.png`
   - Earlier finding: `[P2]` 工具入口宽度与分隔线位置仍有轻微结构漂移。
   - Fix made: 分别设定 97 / 113 / 98 的工具入口宽度，并将两根分隔线锁定到 44 高、7 上边距。
4. Pass 4 — `.codex-tmp/home-comparison-pass4.png`
   - Post-fix result: P0/P1/P2 清零；仅剩系统胶囊与栅格抗锯齿两项预期/P3 差异。
5. Current main integration — `.codex-tmp/home-comparison-main-final.png`
   - 将同一实现叠加到 `32aa046` 的新版 ScreenHost 生命周期和字体架构后重新捕获；构图、尺寸和交互没有回退。

## Primary Interactions Tested

- 恢复状态卡 → 当前对局
- `继续牌局` → 当前对局
- `创建房间` → 创建房间页
- `加入房间` → 加入房间页
- `新手教学` → 教学页
- `规则图鉴` → 规则页
- `设置` → 设置页
- Browser console: 仅有 Layout 版本日志，0 warning，0 error

## Build and Platform Evidence

- Production 与 preview 构建均通过，鉴权方式为 `cloudContainer`。
- 最终包嵌入环境 `prod-d0g8qcwrb047789af` 和服务 `exploding-kitty-api`，不包含 `localhost` 或 `127.0.0.1`。
- 微信开发者工具 CLI 使用 AppID `wxd8938809dbb08d94` 成功执行 preview；上传总大小 `3,316,393` bytes，低于 `3,355,443` bytes 门槛。

## Implementation Checklist

- [x] 设计稿海报按 390×528 精确接入
- [x] 恢复态与快速开局态保持相同结构尺寸
- [x] 七个核心入口完成点击回归
- [x] 3× 位图资源、哈希和包体契约通过
- [x] Production / preview 云托管配置通过
- [x] 微信开发者工具 CLI preview 通过

## Follow-up Polish

- `[P3]` 真机字体抗锯齿可能与浏览器夹具有细微像素差异；不影响字号、字重、换行或布局，不阻塞还原验收。

final result: passed
