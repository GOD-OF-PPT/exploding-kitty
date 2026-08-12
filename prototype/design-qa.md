# Design QA — 爆裂漫画工坊全流程原型

- source visual truth path: `C:\Users\KSG\.codex\generated_images\019ff580-3299-76f0-ba20-9da1dde934f8\exec-7b947574-a240-45ef-8e4d-55dce6bef3e0.png`
- implementation screenshot paths:
  - `E:\githome\exploding-kitty\prototype\qa\screens\game-390x844.png`
  - `E:\githome\exploding-kitty\prototype\qa\screens\response-390x844.png`
  - `E:\githome\exploding-kitty\prototype\qa\screens\explosion-390x844.png`
  - `E:\githome\exploding-kitty\prototype\qa\screens\result-390x844.png`
- latest live implementation evidence: in-app browser capture on 2026-08-12 at 390 × 844, covering Login → Home → Create Room → Lobby → Add Bot → Start Match → Draw → Play Cards → Nope Pass. The browser console contained no warnings or errors.
- comparison boards:
  - `E:\githome\exploding-kitty\prototype\qa\comparison-game.png`
  - `E:\githome\exploding-kitty\prototype\qa\comparison-game-focused.png`
- viewport: 390 × 844 CSS px, DPR 1
- state: `#game` default turn; additional checks on `#response`, `#explosion`, and `#result`
- runtime entry: complete game at `/`; the hash gallery remains available only at `#gallery` for visual regression evidence.

## Full-view comparison evidence

The source and implementation were normalized to the same 390 × 844 content frame and placed together in `qa/comparison-game.png`. Both share the defining composition: three opponent portraits with public hand counts, an oversized red turn banner, two central piles, a sulfur-yellow primary draw burst, and a fanned hand filling the lower red region. The implementation intentionally uses original generated cats, card faces, danger art, and card back rather than any official assets.

## Focused region comparison evidence

`qa/comparison-game-focused.png` compares the turn/pile/action region at readable scale. Hierarchy, black outline weight, cream card edges, stacked pile shadow, asymmetry, and the red/yellow/cream/charcoal palette match the selected direction. The implementation uses a dedicated original card back so the draw pile no longer reveals its top card.

## Required fidelity surfaces

- Fonts and typography: ZCOOL KuaiLe supplies the irregular display voice; Noto Sans SC provides readable body/UI copy. Display titles use heavy optical weight, tight line height and black offset shadows; small labels remain legible without truncation at 390 px. Browser-rendered Chinese glyphs loaded successfully.
- Spacing and layout rhythm: the mobile surface is exactly 390 × 844 on all 25 routes. Full-screen routes have no document overflow; intentionally long `rules` and `history` views scroll inside the phone. Every primary CTA remains in frame. Safe-area offsets were added to bottom actions.
- Colors and visual tokens: implementation tokens preserve hot vermilion (`#f23b20`), sulfur yellow (`#ffc928`), warm cream (`#fff1c7`), charcoal (`#171512`), and limited cyan (`#16bfd2`). Contrast is strongest on primary actions and critical states.
- Image quality and asset fidelity: all visible illustrations are raster assets, not CSS/SVG substitutes. Original card back and danger-card art are 700 × 1000 PNGs. All route images loaded with non-zero natural dimensions. Existing sprite-derived cards/cats are clean at their displayed crops; no official logo, character, or card face is used.
- Copy and content: the standalone product uses coherent Chinese labels for turn, piles, response, private choices, recovery, and results. Privacy copy is explicit on future-view, gift, and defuse states. Defuse is disabled as a normal playable card and its detail says it cannot be actively played or Nope'd.

## Interaction, responsive, and console checks

- 25/25 hash routes render and deep-link directly; browser `hashchange` keeps navigation synchronized.
- Core path tested: 首页 → 开一局 → 创建房间 → 房主房间 → 开始游戏.
- Game branches tested: 透视 → 预见未来 → 返回牌桌; 抽牌 → 爆炸揭示 → 拆弹 → 返回牌桌.
- Secondary paths tested: 6 位房间码 → 成员房间; 帮忙目标 → 被请求者赠牌; Attack debt `3× → 2× → 1× → other-turn`.
- Other-turn and response backgrounds expose disabled pile/hand controls; draw pile uses hidden card back.
- All 25 screens: `phone scrollWidth === 390`, `phone scrollHeight === 844`, images loaded, no clipped primary CTA.
- Desktop: left gallery exposes all 25 boards; mobile breakpoint hides the gallery and preserves the fixed phone surface.
- Keyboard focus: high-contrast `:focus-visible` ring present; game utility icons have accessible names; disabled controls are semantic buttons.
- Browser console: no errors or warnings after final key-route pass.
- Build: `npm run build` passed after the final source and asset changes.

## Findings

No actionable P0, P1, or P2 mismatch remains for the selected art-direction target and prototype scope.

- [P3] Several source-derived card/cat cutouts retain very small neighboring-edge fragments at native resolution. Current fixed crops and dark outlines hide these at delivery size; individually regenerating every character and card would improve production asset hygiene.
- [P3] Font packages emit a large number of CJK subsets in the prototype bundle. This does not affect design fidelity, but a production mini-game should subset fonts and transcode large backgrounds to WebP/AVIF.

## Comparison history

### Iteration 1 — blocked

- P1: direct `#game` and other hash links showed Home. Fixed by using lazy hash initialization, adding `hashchange` synchronization, and validating all 25 deep links.
- P1: draw pile exposed an action-card face. Fixed with a generated original `card-back.png`; post-fix evidence is visible in both comparison boards.
- P1: drawing routed to the Nope response window and joining a code routed to the host lobby. Fixed to route draw → explosion and join → member lobby; browser interaction checks confirmed both.
- P1: Defuse appeared normally playable and Attack debt did not decrement. Fixed by disabling Defuse during normal hand selection and adding the 3 → 2 → 1 → next-player demonstration flow.
- P2: login screen reported internal horizontal overflow. Fixed by constraining the cast container to the screen width; repeated 25-screen metrics showed 390 px.
- P2: several utility and bottom actions had undersized touch areas/no safe-area allowance. Fixed by enlarging icon buttons, adding semantic labels/focus rings, increasing link hit areas, and applying safe-area bottom offsets.

### Iteration 2 — passed

- Rebuilt and recaptured `#game`, `#response`, `#explosion`, and `#result` at 390 × 844.
- Recreated full-view and focused side-by-side comparisons after fixes.
- Re-ran 25-route layout/image/CTA checks, core interaction paths, disabled states, console scan, and production build.
- No actionable P0/P1/P2 issue remained.

### Iteration 3 — live implementation integration passed

- Replaced hash-driven demo state as the default product entry with the real `GameSession` and deterministic rule kernel; retained `#gallery` only for design QA.
- Ran the live product at 390 × 844 through login, room creation, Bot seating, match start, safe draw, Bot turn, action-card selection, response window and Pass resolution.
- Fixed the create/join overlay transition, wrapped-session projection, card identity mapping, turn deadlines, private peek acknowledgement, card-fan indexing and mobile hand spacing.
- Compared the live capture against the existing source/implementation boards: the defining composition, hierarchy, palette, type, asset quality and 390 × 844 frame remain unchanged. No new P0/P1/P2 visual drift was introduced.
- Browser console remained empty for warnings/errors; `npm test`, strict typecheck and production build passed.

## Implementation checklist

- [x] 25-screen gallery and direct hash navigation
- [x] 390 × 844 mobile frame with desktop board index
- [x] Key turn, private-choice, response, danger, recovery, result, and network states
- [x] Original scheme-1 raster assets and icon-library UI controls
- [x] Main clickable flow and representative rule branches
- [x] Responsive, accessibility, image-load, console, and build validation

## Follow-up polish

- Regenerate each cat and card as a fully independent production asset before shipping.
- Subset fonts and transcode heavy PNG backgrounds for a real mini-game package budget.

final result: passed
