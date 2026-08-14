# 微信小游戏视觉 QA

## 结论

- Browser Canvas 回归：**已建立**。25 个 `ScreenId` 均有确定性 fixture、390 × 844 当前截图及同尺寸 prototype / Canvas 比较图。
- 短屏回归：**已建立**。8 个场景家族各自在 372 × 749 与 389 × 584 截图，共 16 张。
- 视觉审计：**未通过**。存在 1 个 P0、4 个 P1、2 个 P2；本任务受范围约束，只记录问题，不修改生产 renderer。
- 微信平台验收：**仍受阻**。浏览器 Canvas 证据不能替代微信开发者工具、iOS 或 Android 真机截图。

checked at: 2026-08-14

source base: `adcd2b75b7e931c2743cf308dc0554cfcc48dcf6`

fixture set: `renderer-registry-25-v1`

## 可重复入口与证据

从仓库根目录运行：

```powershell
node apps/minigame/scripts/build-visual-preview.mjs
python -m http.server 4173 --directory apps/minigame/visual-preview/dist
```

固定 URL 合同为 `?screen=<ScreenId>&viewport=<390x844|372x749|389x584>&mode=<canvas|compare>`。页面只在字体、场景图片、牌桌图片和 reference 完成最终绘制后设置 `window.__VISUAL_PREVIEW_READY__ = true`。

- [390 × 844 全量总览](visual-preview/evidence/overview-current-390x844.jpg)
- [25 张 prototype / Canvas 同屏比较总览](visual-preview/evidence/overview-comparisons-390x844.jpg)
- [8 家族短屏总览](visual-preview/evidence/overview-short-screens.jpg)
- [带 SHA-256 的证据清单](visual-preview/evidence/manifest.json)
- 当前 Canvas：`visual-preview/evidence/current/canvas-<screen>-<viewport>.png`
- 同屏比较：`visual-preview/evidence/comparisons/compare-<screen>-prototype-vs-canvas-390x844.png`

清单校验结果：41 张当前 Canvas PNG（25 张 390 × 844 + 16 张短屏）、25 张比较 PNG、25 张 prototype reference；所有当前与比较证据均有正确 PNG 魔数和目标尺寸。

## 25 屏审计步骤

每一行代表一个已实际渲染、截图并在同屏比较中检查的步骤。

| # | ScreenId | 家族 | 一般健康度 | 观察 |
| ---: | --- | --- | --- | --- |
| 1 | `login` | brand | 可用 / P2 | 资源完整；Canvas CTA 比 reference 明显上移，纵向留白节奏不同。 |
| 2 | `home` | brand | P1 | 390 高度下第三排操作被底边裁切；389 × 584 下教学与规则操作不可见。 |
| 3 | `play-mode` | room entry | 可用 / P2 | 两个入口清楚；底部深色返回文案对比度不足，但顶部返回仍可见。 |
| 4 | `create` | room entry | P1 | 表单与主操作完整；深色返回文案几乎不可读。 |
| 5 | `join` | room entry | 可用 / P2 | 房间码和进入按钮完整；底部深色返回重复控件不可读。 |
| 6 | `lobby-host` | lobby | **P0** | 389 × 584 中唯一“开始游戏”操作完全在画布外；席位文字也跨卡片裁切。 |
| 7 | `lobby-member` | lobby | P1 | 席位名字/状态跨卡片裁切，底部第三项操作被截断。 |
| 8 | `game` | table | P1 | 嵌套牌桌 Canvas、手牌、牌堆均正常；深色“菜单”标签不可读。 |
| 9 | `other-turn` | table | P1 | 牌桌完整；深色菜单标签不可读。 |
| 10 | `attack` | table | P1 | 债务章和牌桌完整；深色菜单标签不可读，短屏同样存在。 |
| 11 | `response` | table | P1 | 倒计时和否决按钮清楚；深色“放行”文案几乎不可读。 |
| 12 | `favor` | choice | P1 | 目标和确认操作清楚；深色取消文案不可读。 |
| 13 | `give-card` | choice | 通过 | 选择态、四张手牌与确认操作均可见。 |
| 14 | `future` | choice | 通过 | 三张有序卡和确认操作完整。 |
| 15 | `explosion` | outcome | 可用 / P2 | 关键危险状态与拆弹操作完整；与 reference 的 hero / CTA 比例差异较大。 |
| 16 | `defuse` | choice | 通过 | 390、372 与 389 三种高度下私密位置和确认操作都完整。 |
| 17 | `eliminated` | outcome | 可用 / P2 | 名次与观战操作完整；人物比例和纵向密度与 reference 不同。 |
| 18 | `result` | outcome | P1 | 390 与 372 可用；389 × 584 的主操作贴底裁切，次操作不可见。 |
| 19 | `tutorial` | editorial | 通过 | hero、说明、进度和下一步完整；顶部返回可用。 |
| 20 | `rules` | editorial | 通过（截图范围内） | tab 与长列表按宽度重排；滚动交互仍需平台验证。 |
| 21 | `card-detail` | editorial | 通过（截图范围内） | hero 与详情结构完整；底部内容依赖滚动，需平台验证。 |
| 22 | `history` | editorial | P1 | 时间线标题使用近黑文字落在深色卡片上，主要内容不可读。 |
| 23 | `game-menu` | utility | P1 | 菜单项与认输操作清楚；深色“返回牌桌”文案不可读。 |
| 24 | `network` | utility | 通过 | 离线状态、同步条、事实行和重试操作完整。 |
| 25 | `settings` | utility | 通过 | 390、372 与 389 三种高度下资料、设置项与完成操作完整。 |

## 八家族短屏复测

| 家族 | 代表屏 | 372 × 749 | 389 × 584 |
| --- | --- | --- | --- |
| brand | `home` | P1：版本字与操作区重叠 | P1：教学/规则操作被裁掉 |
| room entry | `create` | P1：深色返回标签 | P1：深色返回标签 |
| lobby | `lobby-host` | P1：席位文字裁切，离开操作贴底 | **P0：开始游戏不可见** |
| table | `attack` | P1：菜单标签对比度 | P1：菜单标签对比度 |
| choice | `defuse` | 通过 | 通过 |
| outcome | `result` | P1：次操作贴底 | P1：主操作贴底、次操作不可见 |
| editorial | `rules` | 通过（滚动待平台验证） | 通过（滚动待平台验证） |
| utility | `settings` | 通过 | 通过 |

## 问题登记

| ID | 严重度 | 状态 | 证据 | 问题与建议 |
| --- | --- | --- | --- | --- |
| VQ-01 | P0 | Open | [lobby-host 389 × 584](visual-preview/evidence/current/canvas-lobby-host-389x584.png) | 操作 dock 超出画布，“开始游戏”完全不可见且 dock 不随 body 滚动。短屏应固定真正主操作，或让次操作折叠/可滚动。 |
| VQ-02 | P1 | Open | [home 390 × 844](visual-preview/evidence/current/canvas-home-390x844.png), [home 389 × 584](visual-preview/evidence/current/canvas-home-389x584.png) | home 的四项操作在基线和短屏均不能完整容纳，且版本文字与操作重叠。需按密度压缩 hero / dock 或保留可达入口。 |
| VQ-03 | P1 | Open | [history 390 × 844](visual-preview/evidence/current/canvas-history-390x844.png) | 时间线标题与深色卡片对比不足，核心历史内容无法阅读。需给 timeline 标题使用浅色 token 并复测对比度。 |
| VQ-04 | P1 | Open | [game 390 × 844](visual-preview/evidence/current/canvas-game-390x844.png), [response 390 × 844](visual-preview/evidence/current/canvas-response-390x844.png), [game-menu 390 × 844](visual-preview/evidence/current/canvas-game-menu-390x844.png) | 深色 action 仍被通用 `.actionLabel` 的墨色覆盖，菜单、放行、取消、返回等文案接近不可见。需让 tone/hierarchy 决定标签颜色。 |
| VQ-05 | P1 | Open | [lobby-host 390 × 844](visual-preview/evidence/current/canvas-lobby-host-390x844.png), [lobby-host 372 × 749](visual-preview/evidence/current/canvas-lobby-host-372x749.png) | 席位标题/状态没有被卡片宽度约束，文字跨卡片边界并被裁切。需为 seat 变体设置专用 copy 宽度与对齐。 |
| VQ-06 | P2 | Open | [login 同屏比较](visual-preview/evidence/comparisons/compare-login-prototype-vs-canvas-390x844.png), [explosion 同屏比较](visual-preview/evidence/comparisons/compare-explosion-prototype-vs-canvas-390x844.png) | 多屏 hero 尺寸、纵向留白与 CTA 位置偏离 prototype；不阻断任务，但降低家族间视觉一致性。 |
| VQ-07 | P2 | Open | [证据清单](visual-preview/evidence/manifest.json) | `prototype/audit/current/after/*.png` 的实际魔数均为 JPEG (`FF D8 FF`)。浏览器可解码，但应在后续证据整理中改正扩展名或重新导出真 PNG。 |

P0 / P1 / P2 计数：**1 / 4 / 2**。本提交没有触碰生产 renderer、`screenHost`、metrics、`cardTableSurface`、manifest 或资源，因此以上问题均保留为后续生产修复项。

## 可访问性与证据限制

- 截图可确认 44 px 级返回/操作外形、可见层级、明显对比度风险和响应式裁切；不能据此宣称 WCAG 合规。
- Canvas 截图不能证明语义阅读顺序、屏幕阅读器名称、键盘/触摸焦点、真实命中区域、滚动惯性或动态状态播报。
- 还未验证微信胶囊 API 的真实返回值、平台字体回退、设备 DPR、GPU 合成、分享、键盘、音频与触感。
- release 结论应保持两条独立状态：`browser-canvas-regression: captured`；`wechat-devtools-and-device: blocked`。

final result: browser Canvas evidence complete; visual audit blocked by VQ-01; WeChat platform verification blocked
