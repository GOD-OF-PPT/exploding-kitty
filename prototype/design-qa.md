# Design QA — Live 全页面轮流审查

- source visual truth path: `C:\Users\KSG\.codex\generated_images\019ff580-3299-76f0-ba20-9da1dde934f8\exec-7b947574-a240-45ef-8e4d-55dce6bef3e0.png`
- source screen gallery: `E:\githome\exploding-kitty\prototype\src\App.jsx`
- viewport: 390 × 844 CSS px
- browser-rendered implementation evidence: `E:\githome\exploding-kitty\prototype\audit\current\after\implementation-*-390x844-final.png`（25 个实现状态；浏览器内确认 `innerWidth=390`、`innerHeight=844` 后直接截图）
- full-view comparison evidence: `E:\githome\exploding-kitty\prototype\audit\current\comparisons\final-*.jpg`（25 组真实 390 × 844 同状态对比）
- focused comparison evidence: `E:\githome\exploding-kitty\prototype\audit\current\comparisons\final-response.jpg`、`final-favor.jpg`、`final-defuse.jpg`、`final-explosion.jpg`、`final-other-turn.jpg`、`final-result.jpg`
- state set: 登录、首页、开局方式、建房/加房、房主/成员房间、我的/他人回合、Attack 欠回合、Favor 目标、否决、赠牌、拆弹、预见、爆炸、淘汰、结算、教程、规则、卡牌详情、记录、菜单、网络、设置

## Findings

当前轮次没有仍待处理的 P0、P1 或 P2。

- [P3] 他人回合中央灰色状态字在暗背景下可进一步提高对比度；当前仍清晰可读。
- [P3] 设置资料区未提供设计演示稿中的昵称“编辑”入口；当前产品范围不含昵称编辑。
- [P3] Favor 使用通用目标选择说明，措辞与专用设计演示稿略有差异，不影响理解和操作。
- [P3] 真实小程序画面不保留设计画廊的手机设备圆角外框；页面内容相较画廊预览略紧凑，CTA 与安全区完整。
- [P3] 否决与五种猫咪牌仍复用通用正面资源；牌型文字可辨，后续可补齐六套独立原创卡面。
- [P3] CJK 字体包较大，生产小程序应做字体子集与图片压缩；不影响本轮视觉一致性。

## Required fidelity surfaces

- Fonts and typography: ZCOOL KuaiLe 保留漫画标题，Noto Sans SC 承担正文；修复了深色标题压黑底的问题。标题字号、重量、行高、换行及按钮文字在 390 px 下均清晰。
- Spacing and layout rhythm: 应用壳固定 390 × 844；开局方式、专用私密页、淘汰和结算恢复完整页面结构。5 人房间及 4 对手牌桌使用紧凑布局，底部主操作保持可见。
- Colors and visual tokens: 保留朱红、硫磺黄、暖奶油、炭黑与少量青色；浅色卡片显式使用深色前景，关键 CTA 与状态色语义一致。
- Image quality and asset fidelity: 所有角色、卡面、背景继续使用仓库内原创 raster 资产和 Phosphor 图标，没有用 emoji、CSS 图形或占位框替代设计稿可见资产。
- Copy and content: 房间码改为 `582 913`；内部版本与秒数改为“基础版 2025 · 轻松计时”；恢复教程、回合流程、卡牌详情、设置入口、淘汰与网络同步文案。

## Comparison history

### Iteration 1 — blocked

- P1：Live 全局深色文字造成标题不可读。修复为暖奶油全局前景，浅色表面单独使用深色。
- P1：首页缺开局方式，教学直接进牌桌。补 `PlayModeView` 与三步 `TutorialView`。
- P1：JoinRoom 将加入者设为房主。修复本地房主投影并增加回归测试，成员房间态可达。
- P1：房间头像过小、名字重复、5 人溢出。恢复大头像、单一名字与紧凑 5 人布局。
- P1：Favor、否决、赠牌、拆弹、预见和爆炸使用通用底窗。改为设计稿对应的专用全屏流程。
- P1：淘汰页、卡牌详情、回合流程缺失。补齐全部页面与场景分流。
- P0：淘汰玩家仍可能获得合法动作；赢家 fallback 可能排序错误；重连 sequence 读错。修复 normalizer、场景分流、排序与 `lastAckSeq`。
- P1：私密提示会投放给非目标玩家。投影层现在只给目标可操作 prompt，其他玩家收到等待态；增加爆炸隐私回归断言。
- P2：否决已 Pass 后按钮仍可用、手牌读屏 click 不可靠、4 对手布局挤压。补 viewerPassed/canPass、标准 onClick 与四列紧凑布局。
- P0：独立回归审阅发现目标选择条件 return 位于 Hook 之前，选 Favor/组合会触发 React Hook 数量变化。已将 `useDeadline` 移到条件 return 之前并重新构建。
- P1：成员加入后曾由成员客户端在全员准备后自动开局。现已恢复房主权限：成员准备只更新状态，只有房主明确开始才能进入对局，且成员伪造开局会被拒绝。
- P1：教程启动成功与房间创建成功时 overlay/history 可能残留。场景切换现在同时清空 overlay 栈。

### Iteration 2 — blocked by evidence quality

- 使用应用内浏览器重走登录 → 首页 → 开局方式 → 创建/加入房间，以及教程、规则、卡牌详情、牌桌与结算。
- 增加仅在开发模式可达的静态审查夹具 `#audit/*`，让真实 Live 组件可以稳定呈现瞬时私密/异常状态；生产构建不会进入该分支。
- 首轮截图由桌面视口裁切/缩放，且存在非同状态比较，不能作为最终通过证据。
- 独立审阅标记否决背景、规则四 Tab、他人回合状态、结算遮挡、爆炸 CTA 与夹具动作格式等问题。

### Iteration 3 — passed

- Chrome 通过设备指标覆盖并 reload，每页现场确认 `innerWidth=390`、`innerHeight=844`；24 张实现证据均为直接 390 × 844 截图，页面 `scrollWidth=390`。
- 审查夹具与设计稿对齐大厅人数/准备态、牌桌 6 张手牌/弃牌、Favor 已选目标等瞬时状态，再生成 `final-*.jpg` 同状态比较板。
- 修复生产 CSS 顺序下规则四 Tab 换行、爆炸唯一 ComicButton 被 `:last-child` 弱化、他人回合主状态层级，以及结算页 844 高度布局。
- 三名独立审阅者按页面分组轮流打开比较板复审；大厅空座夹具也改为与设计稿一致的“邀请好友”分支，最终结论均为无 P0/P1/P2，仅保留上述 P3。
- 浏览器控制台无 warning/error；所有主 CTA 均在 390 × 844 画面内，未见横向溢出、原生滚动条泄漏或排名遮挡。
- 浏览器控制台只出现 Vite/React 开发信息，无 warning/error。
- 主交互、返回栈、滚动页、底部 CTA 与输入/按钮可用性已复核。
- `npm test`：30/30；`npm run typecheck`：通过；`npm run build`：通过。

### Iteration 4 — passed

- 补拍卡牌详情的真实 390 × 844 浏览器证据，并以相同“攻击牌”状态生成 `final-card-detail.jpg`；最终证据集为 25 个页面/状态。
- 复审发现局内顶栏菜单入口不可达；现保留规则与行动记录，同时恢复对局菜单，设置、网络状态、认输均可从真实牌桌进入。
- legacy gallery 与审查夹具均限定为开发环境动态加载，生产环境任意 hash 都进入真实 Live 应用。
- Local adapter 移除成员全员准备后的自动开局；仅房主可明确开始，首回合归房主，并加入成员越权与房主正向回归测试。
- 修复后重新捕获牌桌、对局菜单与卡牌详情，生成同状态比较板；无新增 P0/P1/P2。
- 最终规范复审继续覆盖默认加入房间、计时器竞态与对局内教学复习路径；对应回归修复和测试见本轮最终验证。
- 最终规范复审修复三条真实路径：默认加入房间由 Bot 模拟房主在全员就绪后以房主身份开局；过期/提前计时器分别被安全拒绝；对局内重看教学只复习并返回、不替换当前对局。
- `npm test`：48/48；`npm run typecheck`：通过；`npm run build`：通过；`git diff --check`：通过。

## Implementation checklist

- [x] 启动、首页、开局方式、建房/加房、房主/成员房间
- [x] 牌桌、Attack 债务、Favor 目标、否决、赠牌、拆弹、预见、爆炸
- [x] 淘汰、结算、三步教程、规则/详情、记录、菜单、网络、设置
- [x] 私密投影、身份、赢家排序、淘汰 legal actions 与重连 sequence
- [x] 390 × 844 浏览器复截图、同画面对比、控制台检查
- [x] 测试、类型检查、生产构建

## Follow-up polish

- 为否决与五种猫咪牌制作独立原创卡面。
- 上线小程序前做字体子集、WebP/AVIF 转码与包体预算检查。

final result: passed
