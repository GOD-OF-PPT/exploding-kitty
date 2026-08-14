import { describe, expect, it } from "vitest";
import type { WxLike } from "../../platform";
import { resolveCanvasMetrics } from "../canvasMetrics";
import type { ScreenModel } from "../model";
import { createSceneStyles } from "./styles";
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

function systemInfo(overrides: Partial<ReturnType<WxLike["getSystemInfoSync"]>>): ReturnType<WxLike["getSystemInfoSync"]> {
  return { windowWidth: 390, windowHeight: 844, pixelRatio: 1, ...overrides };
}
