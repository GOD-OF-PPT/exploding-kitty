# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Selected design direction

- Visual source: the first generated ideation mock, “爆裂漫画工坊”.
- Preserve: hot vermilion, sulfur yellow, warm cream, charcoal and small cyan accents; torn-paper panels; halftone/screen-print texture; thick black outlines; asymmetrical comic hierarchy; original mischievous cat cast.
- Product surface: 390 x 844 portrait WeChat Mini Game prototype with a desktop screen gallery around the mobile frame.
- Never copy or ship official Exploding Kittens art, logos, card faces, characters, or protected copy.
- Mini-game delivery must preserve this direction across every screen; do not collapse distinct scenes into one generic header/list/button template.
- Calibrate the implementation as eight reusable scene families (brand, room entry, lobby, table, choice, outcome, editorial, utility), with width-driven layouts for 390x844, 372x749, and short 389x584 viewports.
- Treat WeChat capsule avoidance, fixed primary actions, scrollable long content, 44px minimum touch targets, and aspect-correct `contain`/`cover` image rendering as release requirements.
