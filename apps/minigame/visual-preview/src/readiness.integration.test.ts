import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("visual preview readiness integration", () => {
  it("marks the document ready only after font, render assets, and stable preview pixels", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const font = source.indexOf("await waitForDisplayFont");
    const render = source.indexOf("await renderFixtureCanvas");
    const captureState = source.indexOf("await applyCaptureState");
    const stable = source.indexOf("await waitForCanvasStability");
    const ready = source.indexOf("window.__VISUAL_PREVIEW_READY__ = true");

    expect(font).toBeGreaterThanOrEqual(0);
    expect(render).toBeGreaterThan(font);
    expect(captureState).toBeGreaterThan(render);
    expect(stable).toBeGreaterThan(captureState);
    expect(ready).toBeGreaterThan(stable);
    expect(source).toContain('document.documentElement.dataset.ready = "rendering"');
  });

  it("awaits renderer decode and table-surface composition before returning", () => {
    const source = readFileSync(new URL("./renderCanvas.ts", import.meta.url), "utf8");
    const rendererLoad = source.indexOf("await Layout.loadImgs");
    const rendererDecode = source.indexOf("await waitForDecodedImages(rendererImages");
    const tableLoads = source.indexOf("await Promise.all(pendingImages)");
    const tableDecode = source.indexOf("await waitForDecodedImages(trackedImages");
    const tableComposite = source.indexOf("component.update()", tableDecode);

    expect(rendererLoad).toBeGreaterThanOrEqual(0);
    expect(rendererDecode).toBeGreaterThan(rendererLoad);
    expect(source).toContain("surface.subscribeInvalidation(() => component.update())");
    expect(tableLoads).toBeGreaterThan(rendererDecode);
    expect(tableDecode).toBeGreaterThan(tableLoads);
    expect(tableComposite).toBeGreaterThan(tableDecode);
  });

  it("keeps the table surface at the same explicit backing-store DPR as the page Canvas", () => {
    const source = readFileSync(new URL("./renderCanvas.ts", import.meta.url), "utf8");
    expect(source).toContain("attachTableSurface(model, options.selectedTokens, options.displayFont, renderDpr)");
    expect(source).toContain("renderScale: renderDpr");
  });
});
