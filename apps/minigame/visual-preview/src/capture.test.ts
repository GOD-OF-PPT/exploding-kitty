import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCREEN_ORDER, SHORT_SCREEN_FAMILY_REPRESENTATIVES } from "./fixtures";
import {
  CAPTURE_BROWSER_VIEWPORT,
  CAPTURE_DPRS,
  CAPTURE_METHOD,
  CAPTURE_PLAN,
  CAPTURE_PLAN_COUNTS,
} from "./capturePlan";
import {
  hashResourceBytes,
  validateCaptureContext,
  type CaptureContext,
} from "./capture";
import { VIEWPORTS } from "./viewports";

describe("visual preview capture contract", () => {
  it("adds a DPR2 and DPR3 clarity capture for every standard screen", () => {
    expect(CAPTURE_DPRS).toEqual([1, 2, 3]);
    const density = CAPTURE_PLAN.filter(({ kind }) => kind === "density");
    expect(density).toHaveLength(SCREEN_ORDER.length * 2);
    expect(density.map(({ screen, renderDpr }) => `${screen}@${renderDpr}`)).toEqual(
      SCREEN_ORDER.flatMap((screen) => [`${screen}@2`, `${screen}@3`]),
    );
    for (const entry of density) {
      expect(entry.mode).toBe("canvas");
      expect(entry.viewport).toBe("390x844");
      expect(entry.query).toContain(`dpr=${entry.renderDpr}`);
      expect(entry.outputPath).toBe(`evidence/density/canvas-${entry.screen}-390x844-dpr${entry.renderDpr}.png`);
      expect(entry.renderViewport.width * entry.renderDpr).toBe(entry.intrinsic.width);
      expect(entry.renderViewport.height * entry.renderDpr).toBe(entry.intrinsic.height);
    }
  });

  it("defines 42 initial, 2 scroll-end, 50 density, and 25 accepted-PNG comparison captures", () => {
    expect(CAPTURE_PLAN_COUNTS).toEqual({ standard: 25, short: 16, probes: 1, interactions: 2, density: 50, comparisons: 25, total: 119 });
    expect(CAPTURE_PLAN).toHaveLength(119);
    expect(CAPTURE_BROWSER_VIEWPORT).toEqual({ width: 389, height: 584 });
    expect(new Set(CAPTURE_PLAN.map(({ id }) => id)).size).toBe(119);
    expect(CAPTURE_PLAN.filter(({ kind }) => kind === "current-standard").map(({ screen }) => screen))
      .toEqual([...SCREEN_ORDER]);
    expect(CAPTURE_PLAN.filter(({ kind }) => kind === "current-short")).toHaveLength(16);
    expect(CAPTURE_PLAN.filter(({ kind }) => kind === "current-probe")).toEqual([
      expect.objectContaining({ screen: "network", viewport: "372x749", captureState: "initial" }),
    ]);
    expect(CAPTURE_PLAN.filter(({ kind }) => kind === "interaction")).toEqual([
      expect.objectContaining({ id: "network-scroll-end-372x749", screen: "network", viewport: "372x749", captureState: "scroll-end", outputPath: "evidence/focus/focus-network-scroll-end-372x749.png", initialCapturePath: "evidence/current/canvas-network-372x749.png" }),
      expect.objectContaining({ id: "rules-scroll-end-389x584", screen: "rules", viewport: "389x584", captureState: "scroll-end", outputPath: "evidence/focus/focus-rules-scroll-end-389x584.png", initialCapturePath: "evidence/current/canvas-rules-389x584.png" }),
    ]);
    expect(CAPTURE_PLAN.map(({ kind }) => kind)).toEqual([
      ...Array.from({ length: 25 }, () => "current-standard"),
      ...Array.from({ length: 16 }, () => "current-short"),
      "current-probe",
      "interaction",
      "interaction",
      ...Array.from({ length: 50 }, () => "density"),
      ...Array.from({ length: 25 }, () => "comparison"),
    ]);
    expect(CAPTURE_PLAN.slice(0, 42).map(({ screen, viewport, outputPath, captureState }) => ({
      screen,
      viewport,
      outputPath,
      captureState,
    }))).toEqual([
      ...SCREEN_ORDER.map((screen) => ({
        screen,
        viewport: "390x844",
        outputPath: `evidence/current/canvas-${screen}-390x844.png`,
        captureState: "initial",
      })),
      ...Object.values(SHORT_SCREEN_FAMILY_REPRESENTATIVES).flatMap((screen) => [
        {
          screen,
          viewport: "372x749",
          outputPath: `evidence/current/canvas-${screen}-372x749.png`,
          captureState: "initial",
        },
        {
          screen,
          viewport: "389x584",
          outputPath: `evidence/current/canvas-${screen}-389x584.png`,
          captureState: "initial",
        },
      ]),
      {
        screen: "network",
        viewport: "372x749",
        outputPath: "evidence/current/canvas-network-372x749.png",
        captureState: "initial",
      },
    ]);
    for (const entry of CAPTURE_PLAN) {
      expect(entry.captureMethod).toBe(CAPTURE_METHOD);
      if (entry.kind === "comparison") {
        expect(entry.selector).toBe("#evidence-frame");
        expect(entry.requiresAcceptedCurrentPng).toBe(true);
        expect(entry.acceptedCurrentPath).toBe(`evidence/current/canvas-${entry.screen}-390x844.png`);
      } else {
        expect(entry.selector).toBe("#preview-canvas");
        expect(entry.requiresAcceptedCurrentPng).toBe(false);
      }
      expect(entry.query).toContain(`state=${entry.captureState}`);
      expect(entry.browserViewport).toEqual(CAPTURE_BROWSER_VIEWPORT);
    }
    expect(CAPTURE_PLAN[42]?.query).toBe("?screen=network&viewport=372x749&mode=canvas&state=scroll-end");
    expect(CAPTURE_PLAN[43]?.query).toBe("?screen=rules&viewport=389x584&mode=canvas&state=scroll-end");
    expect(CAPTURE_PLAN[44]?.query).toBe("?screen=login&viewport=390x844&mode=canvas&state=initial&dpr=2");
    expect(CAPTURE_PLAN[94]?.query).toBe("?screen=login&viewport=390x844&mode=compare&state=initial&capture=evidence");
  });

  it("uses Runtime.evaluate Canvas PNG export after a three-hash quiet-period gate", () => {
    const capture = readFileSync(new URL("./capture.ts", import.meta.url), "utf8");
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(capture).toContain("requiredStableSamples ?? 3");
    expect(capture).toContain("framesBetweenSamples ?? 6");
    expect(capture).toContain("hashCanvasPixels(canvas)");
    expect(capture).toContain('canvas.toDataURL("image/png")');
    expect(CAPTURE_METHOD).toContain("CDP Runtime.evaluate");
    expect(CAPTURE_METHOD).not.toContain("Page.captureScreenshot");
    expect(main).toContain("VISUAL_PREVIEW_ACCEPTED_CURRENT_REQUIRED");
    expect(main).toContain("composeAcceptedCurrentPng");
    expect(main).toContain("decodedPixelHash !== composedRegionPixelHash");
  });

  it("hashes injected accepted-current data URLs without network fetch", async () => {
    await expect(hashResourceBytes("data:image/png;base64,AAE="))
      .resolves.toBe("b413f47d13ee2fe6c845b2ee141af81de858df4ec549a58b7970bb96645bc8d2");
  });

  it("forbids scroll metadata on initial and comparison capture records", () => {
    const scroll = {
      selector: "#scene-scroll",
      coordinateSpace: "renderer-logical-px",
      viewportHeight: 320,
      contentHeight: 910,
      maxScrollTop: 590,
      scrollTop: 590,
    } as const;
    expect(() => validateCaptureContext(context({ scroll })))
      .toThrow("VISUAL_PREVIEW_INITIAL_SCROLL_METADATA_FORBIDDEN");
    expect(() => validateCaptureContext(context({
      mode: "compare",
      captureState: "scroll-end",
      scroll,
    }))).toThrow("VISUAL_PREVIEW_COMPARISON_STATE_INVALID");
  });

  it("rejects high-DPR comparison records because accepted PNG comparisons are DPR1 byte contracts", () => {
    expect(() => validateCaptureContext(context({ mode: "compare", renderDpr: 2 })))
      .toThrow("VISUAL_PREVIEW_COMPARISON_DPR_INVALID:2");
  });

  it("requires complete, exact scroll metadata for a scroll-end capture record", () => {
    expect(() => validateCaptureContext(context({ captureState: "scroll-end" })))
      .toThrow("VISUAL_PREVIEW_SCROLL_METADATA_REQUIRED");
    expect(() => validateCaptureContext(context({
      captureState: "scroll-end",
      scroll: {
        selector: "#scene-scroll",
        coordinateSpace: "renderer-logical-px",
        viewportHeight: 320,
        contentHeight: 910,
        maxScrollTop: 591,
        scrollTop: 590,
      },
    }))).toThrow("VISUAL_PREVIEW_SCROLL_METADATA_INVALID");
    expect(() => validateCaptureContext(context({
      captureState: "scroll-end",
      scroll: {
        selector: "#scene-scroll",
        coordinateSpace: "renderer-logical-px",
        viewportHeight: 320,
        contentHeight: 910,
        maxScrollTop: 590,
        scrollTop: 590,
      },
    }))).not.toThrow();
  });
});

function context(overrides: Readonly<Record<string, unknown>> = {}): CaptureContext {
  return {
    screen: "network",
    viewport: "372x749",
    mode: "canvas",
    renderViewport: VIEWPORTS["372x749"],
    renderDpr: 1,
    captureState: "initial",
    ...overrides,
  } as CaptureContext;
}
