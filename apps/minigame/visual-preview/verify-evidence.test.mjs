import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { buildVisualPreview } from "../scripts/build-visual-preview.mjs";
import {
  assertImageHasVariation,
  assertExactCanvasCrop,
  assertExactDerivedCrop,
  assertBundleMatchesRebuild,
  assertNoShiftRepeat,
  assertCapturePixelProvenance,
  assertAcceptedCurrentProvenance,
  assertInteractionChangedFromInitial,
  assertInteractionInitialBinding,
  assertDensityCaptureIndependent,
  assertUniqueEvidenceContent,
  computeCaptureSourceSnapshot,
  computeInputFingerprint,
  computeRgbaPixelHash,
  decodePng,
  getEvidenceManifestContract,
  normalizedRgbMaeRegion,
  rebuildPreviewBundle,
  resolveEvidenceManifestFile,
  validateCaptureMethod,
  validateCaptureRecord,
  validateFocusEntry,
  validateInteractionCaptureEntry,
  validateManifestShape,
  validateScrollCaptureMetadata,
} from "./verify-evidence.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const SCREENS = [
  "login", "home", "play-mode", "create", "join", "lobby-host", "lobby-member", "game",
  "other-turn", "attack", "response", "favor", "give-card", "future", "explosion", "defuse",
  "eliminated", "result", "tutorial", "rules", "card-detail", "history", "game-menu", "network",
  "settings",
];
const SHORT_SCREENS = ["home", "create", "lobby-host", "attack", "defuse", "result", "rules", "settings"];

test("maps canonical evidence paths into an explicit staging root", () => {
  const stagingRoot = resolve("C:/tmp/exploding-kitty-schema-v3-stage");
  assert.equal(
    resolveEvidenceManifestFile(
      stagingRoot,
      "apps/minigame/visual-preview/evidence/density/canvas-login-390x844-dpr3.png",
    ),
    resolve(stagingRoot, "density/canvas-login-390x844-dpr3.png"),
  );
  assert.throws(
    () => resolveEvidenceManifestFile(stagingRoot, "apps/minigame/assets/cards/attack.png"),
    /EVIDENCE_FILE_OUTSIDE_BATCH/u,
  );
  assert.throws(
    () => resolveEvidenceManifestFile(
      stagingRoot,
      "apps/minigame/visual-preview/evidence/../assets/cards/attack.png",
    ),
    /EVIDENCE_FILE_PATH_INVALID/u,
  );
});

test("decodes a real RGBA PNG payload", () => {
  const png = makeRgbaPng(2, 2, [
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]);

  const image = decodePng(png, "fixture.png");
  assert.deepEqual({ width: image.width, height: image.height }, { width: 2, height: 2 });
  assert.deepEqual([...image.rgba], [
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]);
  assert.doesNotThrow(() => assertImageHasVariation(image, "fixture.png"));
});

test("rejects a PNG whose chunk CRC was altered", () => {
  const png = makeRgbaPng(1, 1, [12, 34, 56, 255]);
  const corrupted = Buffer.from(png);
  corrupted[41] ^= 0x01;

  assert.throws(() => decodePng(corrupted, "corrupt.png"), /EVIDENCE_PNG_CRC_INVALID/u);
});

test("rejects a file with a non-PNG magic signature", () => {
  const notPng = makeRgbaPng(1, 1, [12, 34, 56, 255]);
  notPng[0] = 0;
  assert.throws(() => decodePng(notPng, "wrong-magic.png"), /EVIDENCE_NOT_PNG/u);
});

test("caps PNG inflation at the exact IHDR scanline length", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const bomb = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.alloc(1_000_000))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  assert.throws(() => decodePng(bomb, "bomb.png"), /EVIDENCE_PNG_DEFLATE_LIMIT:bomb\.png/u);
});

test("rejects pure-color implementation evidence", () => {
  const image = rgbaImage(3, 2, () => [9, 9, 9, 255]);
  assert.throws(() => assertImageHasVariation(image, "flat.png"), /EVIDENCE_IMAGE_PURE_COLOR/u);
});

test("rejects vertically repeated evidence at the 584px audit shift", () => {
  const image = rgbaImage(3, 700, (x, y) => {
    const sourceY = y >= 584 ? y - 584 : y;
    return [(sourceY * 17 + x * 31) & 0xff, (sourceY * 7 + x) & 0xff, (sourceY + x * 53) & 0xff, 255];
  });

  assert.throws(() => assertNoShiftRepeat(image, "repeated.png"), /EVIDENCE_VERTICAL_REPEAT/u);
});

test("uses a half-height repeat check when a 584px shift has no valid overlap", () => {
  const image = rgbaImage(3, 584, (x, y) => {
    const sourceY = y >= 292 ? y - 292 : y;
    return [(sourceY * 13 + x) & 0xff, (sourceY * 29 + x * 7) & 0xff, (sourceY + x * 41) & 0xff, 255];
  });

  assert.throws(
    () => assertNoShiftRepeat(image, "short-repeated.png"),
    /EVIDENCE_VERTICAL_REPEAT:short-repeated\.png:shift=292:overlap=292/u,
  );
});

test("rejects a non-half-height periodic stitch in 584px evidence", () => {
  const image = rgbaImage(3, 584, (x, y) => {
    const sourceY = y % 200;
    return [(sourceY * 13 + x) & 0xff, (sourceY * 29 + x * 7) & 0xff, (sourceY + x * 41) & 0xff, 255];
  });

  assert.throws(
    () => assertNoShiftRepeat(image, "period-200.png"),
    /EVIDENCE_VERTICAL_REPEAT_RUN:period-200\.png:shift=200/u,
  );
});

test("rejects a locally copied 100-row stitch", () => {
  const image = rgbaImage(3, 584, (x, y) => [y & 0xff, (y >> 8) & 0xff, (x * 53 + y * 7) & 0xff, 255]);
  const rowBytes = image.width * 4;
  for (let row = 0; row < 100; row += 1) {
    image.rgba.copy(image.rgba, (350 + row) * rowBytes, (50 + row) * rowBytes, (51 + row) * rowBytes);
  }

  assert.throws(
    () => assertNoShiftRepeat(image, "local-stitch.png"),
    /EVIDENCE_VERTICAL_REPEAT_RUN:local-stitch\.png:shift=300:start=50:rows=100/u,
  );
});

test("rejects a 100-row stitch copied by less than the minimum run length", () => {
  const image = rgbaImage(3, 584, (x, y) => [y & 0xff, (y >> 8) & 0xff, (x * 53 + y * 7) & 0xff, 255]);
  const rowBytes = image.width * 4;
  const copiedRows = Buffer.from(image.rgba.subarray(50 * rowBytes, 100 * rowBytes));
  copiedRows.copy(image.rgba, 100 * rowBytes);
  copiedRows.copy(image.rgba, 150 * rowBytes);

  assert.throws(
    () => assertNoShiftRepeat(image, "short-shift-stitch.png"),
    /EVIDENCE_VERTICAL_REPEAT_RUN:short-shift-stitch\.png:shift=50:start=50:rows=100/u,
  );
});

test("rejects a repeated horizontally varied row pattern", () => {
  const image = rgbaImage(3, 584, (x, y) => [y & 0xff, (y >> 8) & 0xff, (x * 53 + y * 7) & 0xff, 255]);
  const rowBytes = image.width * 4;
  const patternedRow = Buffer.from(image.rgba.subarray(200 * rowBytes, 201 * rowBytes));
  for (let row = 200; row < 300; row += 1) patternedRow.copy(image.rgba, row * rowBytes);

  assert.throws(
    () => assertNoShiftRepeat(image, "row-pattern.png"),
    /EVIDENCE_VERTICAL_REPEAT_RUN:row-pattern\.png:shift=1:start=200:rows=99/u,
  );
});

test("accepts a repeated pure-color background band", () => {
  const image = rgbaImage(3, 584, (x, y) => {
    if (y >= 200 && y < 300) return [20, 30, 40, 255];
    return [y & 0xff, (y >> 8) & 0xff, (x * 53 + y * 7) & 0xff, 255];
  });

  assert.doesNotThrow(() => assertNoShiftRepeat(image, "solid-band.png"));
});

test("accepts non-repeating 584px evidence", () => {
  const image = rgbaImage(3, 584, (x, y) => [y & 0xff, (y >> 8) & 0xff, (x * 53 + y * 7) & 0xff, 255]);
  assert.doesNotThrow(() => assertNoShiftRepeat(image, "unique-short.png"));
});

test("measures the comparison crop pixel-by-pixel as normalized RGB MAE", () => {
  const current = rgbaImage(2, 2, (x, y) => [x * 100, y * 100, 50, 255]);
  const comparison = rgbaImage(4, 4, () => [0, 0, 0, 255]);
  blit(current, comparison, 1, 1);

  assert.equal(
    normalizedRgbMaeRegion(comparison, { x: 1, y: 1, width: 2, height: 2 }, current, { x: 0, y: 0, width: 2, height: 2 }),
    0,
  );
  comparison.rgba[((1 * comparison.width + 1) * 4)] = 255;
  assert(normalizedRgbMaeRegion(
    comparison,
    { x: 1, y: 1, width: 2, height: 2 },
    current,
    { x: 0, y: 0, width: 2, height: 2 },
  ) > 0);
});

test("requires the fixed comparison Canvas crop to match current pixels exactly", () => {
  const current = rgbaImage(390, 844, (x, y) => [x & 0xff, y & 0xff, (x + y) & 0xff, 255]);
  const comparison = rgbaImage(964, 964, () => [0, 0, 0, 255]);
  blit(current, comparison, 479, 81);

  assert.equal(assertExactCanvasCrop(comparison, current, "comparison.png"), 0);
  comparison.rgba[((81 * comparison.width + 479) * 4)] ^= 0xff;
  assert.throws(
    () => assertExactCanvasCrop(comparison, current, "comparison.png"),
    /EVIDENCE_COMPARISON_CANVAS_MISMATCH/u,
  );
});

test("rejects alpha-only differences in the comparison Canvas crop", () => {
  const current = rgbaImage(390, 844, (x, y) => [x & 0xff, y & 0xff, (x + y) & 0xff, 255]);
  const comparison = rgbaImage(964, 964, () => [0, 0, 0, 255]);
  blit(current, comparison, 479, 81);

  comparison.rgba[((81 * comparison.width + 479) * 4) + 3] = 0;

  assert.throws(
    () => assertExactCanvasCrop(comparison, current, "alpha-mismatch.png"),
    /EVIDENCE_COMPARISON_CANVAS_MISMATCH/u,
  );
});

test("requires each derived focus image to be an exact RGBA crop of its source", () => {
  const source = rgbaImage(4, 4, (x, y) => [x * 40, y * 50, x + y, 255]);
  const focus = rgbaImage(2, 2, (x, y) => [x * 40 + 40, y * 50 + 50, x + y + 2, 255]);

  assert.doesNotThrow(() => assertExactDerivedCrop(source, focus, { x: 1, y: 1, width: 2, height: 2 }, "focus.png"));
  focus.rgba[3] = 254;
  assert.throws(
    () => assertExactDerivedCrop(source, focus, { x: 1, y: 1, width: 2, height: 2 }, "focus.png"),
    /EVIDENCE_FOCUS_SOURCE_MISMATCH:focus\.png/u,
  );
});

test("rejects duplicate evidence bytes across different paths", () => {
  const image = rgbaImage(2, 2, (x, y) => [x * 100, y * 100, 50, 255]);
  assert.throws(
    () => assertUniqueEvidenceContent([
      { file: "canvas-a.png", sha256: "a".repeat(64), image },
      { file: "canvas-b.png", sha256: "a".repeat(64), image: rgbaImage(2, 2, () => [1, 2, 3, 255]) },
    ]),
    /EVIDENCE_FILE_CONTENT_DUPLICATE:canvas-b\.png:canvas-a\.png/u,
  );
});

test("rejects duplicate decoded pixels even when PNG byte hashes differ", () => {
  const first = rgbaImage(2, 2, (x, y) => [x * 100, y * 100, 50, 255]);
  const second = { ...first, rgba: Buffer.from(first.rgba) };
  assert.throws(
    () => assertUniqueEvidenceContent([
      { file: "canvas-a.png", sha256: "a".repeat(64), image: first },
      { file: "canvas-b.png", sha256: "b".repeat(64), image: second },
    ]),
    /EVIDENCE_PIXEL_CONTENT_DUPLICATE:canvas-b\.png:canvas-a\.png/u,
  );
});

test("checks uniqueness from incremental pixel hashes without retaining density RGBA", () => {
  const pixelContentHash = "f".repeat(64);
  assert.throws(
    () => assertUniqueEvidenceContent([
      { file: "density-dpr2.png", sha256: "1".repeat(64), pixelContentHash },
      { file: "density-dpr3.png", sha256: "2".repeat(64), pixelContentHash },
    ]),
    /EVIDENCE_PIXEL_CONTENT_DUPLICATE:density-dpr3\.png:density-dpr2\.png/u,
  );
});

test("rejects nearest-neighbor and bilinear DPR captures mechanically enlarged from DPR1", () => {
  const current = rgbaImage(2, 2, (x, y) => [x * 90 + 20, y * 80 + 30, 60, 255]);
  const replicated = rgbaImage(4, 4, (x, y) => {
    const source = (Math.floor(y / 2) * current.width + Math.floor(x / 2)) * 4;
    return [...current.rgba.subarray(source, source + 4)];
  });
  assert.throws(
    () => assertDensityCaptureIndependent(replicated, current, 2, "replicated.png"),
    /EVIDENCE_DENSITY_MECHANICAL_UPSCALE:replicated\.png/u,
  );

  const bilinear = bilinearUpscale(current, 2);
  assert.throws(
    () => assertDensityCaptureIndependent(bilinear, current, 2, "bilinear.png"),
    /EVIDENCE_DENSITY_MECHANICAL_UPSCALE:bilinear\.png/u,
  );

  const redrawn = { ...replicated, rgba: Buffer.from(replicated.rgba) };
  for (let offset = 0; offset < redrawn.rgba.length; offset += 16) redrawn.rgba[offset] ^= 0xff;
  assert.doesNotThrow(() => assertDensityCaptureIndependent(redrawn, current, 2, "redrawn.png"));
});

test("computes a path-sorted, content-sensitive input fingerprint", () => {
  const records = [
    { file: "z.ts", sha256: "a".repeat(64) },
    { file: "a.ts", sha256: "b".repeat(64) },
  ];
  const reversed = [...records].reverse();

  assert.equal(computeInputFingerprint(records), computeInputFingerprint(reversed));
  assert.notEqual(
    computeInputFingerprint(records),
    computeInputFingerprint([{ ...records[0], sha256: "c".repeat(64) }, records[1]]),
  );
});

test("binds a capture source snapshot to both the preview bundle and input fingerprint", () => {
  const bundleSha256 = "a".repeat(64);
  const inputFingerprintSha256 = "b".repeat(64);

  assert.equal(
    computeCaptureSourceSnapshot(bundleSha256, inputFingerprintSha256),
    computeCaptureSourceSnapshot(bundleSha256, inputFingerprintSha256),
  );
  assert.notEqual(
    computeCaptureSourceSnapshot(bundleSha256, inputFingerprintSha256),
    computeCaptureSourceSnapshot("c".repeat(64), inputFingerprintSha256),
  );
  assert.notEqual(
    computeCaptureSourceSnapshot(bundleSha256, inputFingerprintSha256),
    computeCaptureSourceSnapshot(bundleSha256, "c".repeat(64)),
  );
});

test("requires stable capture hashes to match the exported PNG pixels and bytes", () => {
  const image = rgbaImage(2, 2, (x, y) => [x * 70, y * 90, 30, 255]);
  const pixelHash = createHash("sha256").update(image.rgba).digest("hex");
  assert.equal(computeRgbaPixelHash(image), pixelHash);
  const sourceSnapshotSha256 = "c".repeat(64);
  const entry = {
    schemaVersion: 2,
    hashAlgorithm: "SHA-256",
    hashScope: "canvas-rgba8-row-major",
    pixelHash,
    sampledHashes: ["0".repeat(64), pixelHash, pixelHash],
    stableSamples: 2,
    pngByteSha256: "a".repeat(64),
    sha256: "a".repeat(64),
    sourceSnapshotSha256,
  };

  assert.doesNotThrow(() => assertCapturePixelProvenance(
    entry,
    image,
    sourceSnapshotSha256,
    "capture.png",
  ));
  assert.throws(
    () => assertCapturePixelProvenance(
      { ...entry, pixelHash: "d".repeat(64) },
      image,
      sourceSnapshotSha256,
      "capture.png",
    ),
    /EVIDENCE_CAPTURE_PIXEL_HASH_MISMATCH:capture\.png/u,
  );
  assert.throws(
    () => assertCapturePixelProvenance(
      { ...entry, sampledHashes: [pixelHash, "d".repeat(64)] },
      image,
      sourceSnapshotSha256,
      "capture.png",
    ),
    /EVIDENCE_CAPTURE_STABLE_SAMPLES_MISMATCH:capture\.png/u,
  );
});

test("accepts the raw DOM Canvas capture record and rejects legacy mapped viewport metadata", () => {
  const expectations = {
    kind: "CURRENT",
    expectedFile: "apps/minigame/visual-preview/evidence/current/canvas-home-389x584.png",
    expectedScreen: "home",
    expectedViewport: "389x584",
    expectedMode: "canvas",
    expectedSelector: "#preview-canvas",
    expectedIntrinsic: { width: 389, height: 584 },
    expectedDomRect: { x: 0, y: 0, width: 389, height: 584 },
    expectedBrowserViewport: { width: 389, height: 584 },
    expectedRenderViewport: { width: 389, height: 584 },
    expectedCaptureState: "initial",
    expectedRenderDpr: 1,
  };
  const entry = {
    schemaVersion: 2,
    screen: "home",
    viewport: "389x584",
    mode: "canvas",
    captureState: "initial",
    selector: "#preview-canvas",
    intrinsic: { width: 389, height: 584 },
    domRect: {
      x: 0, y: 0, top: 0, right: 389, bottom: 584, left: 0, width: 389, height: 584,
    },
    browserViewport: {
      innerWidth: 389,
      innerHeight: 584,
      devicePixelRatio: 1,
      visualWidth: 389,
      visualHeight: 584,
      visualScale: 1,
    },
    renderViewport: {
      key: "389x584",
      width: 389,
      height: 584,
      safeTop: 24,
      safeBottom: 0,
      capsule: { left: 296, top: 7, right: 384, bottom: 39 },
    },
    renderDpr: 1,
    captureMethod: "CDP Runtime.evaluate -> HTMLCanvasElement.toDataURL(format=png)",
    antiRepeat: {},
    file: expectations.expectedFile,
    sha256: "a".repeat(64),
  };

  assert.doesNotThrow(() => validateCaptureRecord(entry, expectations));
  assert.throws(
    () => validateCaptureRecord(
      { ...entry, browserViewport: { width: 389, height: 584 } },
      expectations,
    ),
    /EVIDENCE_BROWSER_VIEWPORT_INVALID/u,
  );
  assert.throws(
    () => validateCaptureRecord({ ...entry, scroll: validScrollMetadata() }, expectations),
    /EVIDENCE_INITIAL_SCROLL_METADATA_INVALID/u,
  );
});

test("accepts only full-canvas scroll-end interaction records with fail-closed metadata", () => {
  const entry = validInteractionCaptureRecord("network", "372x749");
  const spec = {
    id: "network-scroll-end-372x749",
    screen: "network",
    viewport: "372x749",
    state: "scroll-end",
  };
  assert.doesNotThrow(() => validateInteractionCaptureEntry(entry, spec));

  const failures = [
    [{ ...entry, state: "initial" }, /EVIDENCE_INTERACTION_STATE_INVALID/u],
    [{ ...entry, captureState: "initial" }, /EVIDENCE_INTERACTION_CAPTURE_STATE_INVALID/u],
    [{ ...entry, file: "apps/minigame/visual-preview/evidence/focus/wrong.png" }, /EVIDENCE_INTERACTION_PATH_INVALID/u],
    [{ ...entry, selector: "#scene-scroll" }, /EVIDENCE_SELECTOR_INVALID/u],
    [{ ...entry, initialCapture: undefined }, /EVIDENCE_INTERACTION_INITIAL_BINDING_MISSING/u],
    [{
      ...entry,
      initialCapture: { ...entry.initialCapture, file: "apps/minigame/visual-preview/evidence/current/canvas-home-372x749.png" },
    }, /EVIDENCE_INTERACTION_INITIAL_FILE_INVALID/u],
  ];
  for (const [candidate, expected] of failures) {
    assert.throws(() => validateInteractionCaptureEntry(candidate, spec), expected);
  }

  for (const field of [
    "sourceFile",
    "sourceSha256",
    "sourcePixelHash",
    "crop",
    "acceptedCurrent",
    "canvasCrop",
    "comparisonSource",
  ]) {
    assert.throws(
      () => validateInteractionCaptureEntry({ ...entry, [field]: {} }, spec),
      new RegExp(`EVIDENCE_INTERACTION_FOREIGN_FIELD_INVALID:.*:${field}`, "u"),
    );
  }
  assert.throws(
    () => validateInteractionCaptureEntry({ ...entry, futureVerifierField: true }, spec),
    /EVIDENCE_INTERACTION_FOREIGN_FIELD_INVALID:.*:futureVerifierField/u,
  );
  assert.throws(
    () => validateInteractionCaptureEntry({
      ...entry,
      initialCapture: { ...entry.initialCapture, futureVerifierField: true },
    }, spec),
    /EVIDENCE_INTERACTION_INITIAL_FIELD_INVALID:.*:futureVerifierField/u,
  );
  assert.throws(
    () => validateInteractionCaptureEntry({
      ...entry,
      scroll: { ...entry.scroll, futureVerifierField: true },
    }, spec),
    /EVIDENCE_INTERACTION_SCROLL_FIELD_INVALID:.*:futureVerifierField/u,
  );
});

test("rejects non-scrollable, zero, wrong-max, and not-at-end interaction scroll states", () => {
  const valid = validScrollMetadata();
  assert.doesNotThrow(() => validateScrollCaptureMetadata(valid, "interaction.png"));
  const failures = [
    [{ ...valid, selector: "#wrong" }, /EVIDENCE_INTERACTION_SCROLL_SELECTOR_INVALID/u],
    [{ ...valid, coordinateSpace: "dom-css-px" }, /EVIDENCE_INTERACTION_SCROLL_COORDINATE_SPACE_INVALID/u],
    [{ ...valid, scrollTop: 0 }, /EVIDENCE_INTERACTION_SCROLL_SCROLL_TOP_ZERO/u],
    [{ ...valid, contentHeight: valid.viewportHeight }, /EVIDENCE_INTERACTION_SCROLL_NOT_SCROLLABLE/u],
    [{ ...valid, maxScrollTop: valid.maxScrollTop + 1 }, /EVIDENCE_INTERACTION_SCROLL_MAX_MISMATCH/u],
    [{ ...valid, scrollTop: valid.maxScrollTop - 1 }, /EVIDENCE_INTERACTION_SCROLL_NOT_AT_END/u],
  ];
  for (const [candidate, expected] of failures) {
    assert.throws(() => validateScrollCaptureMetadata(candidate, "interaction.png"), expected);
  }
});

test("binds an interaction to the same-screen initial capture and source snapshot", () => {
  const sourceSnapshotSha256 = "d".repeat(64);
  const interaction = {
    ...validInteractionDescriptor("network", "372x749"),
    sourceSnapshotSha256,
  };
  const initial = {
    screen: "network",
    viewport: "372x749",
    captureState: "initial",
    file: interaction.initialCapture.file,
    sha256: interaction.initialCapture.sha256,
    pixelHash: interaction.initialCapture.pixelHash,
    sourceSnapshotSha256,
  };
  assert.doesNotThrow(() => assertInteractionInitialBinding(interaction, initial, sourceSnapshotSha256));

  assert.throws(
    () => assertInteractionInitialBinding(
      interaction,
      { ...initial, sourceSnapshotSha256: "e".repeat(64) },
      sourceSnapshotSha256,
    ),
    /EVIDENCE_INTERACTION_SOURCE_SNAPSHOT_MISMATCH/u,
  );
  assert.throws(
    () => assertInteractionInitialBinding(
      interaction,
      { ...initial, sha256: "f".repeat(64) },
      sourceSnapshotSha256,
    ),
    /EVIDENCE_INTERACTION_INITIAL_SHA256_MISMATCH/u,
  );
  assert.throws(
    () => assertInteractionInitialBinding(
      interaction,
      { ...initial, screen: "home" },
      sourceSnapshotSha256,
    ),
    /EVIDENCE_INTERACTION_INITIAL_SCREEN_MISMATCH/u,
  );
});

test("requires terminal interaction bytes and RGBA pixels to differ from initial", () => {
  const initialImage = rgbaImage(2, 2, (x, y) => [x * 20, y * 30, 40, 255]);
  const interactionImage = rgbaImage(2, 2, (x, y) => [x * 20, y * 30 + 1, 40, 255]);
  const initial = { sha256: "a".repeat(64), pixelHash: "b".repeat(64) };
  const interaction = {
    file: "interaction.png",
    sha256: "c".repeat(64),
    pixelHash: "d".repeat(64),
  };
  assert.doesNotThrow(() => assertInteractionChangedFromInitial(
    interaction,
    interactionImage,
    initial,
    initialImage,
  ));
  assert.throws(
    () => assertInteractionChangedFromInitial(
      { ...interaction, pixelHash: initial.pixelHash },
      interactionImage,
      initial,
      initialImage,
    ),
    /EVIDENCE_INTERACTION_PIXEL_HASH_UNCHANGED/u,
  );
  assert.throws(
    () => assertInteractionChangedFromInitial(
      interaction,
      initialImage,
      initial,
      initialImage,
    ),
    /EVIDENCE_INTERACTION_RGBA_UNCHANGED/u,
  );
});

test("binds each comparison capture to its accepted current PNG bytes and pixels", () => {
  const pixelHash = "b".repeat(64);
  const current = {
    screen: "home",
    viewport: "390x844",
    sha256: "a".repeat(64),
    pixelHash,
  };
  const comparison = {
    screen: "home",
    viewport: "390x844",
    acceptedCurrent: {
      sourceByteSha256: current.sha256,
      decodedPixelHash: pixelHash,
      composedRegionPixelHash: pixelHash,
      width: 390,
      height: 844,
    },
  };

  assert.doesNotThrow(() => assertAcceptedCurrentProvenance(comparison, current, "compare-home.png"));
  assert.throws(
    () => assertAcceptedCurrentProvenance(
      {
        ...comparison,
        acceptedCurrent: { ...comparison.acceptedCurrent, sourceByteSha256: "c".repeat(64) },
      },
      current,
      "compare-home.png",
    ),
    /EVIDENCE_ACCEPTED_CURRENT_BYTE_HASH_MISMATCH:compare-home\.png/u,
  );
});

test("rejects a preview bundle that does not match a deterministic rebuild", () => {
  assert.doesNotThrow(() => assertBundleMatchesRebuild(Buffer.from("same"), Buffer.from("same")));
  assert.throws(
    () => assertBundleMatchesRebuild(Buffer.from("stale"), Buffer.from("rebuilt")),
    /EVIDENCE_PREVIEW_BUNDLE_REBUILD_MISMATCH/u,
  );
});

test("fresh visual-preview build is byte-exact with the verifier-side in-memory rebuild", async () => {
  await buildVisualPreview();
  const distBytes = await readFile(resolve(REPOSITORY_ROOT, "apps/minigame/visual-preview/dist/main.js"));
  const rebuilt = await rebuildPreviewBundle(REPOSITORY_ROOT);

  assertBundleMatchesRebuild(distBytes, rebuilt.bytes);
  assert.equal(
    createHash("sha256").update(distBytes).digest("hex"),
    createHash("sha256").update(rebuilt.bytes).digest("hex"),
  );
});

test("rejects duplicate manifest matrix keys before reading any evidence", () => {
  const manifest = validManifestShape();
  manifest.current[manifest.current.length - 1] = { ...manifest.current[0] };

  assert.throws(() => validateManifestShape(manifest), /EVIDENCE_CURRENT_MATRIX_DUPLICATE_KEY/u);
});

test("requires the real 389x584 capture browser viewport", () => {
  const manifest = validManifestShape();
  manifest.capture.browserViewport = { width: 390, height: 844 };
  assert.throws(() => validateManifestShape(manifest), /EVIDENCE_CAPTURE_BROWSER_VIEWPORT_INVALID/u);
});

test("requires schema v2 capture metadata bound to the declared source snapshot", () => {
  const manifest = validManifestShape();
  assert.doesNotThrow(() => validateManifestShape(manifest));

  manifest.capture.sourceSnapshotSha256 = "d".repeat(64);
  assert.throws(
    () => validateManifestShape(manifest),
    /EVIDENCE_CAPTURE_SOURCE_SNAPSHOT_MISMATCH/u,
  );

  manifest.capture.sourceSnapshotSha256 = computeCaptureSourceSnapshot(
    manifest.previewBundle.sha256,
    manifest.inputFingerprint.sha256,
  );
  manifest.schemaVersion = 1;
  assert.throws(() => validateManifestShape(manifest), /EVIDENCE_SCHEMA_UNSUPPORTED/u);
});

test("rejects the legacy 41-current and 11-focus-only matrix before reading PNGs", () => {
  const manifest = validManifestShape();
  manifest.current.pop();
  manifest.counts.current = 41;
  delete manifest.pathTemplates.interactionCaptures;
  delete manifest.counts.interactionCaptures;
  delete manifest.interactionCaptures;
  assert.throws(
    () => validateManifestShape(manifest),
    /EVIDENCE_INTERACTION_PATH_TEMPLATE_INVALID/u,
  );
});

test("requires exactly two direct interaction captures and initial-only current/comparison entries", () => {
  const manifest = validManifestShape();
  assert.doesNotThrow(() => validateManifestShape(manifest));

  const missingInteraction = validManifestShape();
  missingInteraction.interactionCaptures.pop();
  assert.throws(
    () => validateManifestShape(missingInteraction),
    /EVIDENCE_INTERACTION_ARRAY_COUNT_MISMATCH/u,
  );

  const wrongInteraction = validManifestShape();
  wrongInteraction.interactionCaptures[1] = {
    ...wrongInteraction.interactionCaptures[1],
    id: "rules-scroll-end-372x749",
  };
  assert.throws(
    () => validateManifestShape(wrongInteraction),
    /EVIDENCE_INTERACTION_MATRIX_INCOMPLETE/u,
  );

  const nonInitialCurrent = validManifestShape();
  nonInitialCurrent.current[0].captureState = "scroll-end";
  assert.throws(
    () => validateManifestShape(nonInitialCurrent),
    /EVIDENCE_CURRENT_CAPTURE_STATE_INVALID/u,
  );

  const nonInitialComparison = validManifestShape();
  nonInitialComparison.comparisons[0].captureState = "scroll-end";
  assert.throws(
    () => validateManifestShape(nonInitialComparison),
    /EVIDENCE_COMPARISON_CAPTURE_STATE_INVALID/u,
  );
});

test("exports the complete schema v3 generation contract", () => {
  const contract = getEvidenceManifestContract();

  assert.equal(contract.schemaVersion, 3);
  assert.deepEqual(contract.counts, {
    current: 42,
    density: 50,
    interactionCaptures: 2,
    comparisons: 25,
    references: 25,
    focus: 11,
  });
  assert.equal(new Set(contract.current.map(({ screen, viewport }) => `${screen}@${viewport}`)).size, 42);
  assert.deepEqual(
    contract.current.find(({ screen, viewport }) => screen === "network" && viewport === "372x749"),
    { screen: "network", viewport: "372x749", captureState: "initial" },
  );
  assert.deepEqual(contract.interactionCaptures, [
    {
      id: "network-scroll-end-372x749",
      kind: "interaction",
      screen: "network",
      viewport: "372x749",
      state: "scroll-end",
      captureState: "scroll-end",
      file: "apps/minigame/visual-preview/evidence/focus/focus-network-scroll-end-372x749.png",
      initialCapture: {
        file: "apps/minigame/visual-preview/evidence/current/canvas-network-372x749.png",
      },
    },
    {
      id: "rules-scroll-end-389x584",
      kind: "interaction",
      screen: "rules",
      viewport: "389x584",
      state: "scroll-end",
      captureState: "scroll-end",
      file: "apps/minigame/visual-preview/evidence/focus/focus-rules-scroll-end-389x584.png",
      initialCapture: {
        file: "apps/minigame/visual-preview/evidence/current/canvas-rules-389x584.png",
      },
    },
  ]);
  assert.equal(new Set(contract.comparisons.map(({ screen, viewport }) => `${screen}@${viewport}`)).size, 25);
  assert.equal(contract.references.items.length, 25);
  assert.deepEqual(
    contract.references.items.find(({ screen }) => screen === "lobby-host"),
    {
      screen: "lobby-host",
      referenceScreen: "lobby",
      file: "prototype/audit/current/comparisons/final-lobby.jpg",
    },
  );
  assert.equal(new Set(contract.focus.map(({ id }) => id)).size, 11);
  assert.deepEqual(
    contract.focus.find(({ id }) => id === "attack-hand-389x584"),
    {
      id: "attack-hand-389x584",
      kind: "derived",
      screen: "attack",
      viewport: "389x584",
      file: "apps/minigame/visual-preview/evidence/focus/focus-attack-hand-389x584.png",
      sourceFile: "apps/minigame/visual-preview/evidence/current/canvas-attack-389x584.png",
      crop: { x: 0, y: 280, width: 389, height: 304 },
    },
  );

  const manifest = validManifestShape();
  manifest.counts = contract.counts;
  manifest.pathTemplates = contract.pathTemplates;
  manifest.current = contract.current;
  manifest.density = contract.density;
  manifest.interactionCaptures = contract.interactionCaptures.map((entry) => ({
    ...entry,
    initialCapture: {
      ...entry.initialCapture,
      sha256: "a".repeat(64),
      pixelHash: "b".repeat(64),
    },
  }));
  manifest.comparisons = contract.comparisons;
  manifest.references = { items: contract.references.items.map(({ screen }) => ({ screen })) };
  manifest.focus = contract.focus.map(completeFocusEntry);
  assert.doesNotThrow(() => validateManifestShape(manifest));
});

test("requires DPR2 and DPR3 evidence for all 25 standard screens", () => {
  const contract = getEvidenceManifestContract();
  assert.equal(contract.schemaVersion, 3);
  assert.deepEqual(contract.capture.renderDprs, [1, 2, 3]);
  assert.equal(contract.counts.density, 50);
  assert.equal(contract.density.length, 50);
  assert.deepEqual(
    contract.density.slice(0, 4),
    [
      { screen: "login", viewport: "390x844", renderDpr: 2, captureState: "initial" },
      { screen: "login", viewport: "390x844", renderDpr: 3, captureState: "initial" },
      { screen: "home", viewport: "390x844", renderDpr: 2, captureState: "initial" },
      { screen: "home", viewport: "390x844", renderDpr: 3, captureState: "initial" },
    ],
  );

  const dpr1Only = validManifestShape();
  dpr1Only.capture.renderDprs = [1];
  assert.throws(() => validateManifestShape(dpr1Only), /EVIDENCE_CAPTURE_DPR_MATRIX_INVALID/u);

  const missingDensity = validManifestShape();
  missingDensity.density.pop();
  assert.throws(() => validateManifestShape(missingDensity), /EVIDENCE_DENSITY_ARRAY_COUNT_MISMATCH/u);
});

test("requires the canonical schema v3 evidence paths", () => {
  const manifest = validManifestShape();
  manifest.pathTemplates.current = "elsewhere/canvas-<screen>-<viewport>.png";
  assert.throws(() => validateManifestShape(manifest), /EVIDENCE_CURRENT_PATH_TEMPLATE_NONCANONICAL/u);
});

test("requires the exact eleven-item derived focus matrix", () => {
  const manifest = validManifestShape();
  assert.doesNotThrow(() => validateManifestShape(manifest));

  manifest.focus.pop();
  assert.throws(() => validateManifestShape(manifest), /EVIDENCE_FOCUS_ARRAY_COUNT_MISMATCH/u);
});

test("rejects a focus entry whose crop differs from its fixed review region", () => {
  const expectedFile = "evidence/focus/focus-home-brand-prototype-vs-canvas.png";
  const expectedSourceFile = "evidence/comparisons/compare-home.png";
  const expectedCrop = { x: 28, y: 81, width: 852, height: 550 };
  const spec = {
    id: "home-brand-prototype-vs-canvas",
    kind: "derived",
    screen: "home",
    viewport: "390x844",
    file: expectedFile,
    sourceFile: expectedSourceFile,
    crop: expectedCrop,
  };
  const entry = {
    id: spec.id,
    kind: "derived",
    screen: spec.screen,
    viewport: spec.viewport,
    file: expectedFile,
    sha256: "a".repeat(64),
    pngByteSha256: "a".repeat(64),
    pixelHash: "b".repeat(64),
    sourceFile: expectedSourceFile,
    sourceSha256: "c".repeat(64),
    sourcePixelHash: "d".repeat(64),
    crop: expectedCrop,
  };

  assert.doesNotThrow(() => validateFocusEntry(entry, spec));
  assert.throws(
    () => validateFocusEntry(
      { ...entry, crop: { ...expectedCrop, y: expectedCrop.y + 1 } },
      spec,
    ),
    /EVIDENCE_FOCUS_CROP_MISMATCH/u,
  );
});

test("derived focus identity is fixed and rejects every direct, interaction, or comparison field", () => {
  const spec = {
    id: "home-brand-prototype-vs-canvas",
    kind: "derived",
    screen: "home",
    viewport: "390x844",
    file: "evidence/focus/focus-home-brand-prototype-vs-canvas.png",
    sourceFile: "evidence/comparisons/compare-home.png",
    crop: { x: 28, y: 81, width: 852, height: 550 },
  };
  const entry = {
    ...spec,
    sha256: "a".repeat(64),
    pngByteSha256: "a".repeat(64),
    pixelHash: "b".repeat(64),
    sourceSha256: "c".repeat(64),
    sourcePixelHash: "d".repeat(64),
  };

  for (const [candidate, expected] of [
    [{ ...entry, kind: "interaction" }, /EVIDENCE_FOCUS_KIND_INVALID/u],
    [{ ...entry, screen: "network" }, /EVIDENCE_FOCUS_SCREEN_INVALID/u],
    [{ ...entry, viewport: "372x749" }, /EVIDENCE_FOCUS_VIEWPORT_INVALID/u],
  ]) assert.throws(() => validateFocusEntry(candidate, spec), expected);

  const pollutedFields = [
    "schemaVersion", "state", "captureState", "scroll", "initialCapture", "acceptedCurrent",
    "canvasCrop", "comparisonSource", "antiRepeat", "mode", "selector", "intrinsic", "domRect",
    "browserViewport", "renderViewport", "hashAlgorithm", "hashScope", "sampledHashes",
    "stableSamples", "captureMethod", "sourceSnapshotSha256",
  ];
  for (const field of pollutedFields) {
    assert.throws(
      () => validateFocusEntry({ ...entry, [field]: {} }, spec),
      new RegExp(`EVIDENCE_FOCUS_FOREIGN_FIELD_INVALID:.*:${field}`, "u"),
    );
  }
  assert.throws(
    () => validateFocusEntry({ ...entry, futureVerifierField: true }, spec),
    /EVIDENCE_FOCUS_FOREIGN_FIELD_INVALID:.*:futureVerifierField/u,
  );
  assert.throws(
    () => validateFocusEntry({
      ...entry,
      crop: { ...entry.crop, futureVerifierField: true },
    }, spec),
    /EVIDENCE_FOCUS_CROP_FIELD_INVALID:.*:futureVerifierField/u,
  );
});

test("accepts only CDP Runtime.evaluate Canvas PNG export capture metadata", () => {
  assert.doesNotThrow(() => validateCaptureMethod(
    "CDP Runtime.evaluate -> HTMLCanvasElement.toDataURL(format=png)",
    "canvas.png",
  ));
  assert.throws(
    () => validateCaptureMethod(
      "Codex in-app Browser CDP Runtime.evaluate HTMLCanvasElement.toDataURL(format=png)",
      "embellished.png",
    ),
    /EVIDENCE_CAPTURE_METHOD_INVALID:embellished\.png/u,
  );
  assert.throws(
    () => validateCaptureMethod("CDP Page.captureScreenshot(format=png, fromSurface=true)", "legacy.png"),
    /EVIDENCE_CAPTURE_METHOD_INVALID:legacy\.png/u,
  );
});

function makeRgbaPng(width, height, rgba) {
  assert.equal(rgba.length, width * height * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    Buffer.from(rgba).copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rgbaImage(width, height, pixelAt) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = pixelAt(x, y);
      const offset = (y * width + x) * 4;
      rgba.set(pixel, offset);
    }
  }
  return { width, height, rgba };
}

function bilinearUpscale(source, dpr) {
  return rgbaImage(source.width * dpr, source.height * dpr, (x, y) => {
    const sourceX = (x + 0.5) / dpr - 0.5;
    const sourceY = (y + 0.5) / dpr - 0.5;
    const left = Math.max(0, Math.floor(sourceX));
    const top = Math.max(0, Math.floor(sourceY));
    const right = Math.min(source.width - 1, left + 1);
    const bottom = Math.min(source.height - 1, top + 1);
    const xWeight = Math.max(0, sourceX - left);
    const yWeight = Math.max(0, sourceY - top);
    return Array.from({ length: 4 }, (_, channel) => {
      const topLeft = source.rgba[(top * source.width + left) * 4 + channel];
      const topRight = source.rgba[(top * source.width + right) * 4 + channel];
      const bottomLeft = source.rgba[(bottom * source.width + left) * 4 + channel];
      const bottomRight = source.rgba[(bottom * source.width + right) * 4 + channel];
      const topValue = topLeft + (topRight - topLeft) * xWeight;
      const bottomValue = bottomLeft + (bottomRight - bottomLeft) * xWeight;
      return Math.round(topValue + (bottomValue - topValue) * yWeight);
    });
  });
}

function blit(source, destination, targetX, targetY) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = ((targetY + y) * destination.width + targetX) * 4;
    source.rgba.copy(destination.rgba, targetStart, sourceStart, sourceStart + source.width * 4);
  }
}

function validManifestShape() {
  const inputFingerprintSha256 = "b".repeat(64);
  const previewBundleSha256 = "a".repeat(64);
  return {
    schemaVersion: 3,
    fixtureSet: `sha256:${inputFingerprintSha256}`,
    sourceBaseCommit: "a".repeat(40),
    capture: {
      browserViewport: { width: 389, height: 584 },
      method: "CDP Runtime.evaluate -> HTMLCanvasElement.toDataURL(format=png)",
      renderDprs: [1, 2, 3],
      previewBundleSha256,
      inputFingerprintSha256,
      sourceSnapshotAlgorithm: "sha256-bundle-null-input-fingerprint-v1",
      sourceSnapshotSha256: computeCaptureSourceSnapshot(previewBundleSha256, inputFingerprintSha256),
    },
    previewBundle: {
      file: "apps/minigame/visual-preview/dist/main.js",
      algorithm: "sha256-bytes-v1",
      sha256: previewBundleSha256,
    },
    inputFingerprint: {
      algorithm: "sha256-path-null-digest-lf-v1",
      sha256: inputFingerprintSha256,
      files: [{ file: "fixture.ts", sha256: "c".repeat(64) }],
    },
    pathTemplates: {
      current: "apps/minigame/visual-preview/evidence/current/canvas-<screen>-<viewport>.png",
      density: "apps/minigame/visual-preview/evidence/density/canvas-<screen>-<viewport>-dpr<dpr>.png",
      interactionCaptures: "apps/minigame/visual-preview/evidence/focus/focus-<screen>-<state>-<viewport>.png",
      comparisons: "apps/minigame/visual-preview/evidence/comparisons/compare-<screen>-prototype-vs-canvas-390x844.png",
      references: "prototype/audit/current/comparisons/final-<reference-screen>.jpg",
      focus: "apps/minigame/visual-preview/evidence/focus/focus-<focus>.png",
    },
    counts: { current: 42, density: 50, interactionCaptures: 2, comparisons: 25, references: 25, focus: 11 },
    current: [
      ...SCREENS.map((screen) => ({ screen, viewport: "390x844", captureState: "initial" })),
      ...SHORT_SCREENS.flatMap((screen) => [
        { screen, viewport: "372x749", captureState: "initial" },
        { screen, viewport: "389x584", captureState: "initial" },
      ]),
      { screen: "network", viewport: "372x749", captureState: "initial" },
    ],
    density: SCREENS.flatMap((screen) => [2, 3].map((renderDpr) => ({
      screen,
      viewport: "390x844",
      renderDpr,
      captureState: "initial",
    }))),
    interactionCaptures: [
      validInteractionDescriptor("network", "372x749"),
      validInteractionDescriptor("rules", "389x584"),
    ],
    comparisons: SCREENS.map((screen) => ({ screen, viewport: "390x844", captureState: "initial" })),
    references: { items: SCREENS.map((screen) => ({ screen })) },
    focus: getEvidenceManifestContract().focus.map(completeFocusEntry),
  };
}

function completeFocusEntry(descriptor) {
  return {
    ...descriptor,
    sha256: "a".repeat(64),
    pngByteSha256: "a".repeat(64),
    pixelHash: "b".repeat(64),
    sourceSha256: "c".repeat(64),
    sourcePixelHash: "d".repeat(64),
  };
}

function validInteractionDescriptor(screen, viewport) {
  const state = "scroll-end";
  return {
    id: `${screen}-${state}-${viewport}`,
    kind: "interaction",
    screen,
    viewport,
    state,
    captureState: state,
    file: `apps/minigame/visual-preview/evidence/focus/focus-${screen}-${state}-${viewport}.png`,
    initialCapture: {
      file: `apps/minigame/visual-preview/evidence/current/canvas-${screen}-${viewport}.png`,
      sha256: "a".repeat(64),
      pixelHash: "b".repeat(64),
    },
  };
}

function validInteractionCaptureRecord(screen, viewport) {
  const descriptor = validInteractionDescriptor(screen, viewport);
  const [width, height] = viewport.split("x").map(Number);
  return {
    ...descriptor,
    schemaVersion: 2,
    mode: "canvas",
    selector: "#preview-canvas",
    intrinsic: { width, height },
    domRect: {
      x: 0, y: 0, top: 0, right: width, bottom: height, left: 0, width, height,
    },
    browserViewport: {
      innerWidth: 389,
      innerHeight: 584,
      devicePixelRatio: 1,
      visualWidth: 389,
      visualHeight: 584,
      visualScale: 1,
    },
    renderViewport: {
      key: viewport,
      width,
      height,
      safeTop: 24,
      safeBottom: 0,
      capsule: { left: width - 93, top: 7, right: width - 5, bottom: 39 },
    },
    renderDpr: 1,
    captureMethod: "CDP Runtime.evaluate -> HTMLCanvasElement.toDataURL(format=png)",
    scroll: validScrollMetadata(),
    antiRepeat: {},
    sha256: "c".repeat(64),
  };
}

function validScrollMetadata() {
  return {
    selector: "#scene-scroll",
    coordinateSpace: "renderer-logical-px",
    viewportHeight: 500,
    contentHeight: 900,
    maxScrollTop: 400,
    scrollTop: 400,
  };
}
