# 设计 QA 汇总

## 创建房间 · 方案 3

- source visual truth path: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\create-room-implementation\target-390x844.png`
- implementation screenshot path: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\create-room-implementation\implementation-final.png`
- full-view comparison evidence: `C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\create-room-implementation\comparison-final.png`
- responsive evidence: `implementation-395x713.png`、`implementation-389x584.png`
- viewport/state: `390 × 844`；4 人、45 秒、机器人开启

### Findings

标准屏与响应式浏览器夹具中没有遗留的 P0、P1 或 P2 问题。

- Layout and spacing: 返回键、标题、双参数卡、机器人卡、规则摘要和 CTA 的边界、顺序与纵向节奏均与方案 3 对齐；390×844 对照中核心区块没有重叠、裁切或明显密度漂移。
- Typography: 数字与单位拆分为独立层级；标题、数值、单位、摘要和辅助文案均使用既有展示字体，未出现截断、换行或拥挤。
- Shape and imagery: 参数卡和机器人卡使用真实透明撕纸位图；标题与 CTA 使用专用漫画位图；没有用 emoji、内联 SVG、CSS 图形或占位框替代目标资产。
- States and behavior: 玩家人数 2–5、行动计时 30/45/60、机器人开关、边界禁用、发送锁、失败提示、返回和 `CreateRoom` 提交均保持真实状态；发送期间设置与返回不会产生“按下但无效果”的反馈。
- Accessibility: 两侧步进器逻辑触控宽度提升至 46；禁用态同时提供颜色、透明度与不可缩放反馈。机器人开关以文字显示“已开启/已关闭”，不只依赖颜色。
- Responsiveness: 395×713 使用紧凑布局；389×584 使用超紧凑布局并折叠规则明细，CTA 始终可见、可达。390×844 的 iPhone 底部安全区会按实际 inset 上移 CTA。
- Remaining P3: 规则摘要框使用现有书本图标和原生细边框，目标稿的笔刷双框与冠形书本细节存在轻微纹理差异；不影响结构、语义、可读性或交互。

### Primary Interactions Tested

- 玩家人数：4 → 5 → 2；上下边界正确禁用
- 行动计时：45 → 60 → 30；上下边界正确禁用
- 机器人补位：开启 ↔ 关闭；摘要同步更新
- `创建房间` → `CreateRoom`
- 返回入口 → 上一层页面
- 390×844、395×713、389×584：CTA 均保持在画布与安全区内
- Browser console: 当前构建 0 warning、0 error

### Build and Platform Evidence

- Assets: `2,881,118` bytes；production release: `3,240,756 / 3,355,443` bytes；preview release: `3,240,753 / 3,355,443` bytes；63 个 raster contract 全部通过。
- Production 与 preview 均使用 `cloudContainer`：环境 `prod-d0g8qcwrb047789af`、服务 `exploding-kitty-api`。
- 两种构建均不包含 `localhost` 或 `127.0.0.1`。
- 微信开发者工具 CLI 使用 AppID `wxd8938809dbb08d94` 成功生成最新 preview；上传总大小 `3,327,304 / 3,355,443` bytes。
- 最新二维码：`C:\Users\KSG\.codex\worktrees\5ff3\exploding-kitty\.codex-tmp\wechat-preview\qr-create-option3-final.png`。
- `npm run typecheck`、现有测试、production build、preview build 均通过；未新增测试。

### QA Status

- Design-to-browser comparison: passed
- Final WeChat platform visual QA: blocked until this final preview QR is scanned and a fresh real-device screenshot is supplied

---

## 首页设计稿还原 Design QA

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

---

## 设置页 Design QA

- reported screenshot: `C:\Users\KSG\AppData\Local\Temp\codex-clipboard-74c2cb54-698d-4331-b550-bde5e8b9f8e8.png`
- selected product visual system: `.codex-tmp/create-audit/08-create-final-390x844.png`
- final implementation: `.codex-tmp/settings-audit/15-settings-final-390x844.png`
- short-screen implementation: `.codex-tmp/settings-audit/16-settings-final-386x673-safe.png`
- exact reported viewport implementation: `.codex-tmp/settings-audit/17-settings-final-385x494.png`
- disabled-state implementation: `.codex-tmp/settings-audit/18-settings-final-385x494-off.png`
- final side-by-side comparison: `.codex-tmp/settings-audit/19-settings-final-comparison-385x494.png`
- viewport/state: `390 × 844` 标准屏；`386 × 673` 且顶部 47、底部 34 安全区的短屏；用户截图同尺寸 `385 × 494`；声音和触感均覆盖开、关状态

### Visual Truth

用户截图定义原页面的真实信息和问题；用户要求“同理优化”，因此远端最新的创建房间方案 3 定义这次采用的视觉系统。最终实现沿用黑、奶油、亮黄、青色、红色、硬边框与漫画笔刷，不复刻原截图中的通用表单外观。

### Findings

没有遗留的 P0、P1 或 P2 问题。

- Typography: 标题、卡片标题、状态和 CTA 使用既有漫画显示字体；说明文字保持可读字号。显示字体子集覆盖 298 个所需字符，0 缺字。
- Layout: 标准屏按“标题—设备卡—两项控制—隐私说明—完成 CTA”建立明确层级；短屏会收紧卡片高度与间距。用户截图同尺寸 `385 × 494` 下全部信息与 CTA 一屏完整可见，无隐藏滚动内容。
- Controls: 声音与触感使用不同图标和一致的大尺寸开关，开关逻辑命中区不小于 44 CSS px；开、关同时用颜色、滑块位置、文字和状态说明表达。
- Privacy: 原先类似禁用表单项的“隐私说明”已改为非交互信息面板，明确说明本机偏好和会话恢复数据边界。
- Assets: 标题笔刷、齿轮、声音、设备、锁、爆点和 CTA 全部复用项目真实位图资产，无 emoji、内联 SVG、CSS 假图标或占位图。
- Product consistency: 返回按钮、硬阴影、卡片边框和 CTA 与创建房间页统一；真实微信右上角胶囊仍由系统绘制，应用内容为其保留空间。

## Comparison History

1. Initial diagnosis — 原截图为通用设置表单：空白过多、控制项缺少视觉层级、隐私项像禁用输入、主按钮与项目漫画风格脱节。
2. Pass 1 — 引入设备身份卡、漫画控制卡、隐私信息面板与笔刷 CTA；发现触感图标语义不够直接，改用真实 `device-mobile` 图标。
3. Pass 2 — 双行 CTA 副文案落入透明笔刷边缘，改为单行“完成设置”，保持视觉中心稳定。
4. Final pass — 提升说明文字可读性、恢复高对比关闭态、按资产契约收回齿轮尺寸，并增加 `≤520 px` 超短屏密度；`385 × 494` 同尺寸对比确认全部内容一屏可见。标准屏与带安全区短屏也均无裁切、重叠或控制台异常。

## Primary Interactions Tested

- 声音：开启 → 关闭，振动状态保持不变
- 触感：开启 → 关闭，声音状态保持不变
- 开关重绘后状态保持，并继续写入既有 `ek.media.v1` 本机偏好
- 返回：回到来源页
- 完成设置：回到来源页
- 最终标准屏、带安全区短屏和 `385 × 494` 同尺寸屏：0 warning、0 error

## Build and Platform Evidence

- TypeScript 全仓检查通过。
- 小游戏测试 `651/651` 通过；prototype 测试 `48/48` 通过；未新增测试。
- Production 与 preview 构建均通过；最终 preview release 为 `3,251,757` bytes。
- 最终包鉴权方式为 `cloudContainer`，包含环境 `prod-d0g8qcwrb047789af` 和服务 `exploding-kitty-api`。
- 最终包不包含 `localhost`、`127.0.0.1` 或 `0.0.0.0`；bundle smoke 通过。
- 资产检查：69 个资产、63 个光栅契约、字体 298 个需求字符且 0 缺字。
- 微信开发者工具 CLI 使用 AppID `wxd8938809dbb08d94` 成功 preview；平台统计 `3,343,916` bytes，低于 `3,355,443` bytes 门槛。
- 新二维码：`.codex-tmp/wechat-preview/settings-preview-qrcode.png`

## Implementation Checklist

- [x] 真实运行时设置页与视觉预览共用同一渲染实现
- [x] 漫画化标题、设备卡、控制卡、隐私面板和 CTA
- [x] 保留声音、触感、本机存储、来源感知返回语义
- [x] 标准屏、带安全区短屏和用户截图同尺寸 `385 × 494` 适配通过
- [x] 字体、资产、云托管配置、包体和微信 CLI preview 通过

---

## 秘密插牌页 Design QA

- reported screenshot: `C:\Users\KSG\AppData\Local\Temp\codex-clipboard-020a2353-0111-4779-a984-a31eeef3f5ad.png`
- final implementation: `.codex-tmp/defuse-audit/defuse-countdown-fixed-383x770.png`
- standard safe-area implementation: `.codex-tmp/defuse-audit/defuse-final-390x844.png`
- short-screen implementation: `.codex-tmp/defuse-audit/defuse-short-389x584.png`
- middle-position state: `.codex-tmp/defuse-audit/defuse-middle-383x770.png`
- bottom-position state: `.codex-tmp/defuse-audit/defuse-bottom-383x770.png`
- battle-report state: `.codex-tmp/defuse-audit/defuse-activity-countdown-fixed-383x770.png`
- final side-by-side comparison: `.codex-tmp/defuse-audit/defuse-before-after-383x770.png`
- viewport/state: 用户截图同尺寸 `383 × 770`、标准安全区 `390 × 844`、超短屏 `389 × 584`；覆盖牌堆顶、中间、牌堆底和战报展开状态

### Visual Truth

用户截图定义旧页面的信息、状态和主要交互问题；已完成的创建房间页与设置页定义本轮采用的漫画视觉系统。新版没有改变“拆弹后选择危险牌插回位置”的产品语义，而是把危险牌、牌堆、秘密状态、位置范围和确认结果显式可视化。

### Findings

没有遗留的 P0、P1 或 P2 问题。

- Information hierarchy: 页面按“倒计时与战报—秘密状态—危险牌放回牌堆—位置选择—确认”组织，关键任务无需从说明文字中推断。
- Position semantics: 真实范围为 `0..deckSize`，即四张牌时明确提供五个位置；牌堆顶、牌堆底和中间位置都有独立文案，当前选择同时显示序号、进度和落点含义。
- Controls: 两侧按钮分别表达向牌堆顶和牌堆底移动；达到边界后采用禁用视觉并阻止越界。提交按钮在确认前重复当前落点，减少误操作。
- Game continuity: 实时倒计时继续使用 `screen-eyebrow`，战报入口、未读数、最新事件横幅、详情遮罩和关闭逻辑全部保留。
- Responsive layout: `383 × 770`、`390 × 844` 与 `389 × 584` 均完整显示主 CTA；战报抽屉按逻辑屏高计算，短屏仍能看到最新事件，无遮挡或裁切。
- Assets and visual system: 复用项目真实危险牌、牌背、锁、箭头、标题笔刷和 CTA 位图；未使用 emoji、内联 SVG、CSS 假图标或占位图。黑、奶油、亮黄、青色、红色和硬边框与现有漫画页面一致。

## Comparison History

1. Initial diagnosis — 原页面以单张牌背、通用步进器和大面积空白表达秘密插牌，无法直观看出危险牌正在回到牌堆，也不能快速判断当前位置与牌堆顶/底的关系。
2. Pass 1 — 建立危险牌到牌堆的视觉转移、秘密状态条、五位置进度和双向控制；确认生产模型只包含一行 `position`，删除旧三行假设。
3. Interaction pass — 发现按钮子文本会被递归点击绑定导致单击双增量，改为按钮自身 `value`，验证每次点击只移动一个位置。
4. Responsive pass — 根据真实逻辑屏高调整标题、卡面、选择器、CTA 和战报抽屉；短屏与安全区状态均一屏完成核心任务。
5. Countdown repaint pass — 修复局部倒计时重绘使用旧页面背景色造成的亮色块；战报打开时暂停隐藏标题的局部重绘，关闭战报后完整渲染会立即恢复最新倒计时，避免遮罩穿透和低端真机闪烁。
6. Final comparison — `.codex-tmp/defuse-audit/defuse-before-after-383x770.png` 并排检查后，P0/P1/P2 清零；修复后等待多次倒计时刷新并重新捕获主页面和战报页，浏览器 Canvas 控制台 0 warning、0 error。

## Primary Interactions Tested

- 牌堆顶减号保持位置 `0`，不会越界
- 连续加号按 `1 → 2 → 3 → 4` 单步移动
- 牌堆底加号保持位置 `4`，不会越界
- 从牌堆底减号回到位置 `3`
- 提交精确发出 `{ "type": "InsertKitten", "promptId": "insert-audit", "position": 3 }`
- 战报展开、最新事件可见、关闭后恢复主操作页

## Build and Platform Evidence

- TypeScript 全仓检查通过。
- 小游戏测试 `651/651` 通过；prototype 测试 `48/48` 通过；未新增测试。
- Production 与 preview 构建通过，资产检查为 69 个资产、63 个光栅契约、字体 297 个需求字符且 0 缺字。
- 最终包鉴权方式为 `cloudContainer`，包含环境 `prod-d0g8qcwrb047789af` 和服务 `exploding-kitty-api`，不包含 `localhost` 或 `127.0.0.1`。
- 背景图在显示尺寸下完成无可见损失重压缩；对比证据为 `.codex-tmp/defuse-audit/comic-bg-q42-comparison.png`。
- 微信开发者工具 CLI 使用 AppID `wxd8938809dbb08d94` 成功 preview；平台统计 `3,347,834` bytes，低于 `3,355,443` bytes 的 20% 余量门槛。
- 新二维码：`.codex-tmp/wechat-preview/defuse-preview-qrcode.png`。
- 浏览器真实 ScreenHost 实现级视觉与交互 QA 已通过；微信平台最终视觉复核仍需扫码后的最新真机截图，因此该平台复核项当前为 blocked，不影响本次实现级验收结论。

## Implementation Checklist

- [x] 真实运行时使用专用秘密插牌模板，不再复用通用产品页结构
- [x] 危险牌、牌堆、秘密状态与插入位置建立直接视觉关系
- [x] `0..deckSize` 边界、单步移动和提交 payload 验证通过
- [x] 倒计时、战报入口、未读状态和详情遮罩完整保留
- [x] 用户截图同尺寸、标准安全区和超短屏适配通过
- [x] 字体、资产、云托管配置、包体和微信 CLI preview 通过

final result: passed
