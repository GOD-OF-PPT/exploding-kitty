# Canvas 视觉预览与回归证据

本目录用于在普通浏览器中稳定呈现微信小游戏的 Canvas 场景，并生成可复查的视觉证据。它是开发期回归工具，不进入 `apps/minigame/release/`，也不修改生产 renderer、`screenHost`、Canvas metrics、牌桌 surface、资源 manifest 或原始资源。

> 当前文档定义预览与证据的契约。只有实际生成并复核过的文件，才能在 `apps/minigame/design-qa.md` 中标记为通过；不要把矩阵中的“必需”误写成“已完成”。

## 可重复运行

从仓库根目录执行：

```powershell
npm ci
node apps/minigame/scripts/build-visual-preview.mjs
npx vitest run apps/minigame/visual-preview/src/fixtures.test.ts
node apps/minigame/visual-preview/verify-evidence.mjs
python -m http.server 4173 --directory apps/minigame/visual-preview/dist
```

构建输出位于 `apps/minigame/visual-preview/dist/`。构建应只读取并复制以下输入，不应回写它们：

- 生产 UI 与 Canvas 代码：`apps/minigame/src/ui/`
- 小游戏运行时资源：`apps/minigame/assets/`
- 390 × 844 Web 原型基准：`prototype/audit/current/after/`

浏览器截图前必须等待页面的就绪标记。就绪表示字体、场景图片、牌桌图片和基准图均已加载，并且 Canvas 已完成最终重绘；只等待 `DOMContentLoaded` 或固定延时不足以构成可重复证据。预览实现应在满足上述条件后设置：

```js
window.__VISUAL_PREVIEW_READY__ = true;
```

确定性 fixture 还必须满足：固定时间与倒计时、固定玩家与卡牌顺序、固定选中项、固定安全区与胶囊占位，不访问网络、存储、`Date.now()` 或 `Math.random()`。25 个 fixture 应以 `Record<ScreenId, ScreenModel>` 的穷尽类型约束，防止 renderer registry 新增页面后静默漏拍。

## 查询参数

预览 URL 使用以下固定参数：

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `screen` | 任一 `ScreenId` | 默认 `login`；未知值必须显示明确错误，不能回退到其他页面 |
| `viewport` | `390x844`、`372x749`、`389x584` | 控制目标 Canvas 的 CSS 像素尺寸；禁止把固定 390 × 844 画面整体缩放或 letterbox |
| `mode` | `canvas`、`compare` | `canvas` 只显示当前 Canvas；`compare` 左侧显示 Web 原型基准、右侧显示当前 Canvas |

示例：

```text
http://127.0.0.1:4173/?screen=game&viewport=390x844&mode=canvas
http://127.0.0.1:4173/?screen=game&viewport=390x844&mode=compare
http://127.0.0.1:4173/?screen=attack&viewport=389x584&mode=canvas
```

`390x844`、`372x749`、`389x584` 经宽度优先换算后的逻辑高度分别约为 `844`、`785.24`、`585.50`，对应 renderer 的 `tall`、`compact`、`short` 三档。截图文件必须保留目标 CSS 像素尺寸；DPR 只影响 backing store，不应改变证据 PNG 的外部尺寸。

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

## 证据目录与命名

实际截图应写入源码构建目录之外，以便审阅和提交：

```text
apps/minigame/visual-preview/evidence/
├── current/
│   ├── canvas-login-390x844.png
│   ├── canvas-home-390x844.png
│   └── canvas-attack-389x584.png
├── comparisons/
│   ├── compare-login-prototype-vs-canvas-390x844.png
│   └── compare-home-prototype-vs-canvas-390x844.png
├── manifest.json
├── overview-current-390x844.jpg
├── overview-comparisons-390x844.jpg
└── overview-short-screens.jpg
```

命名规则：

- 当前 Canvas：`current/canvas-<screenId>-<width>x<height>.png`
- 同尺寸比较：`comparisons/compare-<screenId>-prototype-vs-canvas-390x844.png`
- 使用无损 PNG；不要把浏览器外壳、DevTools、滚动条或鼠标指针截入证据。
- `manifest.json` 应记录 ScreenId、viewport、fixture 版本、路径模板、捕获时的 source base commit 和文件 SHA-256。最终提交 SHA 在提交后由交付说明给出，避免清单自引用；没有实际文件的条目不得写成已捕获。

## 审查与限制

`apps/minigame/design-qa.md` 应分别报告：

1. 25 屏 390 × 844 Canvas 完整性；
2. 25 张同尺寸 Web 原型 / Canvas 比较；
3. 八家族在 `372x749` 与 `389x584` 的短屏结果；
4. 按 P0 / P1 / P2 登记的问题、对应证据路径和复测状态。

建议严重度：P0 为页面空白、崩溃、关键玩法信息或唯一主操作不可见/不可达；P1 为安全区、胶囊、主要内容或操作发生遮挡，或图片明显变形；P2 为不阻断使用的间距、对齐、换行、字体或装饰差异。

浏览器 Canvas 证据可以证明 fixture、renderer registry、宽度优先布局和资源加载在受控环境中的结果，但不能替代微信开发者工具或 iOS/Android 真机验收。它不单独证明真实平台 DPR、系统字体回退、触摸命中、滚动惯性、胶囊 API、分享/键盘/音频行为或 GPU 差异。最终结论应写成“浏览器 Canvas 回归”与“微信平台验收”两个独立状态。
