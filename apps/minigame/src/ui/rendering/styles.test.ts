import { describe, expect, it } from "vitest";
import type { WxLike } from "../../platform";
import { resolveCanvasMetrics } from "../canvasMetrics";
import type { ScreenModel } from "../model";
import { actions } from "./primitives";
import { createSceneStyles, PALETTE } from "./styles";
import type { RenderSceneOptions } from "./types";

type Device = Readonly<{
  name: string;
  width: number;
  height: number;
  safeArea?: ReturnType<WxLike["getSystemInfoSync"]>["safeArea"];
  capsule: Readonly<{
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  }>;
}>;

const DEVICES: readonly Device[] = [
  {
    name: "390 x 844",
    width: 390,
    height: 844,
    safeArea: { left: 0, top: 47, right: 390, bottom: 810, width: 390, height: 763 },
    capsule: { left: 294, top: 17, right: 378, bottom: 49, width: 84, height: 32 },
  },
  {
    name: "372 x 749",
    width: 372,
    height: 749,
    safeArea: { left: 0, top: 20, right: 372, bottom: 749, width: 372, height: 729 },
    capsule: { left: 274, top: 19, right: 362, bottom: 51, width: 88, height: 32 },
  },
  {
    name: "389 x 584",
    width: 389,
    height: 584,
    capsule: { left: 288, top: 10, right: 379, bottom: 42, width: 91, height: 32 },
  },
];

describe("responsive scene styles", () => {
  it("marks inert actions as visibly disabled without weakening actionable controls", () => {
    const markup = actions([
      { id: "join", label: "请输入 6 位房间码" },
      { id: "back", label: "返回", next: "play-mode", back: true },
    ]);

    expect(markup).toMatch(/id="action-0" class="[^"]*\bactionDisabled\b[^"]*\bdisabledControl\b[^"]*" aria-disabled="true" disabled="true"/);
    expect(markup).toMatch(/id="action-1" class="[^"]*\bactionButton\b[^"]*\bactionWide\b/);
    expect(markup).not.toMatch(/id="action-1"[^>]*(?:\bactionDisabled\b|aria-disabled|disabled="true")/);
  });

  it("uses hard-edged comic surfaces instead of the canvas button default radius", () => {
    const { styles } = scene(DEVICES[0]!);
    const surfaces = [
      "actionButton",
      "row",
      "cardItem",
      "modeChoice",
      "formRow",
      "codeBox",
      "lobbyCode",
      "tableHint",
      "responseSheet",
      "giveBanner",
      "placementCard",
      "tutorialBurst",
      "detailCopy",
      "settingsProfile",
      "error",
      "comicSurface",
      "cutCornerCard",
      "modalSurface",
      "warningCallout",
    ];

    for (const className of surfaces) {
      const style = styles[className];
      expect.soft(number(style, "borderRadius"), className).toBeLessThanOrEqual(2);
      const border = number(style, "borderWidth");
      expect.soft(number(style, "borderRightWidth"), className).toBeGreaterThan(border);
      expect.soft(number(style, "borderBottomWidth"), className).toBeGreaterThan(border);
    }

    expect(styles.iconButton).toMatchObject({ borderRadius: 24 });
    expect(styles.homeSettings).toMatchObject({ borderRadius: 24 });
    expect(styles.tutorialCopy).toMatchObject({
      backgroundColor: "rgba(7,7,6,0)",
      borderWidth: 0,
      borderRadius: 0,
    });
  });

  it("gives only the primary CTA a visible cut-corner treatment", () => {
    const markup = actions([
      { id: "primary", label: "继续", next: "game" },
      { id: "secondary", label: "返回", next: "home", tone: "ink" },
    ], "links");
    const primary = /<button id="action-0"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";
    const secondary = /<button id="action-1"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";

    expect(primary).toMatch(/class="[^"]*\bcutCornerCard\b/);
    expect(primary).toContain('class="cutCornerNotch"');
    expect(secondary).not.toMatch(/cutCornerCard|cutCornerNotch/);
  });

  it.each(DEVICES)("keeps secondary copy legible on its actual surface at $name", (device) => {
    const { styles } = scene(device);
    const readableCopy = [
      ["eyebrow", PALETTE.ink],
      ["subtitle", PALETTE.ink],
      ["rowDetail", PALETTE.cream],
      ["rowBadge", PALETTE.yellow],
      ["orderedCardDetail", PALETTE.cream],
      ["brandOriginal", PALETTE.redDark],
      ["loginLegal", PALETTE.redDark],
      ["homeKicker", PALETTE.cyan],
      ["versionTag", PALETTE.ink],
      ["modeChoiceDetail", PALETTE.cream],
      ["modeTip", PALETTE.ink],
      ["formDetail", PALETTE.cream],
      ["codeLabel", PALETTE.cream],
      ["lobbyCodeLabel", PALETTE.yellow],
      ["lobbyNote", PALETTE.ink],
      ["tableTopText", "#100f0d"],
      ["opponentName", PALETTE.black],
      ["tableHintDetail", PALETTE.yellow],
      ["debtText", "#7d1914"],
      ["responseKicker", PALETTE.cream],
      ["responseSubtitle", PALETTE.cream],
      ["choicePromptDetail", PALETTE.ink],
      ["privacyNote", PALETTE.ink],
      ["giveDetail", PALETTE.yellow],
      ["placementDetail", PALETTE.cream],
      ["outcomeSubtitle", "#64120e"],
      ["tutorialStep", PALETTE.ink],
      ["tutorialDetail", PALETTE.ink],
      ["ruleTab", PALETTE.black],
      ["detailText", PALETTE.cream],
      ["historyTip", PALETTE.ink],
      ["dangerNote", PALETTE.ink],
      ["networkKicker", PALETTE.ink],
      ["networkSubtitle", PALETTE.ink],
      ["settingsDetail", PALETTE.yellow],
      ["legalNote", PALETTE.ink],
      ["networkProgressLabel", PALETTE.ink],
    ] as const;

    for (const [className, surface] of readableCopy) {
      const style = styles[className];
      expect.soft(number(style, "fontSize"), `${className} font size`).toBeGreaterThanOrEqual(11);
      expect.soft(
        contrastRatio(string(style, "color"), surface),
        `${className} contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(DEVICES)("uses a portrait 7:10 viewport for selectable cards at $name", (device) => {
    const { styles } = scene(device);

    expect(number(styles.cardItemGive, "width") / number(styles.cardItemGive, "height"))
      .toBeCloseTo(0.7, 2);
    expect(number(styles.giveCardImage, "width") / number(styles.giveCardImage, "height"))
      .toBeCloseTo(0.7, 2);
    expect(number(styles.cardItemGive, "width")).toBeGreaterThanOrEqual(44);
    expect(number(styles.cardItemGive, "height")).toBeGreaterThanOrEqual(44);
  });

  it.each(DEVICES)("uses a portrait 7:10 thumbnail for ordered future cards at $name", (device) => {
    const { styles } = scene(device);

    expect(number(styles.orderedCardImage, "width") / number(styles.orderedCardImage, "height"))
      .toBeCloseTo(0.7, 2);
  });

  it.each(DEVICES)("uses a 7:10 full-card hero for favor, future, and defuse at $name", (device) => {
    const { styles } = scene(device);

    expect(number(styles.choiceHero, "width") / number(styles.choiceHero, "height"))
      .toBeCloseTo(0.7, 2);
  });

  it.each(DEVICES)("frames tutorial card art in a 7:10 viewport at $name", (device) => {
    const { styles } = scene(device);

    expect(number(styles.tutorialImage, "width") / number(styles.tutorialImage, "height"))
      .toBeCloseTo(0.7, 2);
    expect(number(styles.tutorialBurst, "width") / number(styles.tutorialBurst, "height"))
      .toBeCloseTo(0.7, 2);
  });

  it.each(DEVICES)("shows complete rules thumbnails in a 7:10 viewport at $name", (device) => {
    const { styles } = scene(device);

    expect(number(styles.ruleCardImage, "width") / number(styles.ruleCardImage, "height"))
      .toBeCloseTo(0.7, 2);
  });

  it.each(DEVICES)("stages detail and explosion cards in complete 7:10 frames at $name", (device) => {
    const { styles } = scene(device);

    for (const className of ["detailHero", "explosionHero"]) {
      expect.soft(
        number(styles[className], "width") / number(styles[className], "height"),
        className,
      ).toBeCloseTo(0.7, 2);
    }
  });

  it.each(DEVICES)("fits character art inside its final slot without overflow scaling at $name", (device) => {
    const { styles } = scene(device);
    const slots = [
      ["homeHero", "homeHeroImage"],
      ["modeHero", "modeHeroImage"],
      ["joinHero", "joinHeroImage"],
      ["menuHero", "menuHeroImage"],
    ] as const;

    for (const [slotClass, imageClass] of slots) {
      expect.soft(styles[imageClass], imageClass).not.toHaveProperty("transform");
      expect.soft(number(styles[imageClass], "width"), `${imageClass}:width`)
        .toBe(number(styles[slotClass], "width"));
      expect.soft(number(styles[imageClass], "height"), `${imageClass}:height`)
        .toBe(number(styles[slotClass], "height"));
    }
    expect(styles.eliminatedHero).not.toHaveProperty("transform");
  });

  it.each(DEVICES)("keeps explanatory copy at least 12 CSS pixels at $name", (device) => {
    const { styles } = scene(device);
    const explanatoryCopy = [
      "subtitle",
      "rowDetail",
      "orderedCardDetail",
      "loginLegal",
      "modeChoiceDetail",
      "modeTip",
      "formDetail",
      "joinPromptDetail",
      "lobbyHostText",
      "lobbyNote",
      "tableHintDetail",
      "responseSubtitle",
      "choicePromptDetail",
      "privacyNote",
      "giveDetail",
      "placementDetail",
      "outcomeSubtitle",
      "tutorialDetail",
      "detailText",
      "historyTip",
      "dangerNote",
      "networkSubtitle",
      "networkProgressLabel",
      "settingsDetail",
      "legalNote",
      "error",
    ] as const;

    for (const className of explanatoryCopy) {
      expect.soft(number(styles[className], "fontSize"), className).toBeGreaterThanOrEqual(12);
    }
  });

  it.each(DEVICES)("makes semantic controls distinct and at least 44 CSS pixels at $name", (device) => {
    const { styles, scale } = scene(device);
    const minimumLogicalTouch = 44 / scale;
    const targets = [
      ["responseClose", "width"],
      ["responseClose", "height"],
      ["defusePosition", "minHeight"],
      ["settingsToggle", "height"],
      ["toggleSwitch", "height"],
      ["timerBadge", "minHeight"],
      ["tableTurnTimer", "minHeight"],
      ["settingsLink", "minHeight"],
      ["warningCallout", "minHeight"],
    ] as const;
    for (const [className, property] of targets) {
      expect.soft(number(styles[className], property), `${className}.${property}`).toBeGreaterThanOrEqual(minimumLogicalTouch);
    }

    expect(styles.settingsToggle).toMatchObject({ backgroundColor: "#41392e" });
    expect(styles.settingsToggleOn).toMatchObject({ backgroundColor: PALETTE.cyan });
    expect(styles.rowSelected).toMatchObject({ borderColor: PALETTE.cyan });
    expect(styles.defusePositionSelected).toMatchObject({ borderColor: PALETTE.cyan });
    expect(styles.actionDisabled).not.toMatchObject({ backgroundColor: PALETTE.yellow });
    expect(number(styles.disabledControl, "opacity")).toBeGreaterThanOrEqual(0.5);
    expect(number(styles.disabledControl, "opacity")).toBeLessThan(0.8);
  });

  it.each(DEVICES)("keeps full-width content below the WeChat capsule at $name", (device) => {
    const { styles, options } = scene(device);
    expect(number(styles.safeTop, "height")).toBeGreaterThanOrEqual((options.capsule?.bottom ?? 0) + 8);
  });

  it.each(DEVICES)("keeps interactive controls at least 44 CSS pixels at $name", (device) => {
    const { styles, scale } = scene(device);
    const minimumLogicalTouch = 44 / scale;

    expect.soft(number(styles.iconButton, "width")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.iconButton, "height")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.homeSettings, "width")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.homeSettings, "height")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.actionButton, "height")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.actionSmall, "height")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.actionLink, "height")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.insertionBadge, "minHeight")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.formBadge, "height")).toBeGreaterThanOrEqual(minimumLogicalTouch);
    expect.soft(number(styles.ruleTab, "height")).toBeGreaterThanOrEqual(minimumLogicalTouch);
  });

  it.each(DEVICES)("gives short-screen content a shrinking scroll region at $name", (device) => {
    const { styles } = scene(device);
    for (const className of ["sceneBody", "scrollBody", "tableBody", "tableCanvas", "responseBackdrop"]) {
      expect.soft(number(styles[className], "flex"), className).toBe(1);
      expect.soft(number(styles[className], "minHeight"), className).toBeGreaterThanOrEqual(0);
    }
    expect((styles.actionDock as Record<string, unknown>).flex).toBeUndefined();
  });

  it.each(DEVICES)("keeps the response sheet above the fixed CTA at $name", (device) => {
    const { styles, options } = scene(device);
    const dockHeight = number(styles.actionDockLinks, "minHeight");
    const renderedDockHeight = number(styles.actionDock, "paddingTop")
      + number(styles.actionDock, "paddingBottom")
      + number(styles.actionButton, "marginTop")
      + number(styles.actionButton, "height")
      + number(styles.actionButton, "marginTop")
      + number(styles.actionLink, "height");
    expect(dockHeight).toBeGreaterThanOrEqual(renderedDockHeight);
    const sheetHeight = number(styles.responseSheet, "height");
    const sheetContentHeight = number(styles.responseSheet, "padding") * 2
      + number(styles.responseSheet, "borderWidth")
      + number(styles.responseSheet, "borderBottomWidth")
      + number(styles.responseHero, "height")
      + number(styles.responseKicker, "height")
      + number(styles.responseTitle, "minHeight")
      + number(styles.countdown, "marginTop")
      + number(styles.countdown, "height")
      + number(styles.countdown, "marginBottom")
      + number(styles.responseSubtitle, "minHeight");
    expect(sheetHeight).toBeGreaterThanOrEqual(sheetContentHeight);
    const sheetBottom = number(styles.responseSheet, "top") + sheetHeight;
    expect(sheetBottom + 8).toBeLessThanOrEqual(options.height - dockHeight);
  });

  it.each(DEVICES)("anchors response actions independently of root flex flow at $name", (device) => {
    const { styles } = scene(device);
    expect(styles.actionDockLinks).toMatchObject({ position: "absolute" });
    expect(number(styles.actionDockLinks, "bottom")).toBeGreaterThanOrEqual(0);
  });

  it.each(DEVICES)("lets the network body yield space to the fixed CTA at $name", (device) => {
    const { styles } = scene(device);
    expect(styles.networkBody).toMatchObject({ minHeight: 0, flex: 1 });
    expect((styles.networkBody as Record<string, unknown>).height).toBeUndefined();
  });

  it.each(DEVICES)("keeps the table canvas above a wrapped fixed CTA at $name", (device) => {
    const { styles, options } = tableScene(device);
    const wrappedDockHeight = 2 * (
      number(styles.actionButton, "height") + number(styles.actionButton, "marginTop")
    );
    const dockReserve = number(styles.actionDockTable, "bottom") + wrappedDockHeight;
    expect(number(styles.tableBody, "paddingBottom")).toBeGreaterThanOrEqual(dockReserve);

    const minimumTableBodyHeight = number(styles.tableBody, "paddingBottom")
      + number(styles.tableTopbar, "height")
      + number(styles.opponentStrip, "height")
      + number(styles.tableCanvas, "minHeight");
    expect(minimumTableBodyHeight).toBeLessThanOrEqual(
      options.height - number(styles.safeTop, "height"),
    );
  });

  it("keeps the login and home footers above the bottom safe inset", () => {
    const { options } = scene(DEVICES[0]!);
    for (const [id, footerClass] of [["login", "loginLegal"], ["home", "versionTag"]] as const) {
      const model: ScreenModel = { id, title: id, actions: [action("primary")] };
      const styles = createSceneStyles(model, options);
      const footer = styles[footerClass];
      const footerHeight = number(footer, "height");
      expect(footer).toMatchObject({ position: "absolute", bottom: options.safeBottom });
      expect(number(styles.actionDock, "paddingBottom")).toBeGreaterThanOrEqual(
        options.safeBottom + 12 + footerHeight,
      );
    }
  });

  it("uses only transforms supported by the canvas layout engine for active feedback", () => {
    const { styles } = scene(DEVICES[0]!);
    for (const className of ["iconButton", "actionButton", "rowInteractive"]) {
      const active = (styles[className] as Record<string, unknown>)[":active"] as Record<string, unknown>;
      expect.soft(active.transform, className).toBe("scale(0.97, 0.97)");
    }
  });

  it.each(DEVICES)("keeps seat copy inside its card and timeline text readable at $name", (device) => {
    const { styles } = scene(device);
    const seatInnerWidth = number(styles.rowSeat, "width") - 2 * number(styles.rowSeat, "padding");
    expect(number(styles.rowTitleSeat, "width")).toBeLessThanOrEqual(seatInnerWidth);
    expect(number(styles.rowDetailSeat, "width")).toBeLessThanOrEqual(seatInnerWidth);
    expect(styles.rowTitleSeat).toMatchObject({ textAlign: "center", whiteSpace: "nowrap" });
    expect(styles.rowDetailSeat).toMatchObject({ textAlign: "center", whiteSpace: "nowrap" });
    expect(styles.rowTitleTimeline).toMatchObject({ color: PALETTE.cream });
    expect(styles.rowDetailTimeline).toMatchObject({ color: PALETTE.mutedOnDark });
    expect(styles.timelineRail).toMatchObject({ width: 3, backgroundColor: "#8d715c" });
    expect(styles.timelineRail).not.toHaveProperty("borderLeftWidth");
    expect(number(styles.rankAvatar, "height")).toBeLessThanOrEqual(number(styles.rowRank, "minHeight"));
  });
});

function scene(device: Device) {
  const metrics = resolveCanvasMetrics(
    systemInfo({ windowWidth: device.width, windowHeight: device.height, safeArea: device.safeArea }),
    device.capsule,
  );
  const model: ScreenModel = {
    id: "response",
    title: "response",
    actions: [
      { id: "primary", label: "primary" },
      { id: "secondary", label: "secondary", tone: "ink" },
    ],
  };
  const options: RenderSceneOptions = {
    height: metrics.logicalHeight,
    safeTop: metrics.safeInsets.top,
    safeBottom: metrics.safeInsets.bottom,
    capsule: metrics.capsuleRect,
    canGoBack: true,
    selectedTokens: [],
    error: null,
    viewerId: "viewer",
    displayFont: "ZCOOL KuaiLe",
  };
  return {
    options,
    scale: metrics.layoutScale,
    styles: createSceneStyles(model, options),
  };
}

function tableScene(device: Device) {
  const resolved = scene(device);
  const model: ScreenModel = {
    id: "game",
    title: "game",
    actions: [
      { id: "draw", label: "draw" },
      { id: "play", label: "play", tone: "cyan" },
      { id: "menu", label: "menu", tone: "ink" },
    ],
  };
  return {
    ...resolved,
    styles: createSceneStyles(model, resolved.options),
  };
}

function action(id: string): NonNullable<ScreenModel["actions"]>[number] {
  return { id, label: id };
}

function number(style: unknown, property: string): number {
  const value = (style as Record<string, unknown>)[property];
  if (typeof value !== "number") throw new TypeError(`${property} must be numeric`);
  return value;
}

function string(style: unknown, property: string): string {
  const value = (style as Record<string, unknown>)[property];
  if (typeof value !== "string") throw new TypeError(`${property} must be a string`);
  return value;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) throw new TypeError(`expected a six-digit hex color, received ${color}`);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function systemInfo(overrides: Partial<ReturnType<WxLike["getSystemInfoSync"]>>): ReturnType<WxLike["getSystemInfoSync"]> {
  return { windowWidth: 390, windowHeight: 844, pixelRatio: 1, ...overrides };
}
