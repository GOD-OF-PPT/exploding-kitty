# Canvas 视觉预览与回归证据

本目录用于在普通浏览器中稳定呈现微信小游戏的 Canvas 场景，并生成可复查的视觉证据。它是开发期回归工具，不进入 `apps/minigame/release/`，也不修改生产 renderer、`screenHost`、Canvas metrics、牌桌 surface、资源 manifest 或原始资源。

> 当前文档定义预览与证据的契约。只有实际生成并复核过的文件，才能在 `apps/minigame/design-qa.md` 中标记为通过；不要把矩阵中的“必需”误写成“已完成”。

## 可重复运行

从仓库根目录执行：

```powershell
npm ci
node apps/minigame/scripts/build-visual-preview.mjs
npx vitest run apps/minigame/visual-preview/src
npx tsc -p apps/minigame/visual-preview/tsconfig.json --noEmit
node --test apps/minigame/visual-preview/capture-evidence.test.mjs apps/minigame/visual-preview/verify-evidence.test.mjs
node apps/minigame/visual-preview/verify-evidence.mjs
python -m http.server 4173 --directory apps/minigame/visual-preview/dist
```

## 单命令生成 schema v3 证据

正式批次必须写入一个显式指定、且不存在或完全为空的目录。runner 对仓库内路径只允许
`apps/minigame/visual-preview/evidence`；如果该目录仍含旧批次，它会在构建或启动浏览器前失败，
不会覆盖任何文件。归档旧批次并冻结源码与资源后，从仓库根目录执行：

```powershell
npm --workspace @exploding-kitty/minigame run capture:evidence -- --output-dir apps/minigame/visual-preview/evidence
```

runner 会自行完成以下步骤：

1. 重建 `visual-preview/dist`，并从 verifier 导出的 schema v3 contract 计算 bundle hash、输入指纹和 source snapshot；
2. 启动仅绑定 `127.0.0.1` 的临时静态服务，以及带独立 TEMP profile 的本机 Headless Chrome/Chromium；
3. 固定真实 Browser viewport 为 `389 × 584`，严格按页面暴露的 `CAPTURE_PLAN` 顺序，通过 CDP
   `Runtime.evaluate` 调用 `capturePng()`；comparison 会先注入同屏已验收 DPR1 current PNG；
4. 生成 42 current、50 DPR2/3 density、2 interaction 和 25 comparison，共 119 次直接捕获；
5. 从已捕获的 current/comparison 无损派生 11 张固定 focus crop，计算 25 个 reference hash，并生成 schema v3 manifest；
6. 在同卷 staging 目录中先运行 strict verifier；通过后原子 rename 到目标目录，再立即运行一次 strict verifier。

任一步失败时，空目标目录不会被半批次替换。需要保留失败 staging 进行排查时可加
`--keep-failed`。runner 会自动查找 Windows、macOS 和常见 Linux 安装位置的 Chrome；找不到时使用：

```powershell
npm --workspace @exploding-kitty/minigame run capture:evidence -- --output-dir apps/minigame/visual-preview/evidence --chrome "C:\path\to\chrome.exe"
```

macOS 示例路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。前置依赖只有本仓库
`npm ci` 安装结果、支持全局 `fetch`/`WebSocket` 的 Node.js，以及本机 Chrome/Chromium；无需 Playwright、
Puppeteer、Python 服务或额外浏览器自动化包。正式目录之外也可传绝对空目录做预演，runner 仍会在该目录上
执行同一 strict verifier，但正式交付必须使用上述 canonical evidence 路径。

构建输出位于 `apps/minigame/visual-preview/dist/`。构建应只读取并复制以下输入，不应回写它们：

- 生产 UI 与 Canvas 代码：`apps/minigame/src/ui/`
- 小游戏运行时资源：`apps/minigame/assets/`
- 390 × 844 Web 原型基准：`prototype/audit/current/after/`

浏览器截图前必须等待页面的就绪标记。就绪表示字体、场景图片、牌桌图片和基准图均已加载，并且 Canvas 已完成最终重绘；只等待 `DOMContentLoaded` 或固定延时不足以构成可重复证据。预览实现应在满足上述条件后设置：

```js
window.__VISUAL_PREVIEW_READY__ = true;
```

页面还暴露 `window.__VISUAL_PREVIEW_CAPTURE__`。需要单独检查稳定记录时可以调用：

```js
const record = await window.__VISUAL_PREVIEW_CAPTURE__.stabilize();
```

该调用会等待 ready，并在每次相隔 6 个 animation frame 的连续 3 次 RGBA SHA-256 完全一致后
返回。记录包含 selector、Canvas intrinsic size、DOMRect、实际浏览器 viewport、renderer
viewport、显式 `renderDpr`、sample hashes 和固定的 capture method。`capturePng()` 自身会执行同一稳定门，调用方不需要先重复调用 `stabilize()`。最终 PNG 必须通过 CDP
`Runtime.evaluate` 调用同一接口的 `capturePng()`，由目标 Canvas 自身执行
`toDataURL("image/png")`；禁止使用 `Page.captureScreenshot`：

```js
const { dataUrl, pngByteSha256, record } =
  await window.__VISUAL_PREVIEW_CAPTURE__.capturePng();
```

调用方只需 Base64 解码 `dataUrl` 写盘。工具会在导出后再次核对 Canvas pixel hash，
确保稳定采样与实际导出的 PNG 属于同一帧。
捕获计划固定浏览器 viewport 为实际的 `389 × 584`；目标证据尺寸来自 Canvas intrinsic
size，和 renderer viewport 分开记录，因此 964 × 964 comparison 不依赖浏览器视口截图。

comparison 捕获不能直接使用 live Canvas。先把已经验收并保存的 390 × 844 current PNG
作为 data URL 或同源 URL 注入：

```js
const record = await window.__VISUAL_PREVIEW_CAPTURE__.composeAcceptedCurrentPng(currentPngUrl);
```

工具会校验 PNG 尺寸，记录 PNG 字节 SHA-256，并要求其解码后像素 hash 与
`#evidence-frame` 右侧 390 × 844 区域 hash 完全相同。未完成这一步时，comparison 的
`stabilize()` 会以 `VISUAL_PREVIEW_ACCEPTED_CURRENT_REQUIRED` 拒绝捕获。
完整的直接捕获计划可从 `window.__VISUAL_PREVIEW_CAPTURE__.plan` 读取，共 119 张：
42 张 initial current（25 张 standard、16 张八家族 short、1 张 `network@372x749`
窄屏探针）、2 张滚到底 interaction、25 屏各一张 DPR2 和 DPR3 density（共 50 张），
以及 25 张 comparison。另有 11 张 focus
由已验收 current/comparison PNG 离线精确裁切，不属于直接捕获计划。

两张 interaction 必须在 ready 和稳定采样前以非动画方式把 `#scene-scroll` 滚到
`maxScrollTop`，并保留完整 Canvas capture record、滚动几何、source snapshot 和对应
initial current 的字节/像素绑定。它们是完整 Canvas PNG，不得伪装成 focus crop：

- `focus/focus-network-scroll-end-372x749.png`
- `focus/focus-rules-scroll-end-389x584.png`

确定性 fixture 还必须满足：固定时间与倒计时、固定玩家与卡牌顺序、固定选中项、固定安全区与胶囊占位，不访问网络、存储、`Date.now()` 或 `Math.random()`。25 个 fixture 应以 `Record<ScreenId, ScreenModel>` 的穷尽类型约束，防止 renderer registry 新增页面后静默漏拍。

## 查询参数

预览 URL 使用以下固定参数：

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `screen` | 任一 `ScreenId` | 默认 `login`；未知值必须显示明确错误，不能回退到其他页面 |
| `viewport` | `390x844`、`372x749`、`389x584` | 控制目标 Canvas 的 CSS 像素尺寸；禁止把固定 390 × 844 画面整体缩放或 letterbox |
| `mode` | `canvas`、`compare` | `canvas` 只显示当前 Canvas；`compare` 左侧显示 Web 原型基准、右侧显示当前 Canvas |
| `dpr` | `1`、`2`、`3` | 默认 `1`；控制 Canvas backing store，CSS viewport 保持不变。`compare` 只允许 `1`，避免破坏 accepted-current 的逐字节契约 |
| `state` | `initial`、`scroll-end` | 默认 `initial`；`scroll-end` 只允许固定矩阵中的 Canvas interaction，未知状态、错误页面/viewport、无溢出或未滚到底都必须失败 |
| `capture` | `evidence`（可选） | 仅用于 `compare` 证据捕获；隐藏工具栏与索引，并把完整双面板固定为 964 × 964 |

示例：

```text
http://127.0.0.1:4173/?screen=game&viewport=390x844&mode=canvas
http://127.0.0.1:4173/?screen=game&viewport=390x844&mode=canvas&dpr=3
http://127.0.0.1:4173/?screen=game&viewport=390x844&mode=compare
http://127.0.0.1:4173/?screen=attack&viewport=389x584&mode=canvas
http://127.0.0.1:4173/?screen=network&viewport=372x749&mode=canvas&state=scroll-end
http://127.0.0.1:4173/?screen=rules&viewport=389x584&mode=canvas&state=scroll-end
http://127.0.0.1:4173/?screen=game&viewport=390x844&mode=compare&capture=evidence
```

`390x844`、`372x749`、`389x584` 经宽度优先换算后的逻辑高度分别约为 `844`、`785.24`、`585.50`，对应 renderer 的 `tall`、`compact`、`short` 三档。current、interaction 和 comparison 保持 DPR1，以维持既有布局与逐像素对照；density 使用显式 DPR2/3 backing store：CSS 尺寸仍为 390 × 844，intrinsic/PNG 分别为 780 × 1688 和 1170 × 2532。浏览器自身的 `window.devicePixelRatio` 只作为环境元数据记录，不能替代 `renderDpr`。

清晰度不得再由 DPR1 current 单独签署。每个 standard `ScreenId` 必须同时具有 DPR1 current、DPR2 density 和 DPR3 density；捕获记录 schema v2 会校验 `intrinsic = renderViewport × renderDpr`。verifier 还会把 density 与同屏 DPR1 的 nearest-neighbor、预乘 Alpha bilinear 两种机械放大基线逐像素比较，拒绝只是复制或双线性插值出来的“高 DPR”PNG。该门禁不声称能穷举 Lanczos 等所有重采样，因此资源侧的 `assets.manifest.json` 还必须用 `rasterContractVersion: 1` 为每个 raster 声明 `role`、`intrinsic`、`maxCssSize`、`targetDpr`、`fit`、`maxCropRatio` 和 `edgePolicy`。构建门禁会校验原生像素尺寸、统一卡牌比例、`cover` 裁切上限，以及非 bleed 素材的硬切、邻图残片和异常 Alpha；高 DPR PNG 与资源门禁必须同时通过。

## 25 屏 390 × 844 基线矩阵

每个 `ScreenId` 都必须生成一张纯 Canvas 截图和一张同屏比较图。基准文件均为真实的 390 × 844 PNG；除 `lobby-host` 外，文件 stem 与 `ScreenId` 相同。

| 家族 | `ScreenId` | Web 原型基准 |
| --- | --- | --- |
| brand | `login` | `implementation-login-390x844-final.png` |
| brand | `home` | `implementation-home-390x844-final.png` |
| room entry | `play-mode` | `implementation-play-mode-390x844-final.png` |
| room entry | `create` | `implementation-create-390x844-final.png` |
| room entry | `join` | `implementation-join-390x844-final.png` |
| lobby | `lobby-host` | `implementation-lobby-390x844-final.png` |
| lobby | `lobby-member` | `implementation-lobby-member-390x844-final.png` |
| table | `game` | `implementation-game-390x844-final.png` |
| table | `other-turn` | `implementation-other-turn-390x844-final.png` |
| table | `attack` | `implementation-attack-390x844-final.png` |
| table | `response` | `implementation-response-390x844-final.png` |
| choice | `favor` | `implementation-favor-390x844-final.png` |
| choice | `give-card` | `implementation-give-card-390x844-final.png` |
| choice | `future` | `implementation-future-390x844-final.png` |
| choice | `defuse` | `implementation-defuse-390x844-final.png` |
| outcome | `explosion` | `implementation-explosion-390x844-final.png` |
| outcome | `eliminated` | `implementation-eliminated-390x844-final.png` |
| outcome | `result` | `implementation-result-390x844-final.png` |
| editorial | `tutorial` | `implementation-tutorial-390x844-final.png` |
| editorial | `rules` | `implementation-rules-390x844-final.png` |
| editorial | `card-detail` | `implementation-card-detail-390x844-final.png` |
| editorial | `history` | `implementation-history-390x844-final.png` |
| utility | `game-menu` | `implementation-game-menu-390x844-final.png` |
| utility | `network` | `implementation-network-390x844-final.png` |
| utility | `settings` | `implementation-settings-390x844-final.png` |

比较页必须保持两张图的自然尺寸，不得拉伸、裁切或用已有的 `prototype/audit/current/comparisons/final-*.jpg` 代替。后者记录的是“设计稿 vs Web 原型”，不是“Web 原型 vs 小游戏 Canvas”。比较页标签应明确区分 `Prototype audit / current / after` 和 `Mini Game Canvas renderer`。

## 八家族短屏矩阵

最低短屏覆盖为八个家族各一个高风险代表，并在两个非基线 viewport 上都截图，共 16 张。代表页与检查重点如下：

| 家族 | 代表 `ScreenId` | `372x749` | `389x584` | 重点检查 |
| --- | --- | --- | --- | --- |
| brand | `home` | 必需 | 必需 | 三层主操作、品牌字、hero 与底部版本字是否同时可见 |
| room entry | `create` | 必需 | 必需 | 稠密表单、返回区与底部操作是否可滚动且不互相遮挡 |
| lobby | `lobby-host` | 必需 | 必需 | 房间码、五席位、准备状态和操作网格是否保留 44 px 命中高度 |
| table | `attack` | 必需 | 必需 | 四名对手、牌堆/弃牌、六张手牌、欠回合印章与固定操作是否冲突 |
| choice | `defuse` | 必需 | 必需 | 私密 hero、说明、牌堆插入位置与确认操作是否完整 |
| outcome | `result` | 必需 | 必需 | winner、排名滚动区与两项结算操作是否遮挡 |
| editorial | `rules` | 必需 | 必需 | 四个 tab、长列表、滚动边界与固定返回操作是否正常 |
| utility | `settings` | 必需 | 必需 | 资料卡、三项设置、法务文案与完成操作是否可达 |

如时间允许，优先追加 `response`（绝对定位响应窗）、`give-card`（密集手牌网格）、`explosion`（大图和底部 CTA）三个 `389x584` 风险探针。它们属于增强覆盖，不应取代上表的八家族最低矩阵。

短屏截图验证的是宽度优先布局和内容可达性。现有 Web 原型基准只有 390 × 844，因此短屏可以与基准同页展示作视觉语义参考，但必须标注“不同 viewport，不做像素级一致性判断”。只有 390 × 844 比较图可以作为同尺寸对齐证据。

八家族 16 张 short 不得被额外探针替换。除此之外，矩阵还固定要求
`network@372x749` 的 initial current，以及 `network@372x749`、`rules@389x584`
各一张滚到底 interaction，用来证明窄屏内容与固定操作区在真实终态可达。

## 证据目录与命名

实际截图应写入源码构建目录之外，以便审阅和提交：

```text
apps/minigame/visual-preview/evidence/
├── current/
│   ├── canvas-login-390x844.png
│   ├── canvas-home-390x844.png
│   └── canvas-attack-389x584.png
├── density/
│   ├── canvas-login-390x844-dpr2.png
│   ├── canvas-login-390x844-dpr3.png
│   └── canvas-game-390x844-dpr3.png
├── comparisons/
│   ├── compare-login-prototype-vs-canvas-390x844.png
│   └── compare-home-prototype-vs-canvas-390x844.png
├── focus/
│   ├── focus-home-brand-prototype-vs-canvas.png
│   ├── focus-network-scroll-end-372x749.png
│   └── focus-rules-scroll-end-389x584.png
└── manifest.json
```

命名规则：

- 当前 Canvas：`current/canvas-<screenId>-<width>x<height>.png`
- 清晰度 Canvas：`density/canvas-<screenId>-390x844-dpr<2|3>.png`
- 同尺寸比较：`comparisons/compare-<screenId>-prototype-vs-canvas-390x844.png`
- 11 张离线派生重点裁图：`focus/focus-<focusId>.png`；必须逐像素等于固定 source/crop。
- 2 张直接 interaction：`focus/focus-<screenId>-scroll-end-<width>x<height>.png`；必须是完整 Canvas，禁止出现 `sourceFile` 或 `crop`。
- 使用无损 PNG；不要把浏览器外壳、DevTools、滚动条或鼠标指针截入证据。
- `manifest.json` 应记录 ScreenId、viewport、fixture 版本、路径模板、捕获时的 source base commit 和文件 SHA-256。最终提交 SHA 在提交后由交付说明给出，避免清单自引用；没有实际文件的条目不得写成已捕获。

Schema v3 的集合必须精确闭合为 42 `current`、50 `density`、2 `interactionCaptures`、25
`comparisons`、25 `references.items` 和 11 个派生 `focus`。`focus/` 目录是后两类
PNG 的物理容器，目录集合必须恰好等于 11 个派生 focus 与 2 个 direct interaction
的并集；evidence 根目录只允许 `current/`、`density/`、`comparisons/`、`focus/` 和
`manifest.json`。interaction 必须通过 `initialCapture {file, sha256, pixelHash}` 绑定同屏、
同 viewport、同 source snapshot 的 initial current，且终态 PNG 字节与 RGBA 都必须不同。

仓库中任何旧 schema v2 manifest 和仅 DPR1 的证据批次都应以
`EVIDENCE_SCHEMA_UNSUPPORTED` 判废；在新构建冻结后必须重新生成完整 schema v3 批次，
不得手工给旧 manifest 补字段冒充 DPR2/3 捕获。

## 审查与限制

`apps/minigame/design-qa.md` 应分别报告：

1. 25 屏 390 × 844 Canvas 完整性；
2. 25 张同尺寸 Web 原型 / Canvas 比较；
3. 八家族在 `372x749` 与 `389x584` 的短屏结果；
4. `network@372x749` initial/滚到底与 `rules@389x584` 滚到底的内容可达性；
5. 25 屏 DPR1/2/3 清晰度矩阵与资源门禁结果；
6. 按 P0 / P1 / P2 登记的问题、对应证据路径和复测状态。

建议严重度：P0 为页面空白、崩溃、关键玩法信息或唯一主操作不可见/不可达；P1 为安全区、胶囊、主要内容或操作发生遮挡，或图片明显变形；P2 为不阻断使用的间距、对齐、换行、字体或装饰差异。

浏览器 Canvas 证据可以证明 fixture、renderer registry、宽度优先布局、资源加载及显式 DPR1/2/3 backing-store 绘制在受控环境中的结果，但不能替代微信开发者工具或 iOS/Android 真机验收。它仍不能单独证明真实设备 GPU 采样、纹理解码、系统字体回退、触摸命中、滚动惯性、胶囊 API、分享/键盘/音频行为。最终结论应写成“浏览器 Canvas 回归”与“微信平台验收”两个独立状态。
