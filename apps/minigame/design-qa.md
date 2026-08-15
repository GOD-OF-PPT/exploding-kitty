# 微信小游戏最终视觉回归与 Design QA

## 最终结论

本轮浏览器 Canvas 视觉回归通过。最终 schema v3 批次覆盖 25 个 `390x844` 标准场景、17 个窄/短屏 initial 场景、25 组 DPR2/3 清晰度证据、2 个滚动终态、25 张同屏比较图和 11 张重点裁图；逐图复核结果为 P0=0、P1=0、P2=0。

用户反馈的美术配图裁切、模糊和比例失调问题已完成系统整改：语义图片不再使用破坏性裁切，卡牌与人物资源有明确尺寸/比例契约，手牌与交牌页均重新排版。最终剩余仅 2 项 P3 视觉润色，不影响识别、操作或任务完成。

本结论只代表受控浏览器 Canvas implementation 通过，不等同于微信开发者工具、iOS/Android 真机或微信平台验收通过。

## 审查范围与 source truth

- 审查对象：`apps/minigame` 的 25 个生产场景 renderer、三档响应式布局、牌桌、滚动终态、DPR2/3 绘制、字体、图像资源和主要触控外形。
- source visual truth：`prototype/audit/current/after/implementation-<screen>-390x844-final.png`。这些文件虽为 `.png` 扩展，当前磁盘 magic 实际为 JFIF JPEG，只作为视觉基准，不计入 PNG evidence。
- reference mapping：`prototype/audit/current/comparisons/final-*.jpg`，其中 `lobby-host` 映射到 `final-lobby.jpg`。
- implementation source：`apps/minigame/src/ui/`、`apps/minigame/src/ui/rendering/`、`apps/minigame/visual-preview/src/`。
- implementation evidence：`apps/minigame/visual-preview/evidence/`。
- Browser 抽查：`apps/minigame/visual-preview/browser-audit/`。

用户目标是从登录、建房/入房、牌桌行动、响应/选择、结算到规则/设置的完整小游戏体验，在常见手机尺寸下保持漫画风格、信息清楚、图片锐利且主要操作可达。

## 最终证据与来源绑定

- evidence manifest schema：v3；旧 schema v2 批次不用于本结论。119 条直接捕获记录内部仍使用当前契约规定的 capture record schema v2。
- manifest SHA-256：`b6da22a6fa760f2eac0a04b3a2e0c5a34760c99832664f0eb7898c0743c99999`。
- source base commit：`adcd2b75b7e931c2743cf308dc0554cfcc48dcf6`，与本轮复核时的 `HEAD` 相同。
- preview bundle SHA-256：`1a5604a69ed2b62eb38e716fb8e3470e1b064534a2850d2f0f88f21b4e145a1d`。
- input fingerprint SHA-256：`10978f55851dfe6ab4eabd2eb71b32de404d3f12f02928456f2dad8da51033eb`（209 files）。
- capture source snapshot SHA-256：`b71cb9b7e71466034cf6b224f5fc7d7dcffad501f7b37f21721499fcc8bef7f5`。
- capture method：`CDP Runtime.evaluate -> HTMLCanvasElement.toDataURL(format=png)`；真实 Browser viewport 固定为 `389x584`。
- 证据根共 131 个文件、165,235,692 bytes；其中 130 张 PNG 为 164,926,781 bytes，另有 1 个 manifest。
- 捕获后 verifier 做过 byte-exact preview rebuild；当前 `dist/main.js` mtime 因复核刷新，但字节 SHA 与 manifest 绑定值完全相同。因此新鲜度以 bundle/input/source snapshot 的内容哈希和确定性重建签署，不以墙钟 mtime 作结论。

每张直接捕获都记录 Canvas intrinsic、DOMRect、render viewport、显式 DPR、连续稳定 sample、RGBA pixel hash、PNG byte SHA、source snapshot 和 anti-repeat 结果。comparison 的右侧区域逐像素绑定同屏 accepted-current PNG；11 张 derived focus 固定 source、固定 crop，并通过 RGBA exact 校验。

## Viewport 与状态矩阵

| Evidence | Viewport / intrinsic | State | Count |
| --- | --- | --- | ---: |
| Standard current | `390x844` | 25 个场景 initial | 25 |
| 八家族窄屏 current | `372x749` | home/create/lobby-host/attack/defuse/result/rules/settings | 8 |
| 八家族短屏 current | `389x584` | 同上 8 个代表场景 | 8 |
| Additional narrow current | `372x749` | network initial | 1 |
| DPR2 density | `780x1688` intrinsic，CSS `390x844` | 25 个标准场景 initial | 25 |
| DPR3 density | `1170x2532` intrinsic，CSS `390x844` | 25 个标准场景 initial | 25 |
| Direct interaction | `372x749` / `389x584` | network / rules scroll-end | 2 |
| Same-screen comparison | `964x964`，左右各 `390x844` | 25 个场景 initial | 25 |
| Derived focus | 固定 source/crop | 11 个重点区域 | 11 |
| Reference | source JPEG hash | 25 个视觉基准 | 25 |

直接捕获共 119 张：42 current + 50 density + 2 interaction + 25 comparison。另有 11 张由最终 source 无损派生的 focus，共 130 张 PNG。

## 25 个标准场景

| Step | Screen | General health |
| ---: | --- | --- |
| 1 | login | 健康；品牌、登录动作、协议与装饰均完整，主贴纸居中。 |
| 2 | home | 健康；主角、品牌和四个入口层级清楚，无图片残片。 |
| 3 | play-mode | 健康；创建/加入入口与返回操作完整；主角较 source 小约 15-25%，记录为 P3。 |
| 4 | create | 健康；计时、机器人、固定规则和 CTA 无裁字或孤行。 |
| 5 | join | 健康；房间码输入、禁用态和返回操作完整；主角较 source 小约 15-25%，记录为 P3。 |
| 6 | lobby-host | 健康；房间码、五席位、准备状态、邀请位与开始操作完整。 |
| 7 | lobby-member | 健康；本人状态、其他玩家与取消准备操作一致。 |
| 8 | game | 健康；牌堆、弃牌堆和 3x2 六张手牌均可辨，底部操作不遮牌。 |
| 9 | other-turn | 健康；当前玩家、倒计时、回合信息和六张手牌完整。 |
| 10 | attack | 健康；欠回合信息、牌桌、六牌与固定操作完整；`×3` 印章轻微进入弃牌框，记录为 P3。 |
| 11 | response | 健康；限时响应、倒计时和双动作层级清楚。 |
| 12 | favor | 健康；目标玩家、选中态与确认动作明确。 |
| 13 | give-card | 健康；四张 7:10 卡牌完整显示，选中态和 CTA 不重叠。 |
| 14 | future | 健康；三张牌的顺序和私密信息状态清楚。 |
| 15 | defuse | 健康；顶/底端点、步进、当前位置和确认动作同屏可达。 |
| 16 | explosion | 健康；危险卡图完整锐利，主操作可见。 |
| 17 | eliminated | 健康；人物、淘汰原因、排名与双动作无互相遮挡。 |
| 18 | result | 健康；胜者、四条排行和双 CTA 完整。 |
| 19 | tutorial | 健康；主图、步骤与双操作完整。 |
| 20 | rules | 健康；tab、规则列表与固定返回操作清楚，末条规则可达。 |
| 21 | card-detail | 健康；牌图、牌效与属性层级连续。 |
| 22 | history | 健康；时间线、节点、事件文案和返回操作完整。 |
| 23 | game-menu | 健康；返回牌桌、认输观战及危险提示顺序正确。 |
| 24 | network | 健康；重连、当前回合与安全快照语义真实，重试操作固定可达。 |
| 25 | settings | 健康；开关、教学/规则入口、版本和完成操作完整。 |

## 短屏、交互与 DPR 复核

- 17 个窄/短屏 initial 场景逐张通过；八家族在 `372x749` 和 `389x584` 的最低矩阵完整保留，未被额外探针替代。
- `attack@389x584` 仍完整呈现四名对手、牌堆/弃牌、欠回合信息、单排六张完整手牌与底部操作；更高视口继续使用 3x2 排列，没有幽灵命中或不可见 selected owner。
- `network@372x749` initial 与 scroll-end 的字节和 RGBA 均不同，末卡完整，固定重试操作不遮安全区。
- `rules@389x584` scroll-end 到达真实 `maxScrollTop`，末条规则与底部留白完整。
- 25 个标准场景均有独立 DPR2 和 DPR3 backing-store 证据。verifier 同时拒绝 nearest-neighbor 或预乘 Alpha bilinear 的机械放大结果，资源清晰度不由 DPR1 单图签署。

## 五项必查面

- 字体：生产 DISPLAY_FONT 的 TTF 子集覆盖 281/281 个所需字形，cmap 门禁通过，没有 tofu、静默缺字或关键文字裁切；标题、badge、说明和 CTA 的字重层级一致。
- 间距：三档 viewport 的页边距、安全区、胶囊、牌桌、滚动区与固定 dock 已检查；未发现横向溢出、不可恢复遮挡或 CTA/内容冲突。
- 颜色：黄色主操作、红色危险态、青色选中/品牌态、奶油内容面板和深色次操作保持清楚区分；深底按钮均使用浅色文字/图标。
- 图片质量：8 张卡牌统一为 `658x940` 的 7:10 独立 PNG；4 个角色使用 `1024x1024` 透明安全画布；群像为 `1560x488`，背景为 `1170x2532`，network Hero 图标为 `320x320`。语义 raster 全部为 `contain`，唯一 `cover` 是允许裁切的 bleed 背景。
- 文案：房间状态、响应动作、拆弹位置、结算数据、断线恢复与菜单危险操作均与当前产品语义一致，没有用文案承诺未实现能力。

## 资源质量契约

- `assets.manifest.json` 使用 `rasterContractVersion: 1`。
- 58/58 文件 SHA 闭合，总计 2,878,337 bytes；52/52 raster 具有 role、intrinsic、maxCssSize、targetDpr、fit、maxCropRatio 与 edgePolicy。
- raster 角色为 1 hero、8 full-card、4 avatar、1 background、38 icon；51 个 `contain`，1 个允许裁切的 background `cover`。
- `check-assets` 同时检查 source 与 release；优化脚本拒绝旧低清、错误比例或需要放大的卡图，陈旧 release 不能掩盖 source 损坏。
- 最终 release 为 3,163,080 bytes；20% 主包余量门限为 3,355,443 bytes，保留 192,363 bytes 余量。

## Finding -> fix -> recapture

| Round | Finding | Fix | Recapture result |
| ---: | --- | --- | --- |
| 1 | P1/P2：卡牌出现裁切、模糊、邻图残片和比例不一致 | 重制 8 张独立 7:10 卡牌；角色、群像、背景和 Hero 资产统一安全画布与目标密度 | 资源质量/完整性门禁 13/13；semantic art 为 CROP=0 / BLUR=0 / DISTORT=0 |
| 2 | P1/P2：语义图片使用错误 fit，局部被硬切或拉伸 | 把语义 raster 全部改为 `contain`，仅 bleed 背景保留受契约约束的 `cover` | 52/52 raster contract 通过；DPR2/3 全矩阵通过 |
| 3 | P1：手牌相互覆盖，选中态、绘制 owner 与 hit-map 不一致 | 手牌改为真实 3x2；选中描边在卡内绘制，paint owner 与 cardAt 对齐 | 6/10 手牌参数矩阵及三档牌桌回归通过 |
| 4 | P2：`give-card@390x844` 四张牌底部被截，7:10 比例破坏并与 CTA 冲突 | 重新分配标题、接收者、四牌网格、隐私说明和 dock 的垂直预算；卡图固定 `contain` | iteration-1 判废；iteration-2 与最终浏览器复拍显示四牌完整、比例正确、CTA 无重叠 |
| 5 | P1/P2：仅 DPR1 不能证明清晰度，旧证据不覆盖高密度资源 | evidence 升级 schema v3，增加 25xDPR2 + 25xDPR3 与 raster source/release 双门禁 | 42 current、50 density、2 interaction、25 comparison、11 focus 全量重采并通过 strict verifier |

`give-card` 历史证据：

- 修复前 current：`browser-audit/iteration-1-give-card-current-390x844.png`。
- 修复前 comparison：`browser-audit/iteration-1-give-card-comparison-390x844.png`。
- 修复后第一次复拍：`browser-audit/iteration-2-give-card-browser-390x844.png`。
- 最终 Browser 复拍：`browser-audit/final-give-card-browser-390x844.png`。

## Browser 抽查与 console

- 最新预览：`http://127.0.0.1:4176/?screen=game&viewport=390x844&mode=canvas`。
- 最终牌桌截图：`browser-audit/final-game-browser-390x844.png`。
- 最终交牌截图：`browser-audit/final-give-card-browser-390x844.png`。
- 两页均达到 `Canvas ready` 后捕获，截图严格裁到 `#preview-canvas`，未使用会产生长页重复的 full-page 截图。
- Browser console：0 error，0 warning。

## 剩余 P3

- `play-mode` 与 `join` 的主角相对 source 小约 15-25%；信息层级和操作不受影响。
- `attack` 的 `×3` 印章轻微进入弃牌框；数字仍清楚，牌堆标签和操作不受影响。

按本轮审查规范，P3 只记录为后续润色，不继续触发全量重采循环。

## Verification

- minigame tests：339/339 passed。
- asset quality/integrity：13/13 passed。
- evidence runner/verifier tests：51/51 passed。
- preview tests：52/52 passed。
- minigame TypeScript：passed。
- preview TypeScript：passed。
- strict schema v3 evidence verifier：passed。
- `check-assets`：58 files / 52 raster / DISPLAY_FONT 281/281 passed。
- production build：passed；本轮最终复核未重建 production release。
- bundle smoke：`MINIGAME_BUNDLE_SMOKE_OK`。
- `git diff --check`：passed。

## 可访问性与证据限制

截图可确认主要控件具有清楚外形、文字与背景可区分、内容在三档尺寸下可重排、滚动终态可达。它不能单独证明真实触摸命中、屏幕阅读器语义、焦点顺序、动态字体、惯性滚动、GPU 采样、系统字体回退、微信胶囊 API、键盘、分享或音频行为，因此不声明完整 WCAG 或微信真机可访问性通过。

下一阶段只需在微信开发者工具和至少一台 iOS/Android 真机抽查 DPR、触控、滚动、胶囊、安全区、分享、键盘与音频，不需要重新设计或重做本轮已通过的美术系统。

final result: passed
