import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { buildPreviewBrowserBundle } from "../scripts/build-visual-preview.mjs";

const DEFAULT_PREVIEW_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(DEFAULT_PREVIEW_ROOT, "../../..");

const PNG_SIGNATURE = "89504e470d0a1a0a";
const STANDARD_VIEWPORT = "390x844";
const COMPARISON_SIZE = Object.freeze({ width: 964, height: 964 });
const COMPARISON_CANVAS_CROP = Object.freeze({ x: 479, y: 81, width: 390, height: 844 });
const DEFAULT_BROWSER_VIEWPORT = Object.freeze({ width: 389, height: 584 });
const CAPTURE_METHOD = "CDP Runtime.evaluate -> HTMLCanvasElement.toDataURL(format=png)";
const ANTI_REPEAT_PREFERRED_SHIFT = 584;
const ANTI_REPEAT_MIN_OVERLAP = 96;
const ANTI_REPEAT_MAE_LIMIT = 0.01;
const METADATA_MAE_TOLERANCE = 0.000001;
const DENSITY_MIN_DIFFERENT_PIXEL_RATIO = 0.01;
const DENSITY_MIN_NEAREST_RGB_MAE = 0.0005;
const PREVIEW_BUNDLE_FILE = "apps/minigame/visual-preview/dist/main.js";
const BUNDLE_HASH_ALGORITHM = "sha256-bytes-v1";
const INPUT_FINGERPRINT_ALGORITHM = "sha256-path-null-digest-lf-v1";
const CAPTURE_SOURCE_SNAPSHOT_ALGORITHM = "sha256-bundle-null-input-fingerprint-v1";
const EVIDENCE_REPOSITORY_PREFIX = "apps/minigame/visual-preview/evidence/";
const CANONICAL_PATH_TEMPLATES = Object.freeze({
  current: "apps/minigame/visual-preview/evidence/current/canvas-<screen>-<viewport>.png",
  density: "apps/minigame/visual-preview/evidence/density/canvas-<screen>-<viewport>-dpr<dpr>.png",
  interactionCaptures: "apps/minigame/visual-preview/evidence/focus/focus-<screen>-<state>-<viewport>.png",
  comparisons: "apps/minigame/visual-preview/evidence/comparisons/compare-<screen>-prototype-vs-canvas-390x844.png",
  references: "prototype/audit/current/comparisons/final-<reference-screen>.jpg",
  focus: "apps/minigame/visual-preview/evidence/focus/focus-<focus>.png",
});

const INPUT_FINGERPRINT_FIXED_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  "apps/minigame/package.json",
  "apps/minigame/tsconfig.json",
  "apps/minigame/assets.manifest.json",
  "apps/minigame/scripts/asset-quality.mjs",
  "apps/minigame/scripts/check-assets.mjs",
  "apps/minigame/scripts/build-visual-preview.mjs",
  "apps/minigame/visual-preview/index.html",
  "apps/minigame/visual-preview/styles.css",
  "apps/minigame/visual-preview/tsconfig.json",
  PREVIEW_BUNDLE_FILE,
  "apps/minigame/visual-preview/dist/index.html",
  "apps/minigame/visual-preview/dist/styles.css",
]);

const INPUT_FINGERPRINT_TREES = Object.freeze([
  Object.freeze({ root: "apps/minigame/visual-preview/src", kind: "runtime-typescript" }),
  Object.freeze({ root: "apps/minigame/src/ui", kind: "runtime-typescript" }),
  Object.freeze({ root: "apps/minigame/assets", kind: "all-files" }),
  Object.freeze({ root: "apps/minigame/visual-preview/dist/assets", kind: "all-files" }),
  Object.freeze({ root: "apps/minigame/visual-preview/dist/references", kind: "all-files" }),
]);

const SCREEN_IDS = Object.freeze([
  "login",
  "home",
  "play-mode",
  "create",
  "join",
  "lobby-host",
  "lobby-member",
  "game",
  "other-turn",
  "attack",
  "response",
  "favor",
  "give-card",
  "future",
  "explosion",
  "defuse",
  "eliminated",
  "result",
  "tutorial",
  "rules",
  "card-detail",
  "history",
  "game-menu",
  "network",
  "settings",
]);
const CAPTURE_DPRS = Object.freeze([1, 2, 3]);
const DENSITY_DPRS = Object.freeze([2, 3]);

const SHORT_SCREEN_IDS = Object.freeze([
  "home",
  "create",
  "lobby-host",
  "attack",
  "defuse",
  "result",
  "rules",
  "settings",
]);

const FOCUS_SOURCES = Object.freeze({
  "home-brand-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "home", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 81, width: 852, height: 550 }),
  }),
  "home-actions-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "home", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 639, width: 852, height: 296 }),
  }),
  "lobby-host-seats-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "lobby-host", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 220, width: 852, height: 470 }),
  }),
  "response-actions-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "response", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 660, width: 852, height: 276 }),
  }),
  "result-ranking-actions-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "result", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 390, width: 852, height: 546 }),
  }),
  "history-rail-bottom-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "history", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 169, width: 852, height: 766 }),
  }),
  "game-menu-actions-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "game-menu", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 640, width: 852, height: 296 }),
  }),
  "network-content-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "network", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 244, width: 852, height: 650 }),
  }),
  "eliminated-actions-prototype-vs-canvas": Object.freeze({
    kind: "comparison", screen: "eliminated", viewport: STANDARD_VIEWPORT,
    crop: Object.freeze({ x: 28, y: 700, width: 852, height: 236 }),
  }),
  "attack-hand-389x584": Object.freeze({
    kind: "current", screen: "attack", viewport: "389x584",
    crop: Object.freeze({ x: 0, y: 280, width: 389, height: 304 }),
  }),
  "result-ranking-389x584": Object.freeze({
    kind: "current", screen: "result", viewport: "389x584",
    crop: Object.freeze({ x: 0, y: 120, width: 389, height: 464 }),
  }),
});
const EXPECTED_FOCUS_IDS = Object.freeze(Object.keys(FOCUS_SOURCES));

const EXPECTED_CURRENT_KEYS = Object.freeze([
  ...SCREEN_IDS.map((screen) => `${screen}@390x844`),
  ...SHORT_SCREEN_IDS.flatMap((screen) => [`${screen}@372x749`, `${screen}@389x584`]),
  "network@372x749",
]);
const EXPECTED_DENSITY_KEYS = Object.freeze(
  SCREEN_IDS.flatMap((screen) => DENSITY_DPRS.map((dpr) => `${screen}@${STANDARD_VIEWPORT}@${dpr}`)),
);
const INTERACTION_CAPTURE_SPECS = Object.freeze([
  Object.freeze({ id: "network-scroll-end-372x749", screen: "network", viewport: "372x749", state: "scroll-end" }),
  Object.freeze({ id: "rules-scroll-end-389x584", screen: "rules", viewport: "389x584", state: "scroll-end" }),
]);
const EXPECTED_INTERACTION_CAPTURE_KEYS = Object.freeze(
  INTERACTION_CAPTURE_SPECS.map(({ id }) => id),
);
const EXPECTED_COMPARISON_KEYS = Object.freeze(SCREEN_IDS.map((screen) => `${screen}@390x844`));
const DERIVED_FOCUS_FIELDS = Object.freeze([
  "id",
  "kind",
  "screen",
  "viewport",
  "file",
  "sha256",
  "pngByteSha256",
  "pixelHash",
  "sourceFile",
  "sourceSha256",
  "sourcePixelHash",
  "crop",
]);
const INTERACTION_CAPTURE_FIELDS = Object.freeze([
  "id",
  "kind",
  "screen",
  "viewport",
  "state",
  "captureState",
  "file",
  "initialCapture",
  "schemaVersion",
  "mode",
  "selector",
  "intrinsic",
  "domRect",
  "browserViewport",
  "renderViewport",
  "renderDpr",
  "hashAlgorithm",
  "hashScope",
  "pixelHash",
  "sampledHashes",
  "stableSamples",
  "captureMethod",
  "scroll",
  "antiRepeat",
  "sha256",
  "pngByteSha256",
  "sourceSnapshotSha256",
]);

export function getEvidenceManifestContract() {
  const current = [
    ...SCREEN_IDS.map((screen) => ({ screen, viewport: STANDARD_VIEWPORT, captureState: "initial" })),
    ...SHORT_SCREEN_IDS.flatMap((screen) => [
      { screen, viewport: "372x749", captureState: "initial" },
      { screen, viewport: "389x584", captureState: "initial" },
    ]),
    { screen: "network", viewport: "372x749", captureState: "initial" },
  ];
  const density = SCREEN_IDS.flatMap((screen) => DENSITY_DPRS.map((renderDpr) => ({
    screen,
    viewport: STANDARD_VIEWPORT,
    renderDpr,
    captureState: "initial",
  })));
  const interactionCaptures = INTERACTION_CAPTURE_SPECS.map(({ id, screen, viewport, state }) => ({
    id,
    kind: "interaction",
    screen,
    viewport,
    state,
    captureState: state,
    file: expandTemplate(CANONICAL_PATH_TEMPLATES.interactionCaptures, { screen, viewport, state }),
    initialCapture: {
      file: expandTemplate(CANONICAL_PATH_TEMPLATES.current, { screen, viewport }),
    },
  }));
  const comparisons = SCREEN_IDS.map((screen) => ({ screen, viewport: STANDARD_VIEWPORT, captureState: "initial" }));
  const referenceItems = SCREEN_IDS.map((screen) => {
    const referenceScreen = screen === "lobby-host" ? "lobby" : screen;
    return {
      screen,
      referenceScreen,
      file: expandTemplate(CANONICAL_PATH_TEMPLATES.references, { "reference-screen": referenceScreen }),
    };
  });
  const focus = Object.entries(FOCUS_SOURCES).map(([id, source]) => focusDescriptor(id, source));
  return {
    schemaVersion: 3,
    counts: {
      current: current.length,
      density: density.length,
      interactionCaptures: interactionCaptures.length,
      comparisons: comparisons.length,
      references: SCREEN_IDS.length,
      focus: focus.length,
    },
    pathTemplates: { ...CANONICAL_PATH_TEMPLATES },
    capture: {
      browserViewport: { ...DEFAULT_BROWSER_VIEWPORT },
      method: CAPTURE_METHOD,
      renderDprs: [...CAPTURE_DPRS],
      sourceSnapshotAlgorithm: CAPTURE_SOURCE_SNAPSHOT_ALGORITHM,
    },
    previewBundle: { file: PREVIEW_BUNDLE_FILE, algorithm: BUNDLE_HASH_ALGORITHM },
    inputFingerprint: { algorithm: INPUT_FINGERPRINT_ALGORITHM },
    current,
    density,
    interactionCaptures,
    comparisons,
    references: { items: referenceItems },
    focus,
  };
}

export async function verifyEvidence(options = {}) {
  const previewRoot = options.previewRoot ?? DEFAULT_PREVIEW_ROOT;
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT;
  const evidenceRoot = options.evidenceRoot ?? resolve(previewRoot, "evidence");
  const manifestPath = options.manifestPath ?? resolve(evidenceRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateManifestShape(manifest);
  const browserViewport = manifestBrowserViewport(manifest);
  await verifyBuildProvenance(manifest, repositoryRoot);

  const currentDirectory = resolve(evidenceRoot, "current");
  const densityDirectory = resolve(evidenceRoot, "density");
  const comparisonDirectory = resolve(evidenceRoot, "comparisons");
  const focusDirectory = resolve(evidenceRoot, "focus");
  await assertEvidenceRootClosed(evidenceRoot);
  await assertDirectoryMatchesManifest(currentDirectory, manifest.current, evidenceRoot, "CURRENT");
  await assertDirectoryMatchesManifest(densityDirectory, manifest.density, evidenceRoot, "DENSITY");
  await assertDirectoryMatchesManifest(comparisonDirectory, manifest.comparisons, evidenceRoot, "COMPARISON");
  await assertDirectoryMatchesManifest(
    focusDirectory,
    [...manifest.focus, ...manifest.interactionCaptures],
    evidenceRoot,
    "FOCUS",
  );

  const standardCurrentImages = new Map();
  const currentImages = new Map();
  const evidenceSources = new Map();
  const evidenceContentRecords = [];
  for (const entry of manifest.current) {
    const expectedSize = viewportSize(entry.viewport, `EVIDENCE_VIEWPORT_INVALID:${entry.screen}`);
    const expectedFile = expandTemplate(manifest.pathTemplates.current, {
      screen: entry.screen,
      viewport: entry.viewport,
    });
    validateCaptureRecord(entry, {
      kind: "CURRENT",
      expectedFile,
      expectedScreen: entry.screen,
      expectedViewport: entry.viewport,
      expectedMode: "canvas",
      expectedSelector: "#preview-canvas",
      expectedIntrinsic: expectedSize,
      expectedDomRect: { x: 0, y: 0, ...expectedSize },
      expectedBrowserViewport: browserViewport,
      expectedRenderViewport: expectedSize,
      expectedCaptureState: "initial",
      expectedRenderDpr: 1,
    });

    const bytes = await verifiedEvidenceBytes(evidenceRoot, entry.file, entry.sha256);
    const image = decodePng(bytes, entry.file);
    assertSize(image, expectedSize, `EVIDENCE_DIMENSIONS_INVALID:${entry.file}`);
    assertCapturePixelProvenance(entry, image, manifest.capture.sourceSnapshotSha256, entry.file);
    assertImageHasVariation(image, entry.file);
    const antiRepeat = assertNoShiftRepeat(image, entry.file);
    validateAntiRepeatMetadata(entry.antiRepeat, antiRepeat, entry.file);
    evidenceContentRecords.push(evidenceContentRecord(entry.file, entry.sha256, image));
    evidenceSources.set(entry.file, { entry, image });
    currentImages.set(`${entry.screen}@${entry.viewport}`, { entry, image });
    if (entry.viewport === STANDARD_VIEWPORT) standardCurrentImages.set(entry.screen, { entry, image });
  }

  for (const entry of manifest.interactionCaptures) {
    const spec = INTERACTION_CAPTURE_SPECS.find(({ id }) => id === entry.id);
    assert(spec, `EVIDENCE_INTERACTION_ID_INVALID:${entry.id}`);
    const expectedSize = viewportSize(entry.viewport, `EVIDENCE_VIEWPORT_INVALID:${entry.screen}`);
    validateInteractionCaptureEntry(entry, spec, browserViewport);

    const bytes = await verifiedEvidenceBytes(evidenceRoot, entry.file, entry.sha256);
    const image = decodePng(bytes, entry.file);
    assertSize(image, expectedSize, `EVIDENCE_DIMENSIONS_INVALID:${entry.file}`);
    assertCapturePixelProvenance(entry, image, manifest.capture.sourceSnapshotSha256, entry.file);
    assertImageHasVariation(image, entry.file);
    const antiRepeat = assertNoShiftRepeat(image, entry.file);
    validateAntiRepeatMetadata(entry.antiRepeat, antiRepeat, entry.file);
    evidenceContentRecords.push(evidenceContentRecord(entry.file, entry.sha256, image));

    const initial = currentImages.get(`${entry.screen}@${entry.viewport}`);
    assert(initial, `EVIDENCE_INTERACTION_INITIAL_CURRENT_MISSING:${entry.file}`);
    assertInteractionInitialBinding(
      entry,
      initial.entry,
      manifest.capture.sourceSnapshotSha256,
    );
    assertInteractionChangedFromInitial(entry, image, initial.entry, initial.image);
  }

  for (const entry of manifest.density) {
    const renderSize = viewportSize(entry.viewport, `EVIDENCE_VIEWPORT_INVALID:${entry.screen}`);
    const intrinsic = scaleSize(renderSize, entry.renderDpr);
    const expectedFile = expandTemplate(manifest.pathTemplates.density, {
      screen: entry.screen,
      viewport: entry.viewport,
      dpr: entry.renderDpr,
    });
    validateCaptureRecord(entry, {
      kind: "DENSITY",
      expectedFile,
      expectedScreen: entry.screen,
      expectedViewport: entry.viewport,
      expectedMode: "canvas",
      expectedSelector: "#preview-canvas",
      expectedIntrinsic: intrinsic,
      expectedDomRect: { x: 0, y: 0, ...renderSize },
      expectedBrowserViewport: browserViewport,
      expectedRenderViewport: renderSize,
      expectedCaptureState: "initial",
      expectedRenderDpr: entry.renderDpr,
    });

    const bytes = await verifiedEvidenceBytes(evidenceRoot, entry.file, entry.sha256);
    const image = decodePng(bytes, entry.file);
    assertSize(image, intrinsic, `EVIDENCE_DIMENSIONS_INVALID:${entry.file}`);
    const current = standardCurrentImages.get(entry.screen);
    assert(current, `EVIDENCE_DENSITY_CURRENT_MISSING:${entry.screen}`);
    assertDensityCaptureIndependent(image, current.image, entry.renderDpr, entry.file);
    assertCapturePixelProvenance(entry, image, manifest.capture.sourceSnapshotSha256, entry.file);
    assertImageHasVariation(image, entry.file);
    const antiRepeat = assertNoShiftRepeat(image, entry.file);
    validateAntiRepeatMetadata(entry.antiRepeat, antiRepeat, entry.file);
    evidenceContentRecords.push(evidenceContentRecord(entry.file, entry.sha256, image));
  }

  for (const entry of manifest.comparisons) {
    const expectedFile = expandTemplate(manifest.pathTemplates.comparisons, {
      screen: entry.screen,
      viewport: entry.viewport,
    });
    validateCaptureRecord(entry, {
      kind: "COMPARISON",
      expectedFile,
      expectedScreen: entry.screen,
      expectedViewport: entry.viewport,
      expectedMode: "compare",
      expectedSelector: "#evidence-frame",
      expectedIntrinsic: COMPARISON_SIZE,
      expectedDomRect: { x: 0, y: 0, ...COMPARISON_SIZE },
      expectedBrowserViewport: browserViewport,
      expectedRenderViewport: viewportSize(STANDARD_VIEWPORT),
      expectedCaptureState: "initial",
      expectedRenderDpr: 1,
    });
    validateCropShape(entry.canvasCrop, entry.file);

    const bytes = await verifiedEvidenceBytes(evidenceRoot, entry.file, entry.sha256);
    const image = decodePng(bytes, entry.file);
    assertSize(image, COMPARISON_SIZE, `EVIDENCE_COMPARISON_DIMENSIONS_INVALID:${entry.file}`);
    assertCapturePixelProvenance(entry, image, manifest.capture.sourceSnapshotSha256, entry.file);
    assertImageHasVariation(image, entry.file);
    const antiRepeat = assertNoShiftRepeat(image, entry.file);
    validateAntiRepeatMetadata(entry.antiRepeat, antiRepeat, entry.file);
    evidenceContentRecords.push(evidenceContentRecord(entry.file, entry.sha256, image));
    evidenceSources.set(entry.file, { entry, image });

    const current = standardCurrentImages.get(entry.screen);
    assert(current, `EVIDENCE_STANDARD_CURRENT_MISSING:${entry.screen}`);
    assertAcceptedCurrentProvenance(entry, current.entry, entry.file);
    const cropMae = assertExactCanvasCrop(image, current.image, entry.file);
    assert(entry.canvasCrop.normalizedRgbMae === 0, `EVIDENCE_CANVAS_CROP_METADATA_NOT_EXACT:${entry.file}`);
    assertNearlyEqual(
      entry.canvasCrop.normalizedRgbMae,
      cropMae,
      METADATA_MAE_TOLERANCE,
      `EVIDENCE_CANVAS_CROP_METADATA_MISMATCH:${entry.file}`,
    );
  }

  for (const entry of manifest.focus) {
    const sourceSpec = FOCUS_SOURCES[entry.id];
    assert(sourceSpec, `EVIDENCE_FOCUS_ID_INVALID:${entry.id}`);
    const expectedSpec = focusDescriptor(entry.id, sourceSpec, manifest.pathTemplates);
    validateFocusEntry(entry, expectedSpec);

    const source = evidenceSources.get(entry.sourceFile);
    assert(source, `EVIDENCE_FOCUS_SOURCE_MISSING:${entry.file}`);
    assert(entry.sourceSha256 === source.entry.sha256, `EVIDENCE_FOCUS_SOURCE_HASH_MISMATCH:${entry.file}`);
    assert(
      entry.sourcePixelHash === source.entry.pixelHash,
      `EVIDENCE_FOCUS_SOURCE_PIXEL_HASH_MISMATCH:${entry.file}`,
    );
    const bytes = await verifiedEvidenceBytes(evidenceRoot, entry.file, entry.sha256);
    const image = decodePng(bytes, entry.file);
    const pixelHash = computeRgbaPixelHash(image, entry.file);
    assert(pixelHash === entry.pixelHash, `EVIDENCE_FOCUS_PIXEL_HASH_MISMATCH:${entry.file}`);
    assertImageHasVariation(image, entry.file);
    assertExactDerivedCrop(source.image, image, entry.crop, entry.file);
    evidenceContentRecords.push(evidenceContentRecord(entry.file, entry.sha256, image));
  }
  assertUniqueEvidenceContent(evidenceContentRecords);

  for (const entry of manifest.references.items) {
    const referenceScreen = entry.screen === "lobby-host" ? "lobby" : entry.screen;
    const expectedFile = expandTemplate(manifest.pathTemplates.references, {
      "reference-screen": referenceScreen,
      screen: entry.screen,
    });
    validateReferenceEntry(entry, expectedFile);
    const bytes = await verifiedBytes(repositoryRoot, entry.file, entry.sha256);
    decodeJpegHeader(bytes, entry.file);
  }

  console.log(
    `Visual evidence verified: ${manifest.counts.current} current PNGs, `
    + `${manifest.counts.density} DPR2/3 density PNGs, `
    + `${manifest.counts.interactionCaptures} direct interaction PNGs, ${manifest.counts.comparisons} comparison PNGs, `
    + `${manifest.counts.focus} derived focus PNGs, `
    + `${manifest.counts.references} JPEG references.`,
  );
}

export function validateManifestShape(manifest) {
  requireObject(manifest, "EVIDENCE_MANIFEST_INVALID");
  assert(manifest.schemaVersion === 3, "EVIDENCE_SCHEMA_UNSUPPORTED");
  assert(typeof manifest.fixtureSet === "string" && manifest.fixtureSet.length > 0, "EVIDENCE_FIXTURE_SET_MISSING");
  assert(/^[0-9a-f]{40}$/u.test(manifest.sourceBaseCommit), "EVIDENCE_SOURCE_COMMIT_INVALID");
  requireObject(manifest.pathTemplates, "EVIDENCE_PATH_TEMPLATES_MISSING");
  requireTemplate(manifest.pathTemplates.current, ["screen", "viewport"], "CURRENT");
  requireTemplate(manifest.pathTemplates.density, ["screen", "viewport", "dpr"], "DENSITY");
  requireTemplate(
    manifest.pathTemplates.interactionCaptures,
    ["screen", "state", "viewport"],
    "INTERACTION",
  );
  requireTemplate(manifest.pathTemplates.comparisons, ["screen"], "COMPARISON");
  requireTemplate(manifest.pathTemplates.references, ["reference-screen"], "REFERENCE");
  requireTemplate(manifest.pathTemplates.focus, ["focus"], "FOCUS");
  for (const [kind, template] of Object.entries(CANONICAL_PATH_TEMPLATES)) {
    assert(
      manifest.pathTemplates[kind] === template,
      `EVIDENCE_${kind === "comparisons" ? "COMPARISON" : kind.toUpperCase()}_PATH_TEMPLATE_NONCANONICAL`,
    );
  }
  requireObject(manifest.counts, "EVIDENCE_COUNTS_MISSING");
  assert(manifest.counts.current === 42, "EVIDENCE_CURRENT_COUNT_INVALID");
  assert(manifest.counts.density === 50, "EVIDENCE_DENSITY_COUNT_INVALID");
  assert(manifest.counts.interactionCaptures === 2, "EVIDENCE_INTERACTION_COUNT_INVALID");
  assert(manifest.counts.comparisons === 25, "EVIDENCE_COMPARISON_COUNT_INVALID");
  assert(manifest.counts.references === 25, "EVIDENCE_REFERENCE_COUNT_INVALID");
  assert(manifest.counts.focus === EXPECTED_FOCUS_IDS.length, "EVIDENCE_FOCUS_COUNT_INVALID");
  assert(Array.isArray(manifest.current), "EVIDENCE_CURRENT_ITEMS_INVALID");
  assert(Array.isArray(manifest.density), "EVIDENCE_DENSITY_ITEMS_INVALID");
  assert(Array.isArray(manifest.interactionCaptures), "EVIDENCE_INTERACTION_ITEMS_INVALID");
  assert(Array.isArray(manifest.comparisons), "EVIDENCE_COMPARISON_ITEMS_INVALID");
  requireObject(manifest.references, "EVIDENCE_REFERENCES_INVALID");
  assert(Array.isArray(manifest.references.items), "EVIDENCE_REFERENCE_ITEMS_INVALID");
  assert(Array.isArray(manifest.focus), "EVIDENCE_FOCUS_ITEMS_INVALID");
  assert(manifest.current.length === manifest.counts.current, "EVIDENCE_CURRENT_ARRAY_COUNT_MISMATCH");
  assert(manifest.density.length === manifest.counts.density, "EVIDENCE_DENSITY_ARRAY_COUNT_MISMATCH");
  assert(
    manifest.interactionCaptures.length === manifest.counts.interactionCaptures,
    "EVIDENCE_INTERACTION_ARRAY_COUNT_MISMATCH",
  );
  assert(manifest.comparisons.length === manifest.counts.comparisons, "EVIDENCE_COMPARISON_ARRAY_COUNT_MISMATCH");
  assert(manifest.references.items.length === manifest.counts.references, "EVIDENCE_REFERENCE_ARRAY_COUNT_MISMATCH");
  assert(manifest.focus.length === manifest.counts.focus, "EVIDENCE_FOCUS_ARRAY_COUNT_MISMATCH");
  manifestBrowserViewport(manifest);
  validateBuildProvenanceShape(manifest);
  validateCaptureSourceShape(manifest);

  assertExactUniqueKeys(
    manifest.current,
    (entry) => `${entry.screen}@${entry.viewport}`,
    EXPECTED_CURRENT_KEYS,
    "EVIDENCE_CURRENT_MATRIX",
  );
  assertExactUniqueKeys(
    manifest.interactionCaptures,
    (entry) => entry.id,
    EXPECTED_INTERACTION_CAPTURE_KEYS,
    "EVIDENCE_INTERACTION_MATRIX",
  );
  for (const entry of manifest.current) {
    assert(entry.captureState === "initial", `EVIDENCE_CURRENT_CAPTURE_STATE_INVALID:${entry.screen}@${entry.viewport}`);
  }
  assertExactUniqueKeys(
    manifest.density,
    (entry) => `${entry.screen}@${entry.viewport}@${entry.renderDpr}`,
    EXPECTED_DENSITY_KEYS,
    "EVIDENCE_DENSITY_MATRIX",
  );
  for (const entry of manifest.density) {
    assert(entry.captureState === "initial", `EVIDENCE_DENSITY_CAPTURE_STATE_INVALID:${entry.screen}@${entry.renderDpr}`);
  }
  for (const entry of manifest.interactionCaptures) {
    const spec = INTERACTION_CAPTURE_SPECS.find(({ id }) => id === entry.id);
    assert(spec, `EVIDENCE_INTERACTION_ID_INVALID:${entry.id}`);
    validateInteractionDescriptorShape(entry, spec);
  }
  assertExactUniqueKeys(
    manifest.comparisons,
    (entry) => `${entry.screen}@${entry.viewport}`,
    EXPECTED_COMPARISON_KEYS,
    "EVIDENCE_COMPARISON_MATRIX",
  );
  for (const entry of manifest.comparisons) {
    assert(
      entry.captureState === "initial",
      `EVIDENCE_COMPARISON_CAPTURE_STATE_INVALID:${entry.screen}@${entry.viewport}`,
    );
  }
  assertExactUniqueKeys(
    manifest.references.items,
    (entry) => entry.screen,
    SCREEN_IDS,
    "EVIDENCE_REFERENCE_MATRIX",
  );
  assertExactUniqueKeys(
    manifest.focus,
    (entry) => entry.id,
    EXPECTED_FOCUS_IDS,
    "EVIDENCE_FOCUS_MATRIX",
  );
  for (const entry of manifest.focus) {
    const sourceSpec = FOCUS_SOURCES[entry.id];
    assert(sourceSpec, `EVIDENCE_FOCUS_ID_INVALID:${entry.id}`);
    validateFocusEntry(entry, focusDescriptor(entry.id, sourceSpec, manifest.pathTemplates));
  }
}

export function validateCaptureRecord(entry, expectations) {
  requireObject(entry, `EVIDENCE_${expectations.kind}_ENTRY_INVALID`);
  assert(entry.schemaVersion === 2, `EVIDENCE_CAPTURE_RECORD_SCHEMA_INVALID:${entry.file ?? entry.screen}`);
  assert(entry.screen === expectations.expectedScreen, `EVIDENCE_SCREEN_MISMATCH:${entry.file ?? entry.screen}`);
  assert(entry.viewport === expectations.expectedViewport, `EVIDENCE_VIEWPORT_MISMATCH:${entry.file ?? entry.screen}`);
  assert(entry.mode === expectations.expectedMode, `EVIDENCE_CAPTURE_MODE_INVALID:${entry.file ?? entry.screen}`);
  assert(entry.captureState === expectations.expectedCaptureState, `EVIDENCE_CAPTURE_STATE_INVALID:${entry.file ?? entry.screen}`);
  assert(entry.selector === expectations.expectedSelector, `EVIDENCE_SELECTOR_INVALID:${entry.file ?? entry.screen}`);
  assert(entry.renderDpr === expectations.expectedRenderDpr, `EVIDENCE_RENDER_DPR_INVALID:${entry.file ?? entry.screen}`);
  validateFileAndHash(entry, expectations.expectedFile);
  assertSize(entry.intrinsic, expectations.expectedIntrinsic, `EVIDENCE_INTRINSIC_INVALID:${entry.file}`);
  assertCaptureDomRect(entry.domRect, expectations.expectedDomRect, entry.file);
  assertCaptureBrowserViewport(
    entry.browserViewport,
    expectations.expectedBrowserViewport,
    `EVIDENCE_BROWSER_VIEWPORT_INVALID:${entry.file}`,
  );
  assertCaptureRenderViewport(
    entry.renderViewport,
    entry.viewport,
    expectations.expectedRenderViewport,
    `EVIDENCE_RENDER_VIEWPORT_INVALID:${entry.file}`,
  );
  validateCaptureMethod(entry.captureMethod, entry.file);
  if (expectations.kind === "COMPARISON") {
    assert(
      entry.comparisonSource === "accepted-current-png",
      `EVIDENCE_COMPARISON_SOURCE_INVALID:${entry.file}`,
    );
  } else {
    assert(entry.comparisonSource === undefined, `EVIDENCE_NON_COMPARISON_SOURCE_INVALID:${entry.file}`);
  }
  if (expectations.expectedCaptureState === "scroll-end") validateScrollCaptureMetadata(entry.scroll, entry.file);
  else assert(entry.scroll === undefined, `EVIDENCE_INITIAL_SCROLL_METADATA_INVALID:${entry.file}`);
  requireObject(entry.antiRepeat, `EVIDENCE_ANTI_REPEAT_METADATA_MISSING:${entry.file}`);
}

export function validateInteractionCaptureEntry(entry, spec, browserViewport = DEFAULT_BROWSER_VIEWPORT) {
  validateInteractionDescriptorShape(entry, spec);
  const expectedSize = viewportSize(spec.viewport, `EVIDENCE_VIEWPORT_INVALID:${spec.id}`);
  validateCaptureRecord(entry, {
    kind: "INTERACTION",
    expectedFile: expandTemplate(CANONICAL_PATH_TEMPLATES.interactionCaptures, spec),
    expectedScreen: spec.screen,
    expectedViewport: spec.viewport,
    expectedMode: "canvas",
    expectedSelector: "#preview-canvas",
    expectedIntrinsic: expectedSize,
    expectedDomRect: { x: 0, y: 0, ...expectedSize },
    expectedBrowserViewport: browserViewport,
    expectedRenderViewport: expectedSize,
    expectedCaptureState: spec.state,
    expectedRenderDpr: 1,
  });
}

function validateInteractionDescriptorShape(entry, spec) {
  requireObject(entry, `EVIDENCE_INTERACTION_ENTRY_INVALID:${spec.id}`);
  assert(entry.id === spec.id, `EVIDENCE_INTERACTION_ID_INVALID:${entry.id ?? "<missing>"}`);
  assert(entry.kind === "interaction", `EVIDENCE_INTERACTION_KIND_INVALID:${spec.id}`);
  assert(entry.screen === spec.screen, `EVIDENCE_INTERACTION_SCREEN_INVALID:${spec.id}`);
  assert(entry.viewport === spec.viewport, `EVIDENCE_INTERACTION_VIEWPORT_INVALID:${spec.id}`);
  assert(entry.state === spec.state, `EVIDENCE_INTERACTION_STATE_INVALID:${spec.id}`);
  assert(entry.captureState === spec.state, `EVIDENCE_INTERACTION_CAPTURE_STATE_INVALID:${spec.id}`);
  assertOnlyAllowedKeys(
    entry,
    INTERACTION_CAPTURE_FIELDS,
    `EVIDENCE_INTERACTION_FOREIGN_FIELD_INVALID:${spec.id}`,
  );
  const expectedFile = expandTemplate(CANONICAL_PATH_TEMPLATES.interactionCaptures, spec);
  assert(entry.file === expectedFile, `EVIDENCE_INTERACTION_PATH_INVALID:${spec.id}`);
  requireObject(entry.initialCapture, `EVIDENCE_INTERACTION_INITIAL_BINDING_MISSING:${spec.id}`);
  assertOnlyAllowedKeys(
    entry.initialCapture,
    ["file", "sha256", "pixelHash"],
    `EVIDENCE_INTERACTION_INITIAL_FIELD_INVALID:${spec.id}`,
  );
  const expectedInitialFile = expandTemplate(CANONICAL_PATH_TEMPLATES.current, spec);
  assert(
    entry.initialCapture.file === expectedInitialFile,
    `EVIDENCE_INTERACTION_INITIAL_FILE_INVALID:${spec.id}`,
  );
  assert(
    /^[0-9a-f]{64}$/u.test(entry.initialCapture.sha256),
    `EVIDENCE_INTERACTION_INITIAL_SHA256_INVALID:${spec.id}`,
  );
  assert(
    /^[0-9a-f]{64}$/u.test(entry.initialCapture.pixelHash),
    `EVIDENCE_INTERACTION_INITIAL_PIXEL_HASH_INVALID:${spec.id}`,
  );
}

export function validateScrollCaptureMetadata(scroll, file = "<interaction>") {
  const code = (detail) => `EVIDENCE_INTERACTION_SCROLL_${detail}:${file}`;
  requireObject(scroll, code("MISSING"));
  assertOnlyAllowedKeys(
    scroll,
    ["selector", "coordinateSpace", "viewportHeight", "contentHeight", "maxScrollTop", "scrollTop"],
    code("FIELD_INVALID"),
  );
  assert(scroll.selector === "#scene-scroll", code("SELECTOR_INVALID"));
  assert(scroll.coordinateSpace === "renderer-logical-px", code("COORDINATE_SPACE_INVALID"));
  for (const key of ["viewportHeight", "contentHeight", "maxScrollTop", "scrollTop"]) {
    assert(Number.isFinite(scroll[key]), code(`${key.toUpperCase()}_INVALID`));
  }
  assert(scroll.viewportHeight > 0, code("VIEWPORT_HEIGHT_INVALID"));
  assert(scroll.contentHeight > scroll.viewportHeight, code("NOT_SCROLLABLE"));
  const expectedMax = scroll.contentHeight - scroll.viewportHeight;
  assert(expectedMax > 0, code("NOT_SCROLLABLE"));
  assert(Math.abs(scroll.maxScrollTop - expectedMax) <= 0.01, code("MAX_MISMATCH"));
  assert(scroll.scrollTop > 0, code("SCROLL_TOP_ZERO"));
  assert(Math.abs(scroll.scrollTop - scroll.maxScrollTop) <= 0.01, code("NOT_AT_END"));
}

export function assertInteractionInitialBinding(
  interaction,
  initial,
  expectedSourceSnapshotSha256,
) {
  const label = interaction.file ?? interaction.id ?? "<interaction>";
  requireObject(interaction.initialCapture, `EVIDENCE_INTERACTION_INITIAL_BINDING_MISSING:${label}`);
  assert(interaction.screen === initial.screen, `EVIDENCE_INTERACTION_INITIAL_SCREEN_MISMATCH:${label}`);
  assert(interaction.viewport === initial.viewport, `EVIDENCE_INTERACTION_INITIAL_VIEWPORT_MISMATCH:${label}`);
  assert(initial.captureState === "initial", `EVIDENCE_INTERACTION_INITIAL_STATE_INVALID:${label}`);
  assert(
    interaction.initialCapture.file === initial.file,
    `EVIDENCE_INTERACTION_INITIAL_FILE_MISMATCH:${label}`,
  );
  assert(
    interaction.initialCapture.sha256 === initial.sha256,
    `EVIDENCE_INTERACTION_INITIAL_SHA256_MISMATCH:${label}`,
  );
  assert(
    interaction.initialCapture.pixelHash === initial.pixelHash,
    `EVIDENCE_INTERACTION_INITIAL_PIXEL_HASH_MISMATCH:${label}`,
  );
  assert(
    interaction.sourceSnapshotSha256 === expectedSourceSnapshotSha256
      && initial.sourceSnapshotSha256 === expectedSourceSnapshotSha256,
    `EVIDENCE_INTERACTION_SOURCE_SNAPSHOT_MISMATCH:${label}`,
  );
}

export function assertInteractionChangedFromInitial(
  interaction,
  interactionImage,
  initial,
  initialImage,
) {
  const label = interaction.file ?? interaction.id ?? "<interaction>";
  assert(interaction.sha256 !== initial.sha256, `EVIDENCE_INTERACTION_BYTES_UNCHANGED:${label}`);
  assert(interaction.pixelHash !== initial.pixelHash, `EVIDENCE_INTERACTION_PIXEL_HASH_UNCHANGED:${label}`);
  assert(
    interactionImage.width === initialImage.width && interactionImage.height === initialImage.height,
    `EVIDENCE_INTERACTION_INITIAL_DIMENSIONS_MISMATCH:${label}`,
  );
  assert(
    !Buffer.from(interactionImage.rgba).equals(Buffer.from(initialImage.rgba)),
    `EVIDENCE_INTERACTION_RGBA_UNCHANGED:${label}`,
  );
}

function assertCaptureDomRect(actual, expected, file) {
  const code = `EVIDENCE_DOM_RECT_INVALID:${file}`;
  assertRect(actual, expected, code);
  const fullExpected = {
    top: expected.y,
    right: expected.x + expected.width,
    bottom: expected.y + expected.height,
    left: expected.x,
  };
  for (const [key, value] of Object.entries(fullExpected)) {
    assert(Number.isFinite(actual[key]) && Math.abs(actual[key] - value) <= 0.01, code);
  }
}

function assertCaptureBrowserViewport(actual, expected, code) {
  requireObject(actual, code);
  assert(actual.innerWidth === expected.width && actual.innerHeight === expected.height, code);
  assert(Number.isFinite(actual.devicePixelRatio) && actual.devicePixelRatio > 0, code);
  assert(actual.visualWidth === null || Math.abs(actual.visualWidth - expected.width) <= 0.01, code);
  assert(actual.visualHeight === null || Math.abs(actual.visualHeight - expected.height) <= 0.01, code);
  assert(actual.visualScale === null || Math.abs(actual.visualScale - 1) <= 0.01, code);
}

function assertCaptureRenderViewport(actual, viewport, expected, code) {
  assertSize(actual, expected, code);
  assert(actual.key === viewport, code);
  assert(Number.isFinite(actual.safeTop) && actual.safeTop >= 0, code);
  assert(Number.isFinite(actual.safeBottom) && actual.safeBottom >= 0, code);
  requireObject(actual.capsule, code);
  for (const key of ["left", "top", "right", "bottom"]) assert(Number.isFinite(actual.capsule[key]), code);
  assert(
    actual.capsule.left >= 0
      && actual.capsule.top >= 0
      && actual.capsule.right > actual.capsule.left
      && actual.capsule.bottom > actual.capsule.top
      && actual.capsule.right <= actual.width
      && actual.capsule.bottom <= actual.height,
    code,
  );
}

function validateReferenceEntry(entry, expectedFile) {
  requireObject(entry, "REFERENCE_ENTRY_INVALID");
  validateFileAndHash(entry, expectedFile);
  assert([".jpg", ".jpeg"].includes(extname(entry.file).toLowerCase()), `REFERENCE_EXTENSION_INVALID:${entry.file}`);
}

export function validateFocusEntry(entry, spec) {
  requireObject(entry, "EVIDENCE_FOCUS_ENTRY_INVALID");
  requireObject(spec, "EVIDENCE_FOCUS_SPEC_INVALID");
  assert(entry.id === spec.id, `EVIDENCE_FOCUS_ID_INVALID:${entry.id ?? "<missing>"}`);
  assert(entry.kind === "derived" && spec.kind === "derived", `EVIDENCE_FOCUS_KIND_INVALID:${spec.id}`);
  assert(entry.screen === spec.screen, `EVIDENCE_FOCUS_SCREEN_INVALID:${spec.id}`);
  assert(entry.viewport === spec.viewport, `EVIDENCE_FOCUS_VIEWPORT_INVALID:${spec.id}`);
  assertOnlyAllowedKeys(entry, DERIVED_FOCUS_FIELDS, `EVIDENCE_FOCUS_FOREIGN_FIELD_INVALID:${spec.id}`);
  validateFileAndHash(entry, spec.file);
  assert(extname(entry.file).toLowerCase() === ".png", `EVIDENCE_FOCUS_EXTENSION_INVALID:${entry.file}`);
  assert(entry.pngByteSha256 === entry.sha256, `EVIDENCE_FOCUS_PNG_BYTE_HASH_MISMATCH:${entry.file}`);
  assert(/^[0-9a-f]{64}$/u.test(entry.pixelHash), `EVIDENCE_FOCUS_PIXEL_HASH_INVALID:${entry.file}`);
  assert(entry.sourceFile === spec.sourceFile, `EVIDENCE_FOCUS_SOURCE_INVALID:${entry.file}`);
  assert(/^[0-9a-f]{64}$/u.test(entry.sourceSha256), `EVIDENCE_FOCUS_SOURCE_HASH_INVALID:${entry.file}`);
  assert(/^[0-9a-f]{64}$/u.test(entry.sourcePixelHash), `EVIDENCE_FOCUS_SOURCE_PIXEL_HASH_INVALID:${entry.file}`);
  requireObject(entry.crop, `EVIDENCE_FOCUS_CROP_INVALID:${entry.file}`);
  assertOnlyAllowedKeys(entry.crop, ["x", "y", "width", "height"], `EVIDENCE_FOCUS_CROP_FIELD_INVALID:${entry.file}`);
  for (const key of ["x", "y", "width", "height"]) {
    assert(Number.isInteger(entry.crop[key]) && entry.crop[key] >= 0, `EVIDENCE_FOCUS_CROP_INVALID:${entry.file}:${key}`);
    assert(entry.crop[key] === spec.crop[key], `EVIDENCE_FOCUS_CROP_MISMATCH:${entry.file}:${key}`);
  }
  assert(entry.crop.width > 0 && entry.crop.height > 0, `EVIDENCE_FOCUS_CROP_EMPTY:${entry.file}`);
}

function focusDescriptor(id, source, pathTemplates = CANONICAL_PATH_TEMPLATES) {
  const sourceTemplate = source.kind === "current"
    ? pathTemplates.current
    : pathTemplates.comparisons;
  return {
    id,
    kind: "derived",
    screen: source.screen,
    viewport: source.viewport,
    file: expandTemplate(pathTemplates.focus, { focus: id }),
    sourceFile: expandTemplate(sourceTemplate, {
      screen: source.screen,
      viewport: source.viewport,
    }),
    crop: { ...source.crop },
  };
}

function assertOnlyAllowedKeys(value, allowedKeys, code) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${code}:${key}`);
}

function validateFileAndHash(entry, expectedFile) {
  assert(typeof entry.file === "string" && entry.file.length > 0, "EVIDENCE_FILE_MISSING");
  assert(entry.file === normalizeRepositoryPath(entry.file), `EVIDENCE_FILE_PATH_INVALID:${entry.file}`);
  assert(entry.file === expectedFile, `EVIDENCE_FILE_TEMPLATE_MISMATCH:${entry.file}`);
  assert(/^[0-9a-f]{64}$/u.test(entry.sha256), `EVIDENCE_SHA256_INVALID:${entry.file}`);
}

export function validateCaptureMethod(value, file = "<entry>") {
  assert(typeof value === "string" && value.length > 0, `EVIDENCE_CAPTURE_METHOD_MISSING:${file}`);
  assert(value === CAPTURE_METHOD, `EVIDENCE_CAPTURE_METHOD_INVALID:${file}`);
}

function manifestBrowserViewport(manifest) {
  requireObject(manifest.capture, "EVIDENCE_CAPTURE_METADATA_MISSING");
  assert(
    Array.isArray(manifest.capture.renderDprs)
      && manifest.capture.renderDprs.length === CAPTURE_DPRS.length
      && manifest.capture.renderDprs.every((value, index) => value === CAPTURE_DPRS[index]),
    "EVIDENCE_CAPTURE_DPR_MATRIX_INVALID",
  );
  const declared = manifest.capture.browserViewport;
  requireObject(declared, "EVIDENCE_CAPTURE_BROWSER_VIEWPORT_INVALID");
  assert(
    declared.width === DEFAULT_BROWSER_VIEWPORT.width
      && declared.height === DEFAULT_BROWSER_VIEWPORT.height,
    "EVIDENCE_CAPTURE_BROWSER_VIEWPORT_INVALID",
  );
  return { width: declared.width, height: declared.height };
}

function validateCaptureSourceShape(manifest) {
  const capture = manifest.capture;
  validateCaptureMethod(capture.method, "<manifest>");
  assert(
    capture.previewBundleSha256 === manifest.previewBundle.sha256,
    "EVIDENCE_CAPTURE_PREVIEW_BUNDLE_SHA_MISMATCH",
  );
  assert(
    capture.inputFingerprintSha256 === manifest.inputFingerprint.sha256,
    "EVIDENCE_CAPTURE_INPUT_FINGERPRINT_SHA_MISMATCH",
  );
  assert(
    capture.sourceSnapshotAlgorithm === CAPTURE_SOURCE_SNAPSHOT_ALGORITHM,
    "EVIDENCE_CAPTURE_SOURCE_SNAPSHOT_ALGORITHM_INVALID",
  );
  const expectedSourceSnapshot = computeCaptureSourceSnapshot(
    manifest.previewBundle.sha256,
    manifest.inputFingerprint.sha256,
  );
  assert(
    capture.sourceSnapshotSha256 === expectedSourceSnapshot,
    "EVIDENCE_CAPTURE_SOURCE_SNAPSHOT_MISMATCH",
  );
}

export function assertCapturePixelProvenance(
  entry,
  image,
  expectedSourceSnapshotSha256,
  label = entry.file ?? "<capture>",
) {
  assert(entry.schemaVersion === 2, `EVIDENCE_CAPTURE_RECORD_SCHEMA_INVALID:${label}`);
  assert(entry.hashAlgorithm === "SHA-256", `EVIDENCE_CAPTURE_HASH_ALGORITHM_INVALID:${label}`);
  assert(
    entry.hashScope === "canvas-rgba8-row-major",
    `EVIDENCE_CAPTURE_HASH_SCOPE_INVALID:${label}`,
  );
  assert(/^[0-9a-f]{64}$/u.test(entry.pixelHash), `EVIDENCE_CAPTURE_PIXEL_HASH_INVALID:${label}`);
  assert(
    entry.pngByteSha256 === entry.sha256,
    `EVIDENCE_CAPTURE_PNG_BYTE_HASH_MISMATCH:${label}`,
  );
  assert(
    entry.sourceSnapshotSha256 === expectedSourceSnapshotSha256,
    `EVIDENCE_CAPTURE_SOURCE_SNAPSHOT_ENTRY_MISMATCH:${label}`,
  );
  const actualPixelHash = computeRgbaPixelHash(image, label);
  assert(actualPixelHash === entry.pixelHash, `EVIDENCE_CAPTURE_PIXEL_HASH_MISMATCH:${label}`);

  assert(Array.isArray(entry.sampledHashes), `EVIDENCE_CAPTURE_SAMPLED_HASHES_INVALID:${label}`);
  assert(
    Number.isInteger(entry.stableSamples)
      && entry.stableSamples >= 2
      && entry.stableSamples <= entry.sampledHashes.length,
    `EVIDENCE_CAPTURE_STABLE_SAMPLE_COUNT_INVALID:${label}`,
  );
  for (const hash of entry.sampledHashes) {
    assert(/^[0-9a-f]{64}$/u.test(hash), `EVIDENCE_CAPTURE_SAMPLED_HASH_INVALID:${label}`);
  }
  const stableHashes = entry.sampledHashes.slice(-entry.stableSamples);
  assert(
    stableHashes.every((hash) => hash === entry.pixelHash),
    `EVIDENCE_CAPTURE_STABLE_SAMPLES_MISMATCH:${label}`,
  );
  return actualPixelHash;
}

export function computeRgbaPixelHash(image, label = "<image>") {
  assert(image.rgba.length === image.width * image.height * 4, `EVIDENCE_RGBA_LENGTH_INVALID:${label}`);
  return createHash("sha256").update(image.rgba).digest("hex");
}

export function assertAcceptedCurrentProvenance(comparison, current, label = comparison.file ?? "<comparison>") {
  requireObject(comparison.acceptedCurrent, `EVIDENCE_ACCEPTED_CURRENT_MISSING:${label}`);
  const accepted = comparison.acceptedCurrent;
  assert(comparison.screen === current.screen, `EVIDENCE_ACCEPTED_CURRENT_SCREEN_MISMATCH:${label}`);
  assert(comparison.viewport === current.viewport, `EVIDENCE_ACCEPTED_CURRENT_VIEWPORT_MISMATCH:${label}`);
  assert(
    accepted.sourceByteSha256 === current.sha256,
    `EVIDENCE_ACCEPTED_CURRENT_BYTE_HASH_MISMATCH:${label}`,
  );
  assert(
    accepted.decodedPixelHash === current.pixelHash,
    `EVIDENCE_ACCEPTED_CURRENT_DECODED_PIXEL_HASH_MISMATCH:${label}`,
  );
  assert(
    accepted.composedRegionPixelHash === current.pixelHash,
    `EVIDENCE_ACCEPTED_CURRENT_COMPOSED_PIXEL_HASH_MISMATCH:${label}`,
  );
  assertSize(
    accepted,
    { width: 390, height: 844 },
    `EVIDENCE_ACCEPTED_CURRENT_DIMENSIONS_INVALID:${label}`,
  );
}

function validateAntiRepeatMetadata(metadata, computed, file) {
  requireObject(metadata, `EVIDENCE_ANTI_REPEAT_METADATA_MISSING:${file}`);
  assert(metadata.shift === computed.shift, `EVIDENCE_ANTI_REPEAT_SHIFT_INVALID:${file}`);
  assert(metadata.overlap === computed.overlap, `EVIDENCE_ANTI_REPEAT_OVERLAP_INVALID:${file}`);
  assertNearlyEqual(
    metadata.normalizedRgbMae,
    computed.normalizedRgbMae,
    METADATA_MAE_TOLERANCE,
    `EVIDENCE_ANTI_REPEAT_MAE_METADATA_MISMATCH:${file}`,
  );
}

function validateCropShape(crop, file) {
  requireObject(crop, `EVIDENCE_CANVAS_CROP_MISSING:${file}`);
  assertRect(crop, COMPARISON_CANVAS_CROP, `EVIDENCE_CANVAS_CROP_INVALID:${file}`);
  assert(Number.isFinite(crop.normalizedRgbMae), `EVIDENCE_CANVAS_CROP_MAE_INVALID:${file}`);
}

async function assertDirectoryMatchesManifest(directory, entries, evidenceRoot, label) {
  const expected = new Set(entries.map((entry) => entry.file));
  const actual = new Set();
  for (const directoryEntry of await readdir(directory, { withFileTypes: true })) {
    assert(directoryEntry.isFile(), `EVIDENCE_${label}_DIRECTORY_ENTRY_INVALID:${directoryEntry.name}`);
    const relativePath = normalizeRepositoryPath(relative(evidenceRoot, resolve(directory, directoryEntry.name)));
    assert(relativePath && !relativePath.startsWith("../"), `EVIDENCE_${label}_DIRECTORY_ENTRY_INVALID:${directoryEntry.name}`);
    const file = `${EVIDENCE_REPOSITORY_PREFIX}${relativePath}`;
    actual.add(file);
  }
  assertSetEquals(actual, expected, `EVIDENCE_${label}_DIRECTORY_SET_MISMATCH`);
}

async function assertEvidenceRootClosed(evidenceRoot) {
  const expected = new Map([
    ["current", "directory"],
    ["density", "directory"],
    ["comparisons", "directory"],
    ["focus", "directory"],
    ["manifest.json", "file"],
  ]);
  const entries = await readdir(evidenceRoot, { withFileTypes: true });
  assertSetEquals(new Set(entries.map((entry) => entry.name)), new Set(expected.keys()), "EVIDENCE_ROOT_SET_MISMATCH");
  for (const entry of entries) {
    const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other";
    assert(kind === expected.get(entry.name), `EVIDENCE_ROOT_ENTRY_INVALID:${entry.name}`);
  }
}

async function verifiedBytes(repositoryRoot, file, expectedHash) {
  const absolutePath = safeRepositoryFile(repositoryRoot, file);
  const bytes = await readFile(absolutePath);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  assert(actualHash === expectedHash, `EVIDENCE_HASH_MISMATCH:${file}`);
  return bytes;
}

async function verifiedEvidenceBytes(evidenceRoot, file, expectedHash) {
  const absolutePath = resolveEvidenceManifestFile(evidenceRoot, file);
  const bytes = await readFile(absolutePath);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  assert(actualHash === expectedHash, `EVIDENCE_HASH_MISMATCH:${file}`);
  return bytes;
}

export function resolveEvidenceManifestFile(evidenceRoot, file) {
  if (typeof file !== "string" || !file.startsWith(EVIDENCE_REPOSITORY_PREFIX)) {
    throw new Error(`EVIDENCE_FILE_OUTSIDE_BATCH:${String(file)}`);
  }
  const relativePath = file.slice(EVIDENCE_REPOSITORY_PREFIX.length);
  if (
    !relativePath
    || relativePath.includes("\\")
    || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) throw new Error(`EVIDENCE_FILE_PATH_INVALID:${file}`);
  const root = resolve(evidenceRoot);
  const absolutePath = resolve(root, ...relativePath.split("/"));
  const back = relative(root, absolutePath);
  if (!back || back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new Error(`EVIDENCE_FILE_PATH_INVALID:${file}`);
  }
  return absolutePath;
}

async function verifyBuildProvenance(manifest, repositoryRoot) {
  const bundleBytes = await verifiedBytes(
    repositoryRoot,
    manifest.previewBundle.file,
    manifest.previewBundle.sha256,
  );
  assert(bundleBytes.length > 0, "EVIDENCE_PREVIEW_BUNDLE_EMPTY");
  const rebuiltBundle = await rebuildPreviewBundle(repositoryRoot);
  assertBundleMatchesRebuild(bundleBytes, rebuiltBundle.bytes);

  const actualRecords = await collectInputFingerprintRecords(repositoryRoot, rebuiltBundle.inputs);
  const expectedFiles = actualRecords.map((record) => record.file);
  const declaredRecords = manifest.inputFingerprint.files;
  assertExactUniqueKeys(
    declaredRecords,
    (entry) => entry.file,
    expectedFiles,
    "EVIDENCE_INPUT_FINGERPRINT_FILES",
  );
  const declaredOrder = declaredRecords.map((entry) => entry.file);
  assert(
    JSON.stringify(declaredOrder) === JSON.stringify([...declaredOrder].sort(compareUtf8Paths)),
    "EVIDENCE_INPUT_FINGERPRINT_FILES_NOT_SORTED",
  );

  const actualHashes = new Map(actualRecords.map((record) => [record.file, record.sha256]));
  for (const record of declaredRecords) {
    validateFingerprintRecord(record);
    const sha256 = actualHashes.get(record.file);
    assert(sha256 === record.sha256, `EVIDENCE_INPUT_FILE_HASH_MISMATCH:${record.file}`);
  }
  const fingerprint = computeInputFingerprint(actualRecords);
  assert(
    fingerprint === manifest.inputFingerprint.sha256,
    "EVIDENCE_INPUT_FINGERPRINT_HASH_MISMATCH",
  );
  assert(manifest.fixtureSet === `sha256:${fingerprint}`, "EVIDENCE_FIXTURE_SET_FINGERPRINT_MISMATCH");
}

export async function rebuildPreviewBundle(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const result = await buildPreviewBrowserBundle({
    repositoryRoot,
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  assert(result.outputFiles.length === 1, "EVIDENCE_PREVIEW_BUNDLE_REBUILD_OUTPUT_INVALID");
  return {
    bytes: Buffer.from(result.outputFiles[0].contents),
    inputs: Object.keys(result.metafile.inputs).map(normalizeRepositoryPath),
  };
}

export function assertBundleMatchesRebuild(bundleBytes, rebuiltBytes) {
  assert(
    Buffer.from(bundleBytes).equals(Buffer.from(rebuiltBytes)),
    "EVIDENCE_PREVIEW_BUNDLE_REBUILD_MISMATCH",
  );
}

export async function collectInputFingerprintRecords(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  runtimeInputs,
) {
  let resolvedRuntimeInputs = runtimeInputs;
  if (resolvedRuntimeInputs === undefined) {
    const bundleBytes = await readFile(safeRepositoryFile(repositoryRoot, PREVIEW_BUNDLE_FILE));
    const rebuiltBundle = await rebuildPreviewBundle(repositoryRoot);
    assertBundleMatchesRebuild(bundleBytes, rebuiltBundle.bytes);
    resolvedRuntimeInputs = rebuiltBundle.inputs;
  }
  const expectedFiles = await expectedInputFingerprintFiles(repositoryRoot, resolvedRuntimeInputs);
  const records = [];
  for (const file of expectedFiles) {
    const bytes = await readFile(safeRepositoryFile(repositoryRoot, file));
    records.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  verifyCopiedCaptureInputs(records);
  return records;
}

function verifyCopiedCaptureInputs(records) {
  const hashes = new Map(records.map((record) => [record.file, record.sha256]));
  assertCopiedFile(
    hashes,
    "apps/minigame/visual-preview/index.html",
    "apps/minigame/visual-preview/dist/index.html",
  );
  assertCopiedFile(
    hashes,
    "apps/minigame/visual-preview/styles.css",
    "apps/minigame/visual-preview/dist/styles.css",
  );

  const assetSourcePrefix = "apps/minigame/assets/";
  const assetOutputPrefix = "apps/minigame/visual-preview/dist/assets/";
  const sourceAssets = [...hashes.keys()]
    .filter((file) => file.startsWith(assetSourcePrefix))
    .map((file) => file.slice(assetSourcePrefix.length));
  const outputAssets = [...hashes.keys()]
    .filter((file) => file.startsWith(assetOutputPrefix))
    .map((file) => file.slice(assetOutputPrefix.length));
  assertSetEquals(new Set(outputAssets), new Set(sourceAssets), "EVIDENCE_PREVIEW_ASSET_COPY_SET_MISMATCH");
  for (const file of sourceAssets) {
    assertCopiedFile(hashes, `${assetSourcePrefix}${file}`, `${assetOutputPrefix}${file}`);
  }

  const expectedReferenceOutputs = new Set();
  for (const screen of SCREEN_IDS) {
    const referenceScreen = screen === "lobby-host" ? "lobby" : screen;
    const name = `implementation-${referenceScreen}-390x844-final.png`;
    const source = `prototype/audit/current/after/${name}`;
    const output = `apps/minigame/visual-preview/dist/references/${name}`;
    expectedReferenceOutputs.add(output);
    assertCopiedFile(hashes, source, output);
  }
  const actualReferenceOutputs = new Set(
    [...hashes.keys()].filter((file) => file.startsWith("apps/minigame/visual-preview/dist/references/")),
  );
  assertSetEquals(actualReferenceOutputs, expectedReferenceOutputs, "EVIDENCE_PREVIEW_REFERENCE_COPY_SET_MISMATCH");
}

function assertCopiedFile(hashes, source, output) {
  assert(hashes.has(source), `EVIDENCE_PREVIEW_COPY_SOURCE_MISSING:${source}`);
  assert(hashes.has(output), `EVIDENCE_PREVIEW_COPY_OUTPUT_MISSING:${output}`);
  assert(hashes.get(source) === hashes.get(output), `EVIDENCE_PREVIEW_COPY_MISMATCH:${output}`);
}

function validateBuildProvenanceShape(manifest) {
  requireObject(manifest.previewBundle, "EVIDENCE_PREVIEW_BUNDLE_MISSING");
  assert(manifest.previewBundle.file === PREVIEW_BUNDLE_FILE, "EVIDENCE_PREVIEW_BUNDLE_FILE_INVALID");
  assert(manifest.previewBundle.algorithm === BUNDLE_HASH_ALGORITHM, "EVIDENCE_PREVIEW_BUNDLE_ALGORITHM_INVALID");
  assert(/^[0-9a-f]{64}$/u.test(manifest.previewBundle.sha256), "EVIDENCE_PREVIEW_BUNDLE_SHA256_INVALID");

  requireObject(manifest.inputFingerprint, "EVIDENCE_INPUT_FINGERPRINT_MISSING");
  assert(
    manifest.inputFingerprint.algorithm === INPUT_FINGERPRINT_ALGORITHM,
    "EVIDENCE_INPUT_FINGERPRINT_ALGORITHM_INVALID",
  );
  assert(/^[0-9a-f]{64}$/u.test(manifest.inputFingerprint.sha256), "EVIDENCE_INPUT_FINGERPRINT_SHA256_INVALID");
  assert(Array.isArray(manifest.inputFingerprint.files), "EVIDENCE_INPUT_FINGERPRINT_FILE_LIST_INVALID");
  assert(manifest.inputFingerprint.files.length > 0, "EVIDENCE_INPUT_FINGERPRINT_FILE_LIST_EMPTY");
  for (const record of manifest.inputFingerprint.files) validateFingerprintRecord(record);
  assert(manifest.fixtureSet === `sha256:${manifest.inputFingerprint.sha256}`, "EVIDENCE_FIXTURE_SET_FINGERPRINT_MISMATCH");
}

function validateFingerprintRecord(record) {
  requireObject(record, "EVIDENCE_INPUT_FINGERPRINT_RECORD_INVALID");
  assert(
    typeof record.file === "string"
      && record.file.length > 0
      && record.file === normalizeRepositoryPath(record.file)
      && !/[\0\r\n]/u.test(record.file),
    "EVIDENCE_INPUT_FINGERPRINT_PATH_INVALID",
  );
  assert(/^[0-9a-f]{64}$/u.test(record.sha256), `EVIDENCE_INPUT_FINGERPRINT_RECORD_SHA_INVALID:${record.file}`);
}

export function computeInputFingerprint(records) {
  const sorted = [...records].sort((left, right) => compareUtf8Paths(left.file, right.file));
  const canonical = sorted.map(({ file, sha256 }) => `${file}\0${sha256}\n`).join("");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function computeCaptureSourceSnapshot(bundleSha256, inputFingerprintSha256) {
  assert(/^[0-9a-f]{64}$/u.test(bundleSha256), "EVIDENCE_CAPTURE_SOURCE_BUNDLE_SHA_INVALID");
  assert(
    /^[0-9a-f]{64}$/u.test(inputFingerprintSha256),
    "EVIDENCE_CAPTURE_SOURCE_INPUT_FINGERPRINT_SHA_INVALID",
  );
  return createHash("sha256")
    .update(`${bundleSha256}\0${inputFingerprintSha256}`, "utf8")
    .digest("hex");
}

async function expectedInputFingerprintFiles(repositoryRoot, runtimeInputs = []) {
  const files = new Set(INPUT_FINGERPRINT_FIXED_FILES);
  for (const file of runtimeInputs) files.add(file);
  for (const tree of INPUT_FINGERPRINT_TREES) {
    await collectFingerprintTree(repositoryRoot, tree.root, tree.kind, files);
  }
  for (const screen of SCREEN_IDS) {
    const referenceScreen = screen === "lobby-host" ? "lobby" : screen;
    files.add(`prototype/audit/current/after/implementation-${referenceScreen}-390x844-final.png`);
  }
  return [...files].sort(compareUtf8Paths);
}

async function collectFingerprintTree(repositoryRoot, root, kind, files, directory = "") {
  const entries = await readdir(resolve(repositoryRoot, root, directory), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareUtf8Paths(left.name, right.name))) {
    const child = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collectFingerprintTree(repositoryRoot, root, kind, files, child);
      continue;
    }
    if (!entry.isFile()) continue;
    if (kind === "runtime-typescript" && (!child.endsWith(".ts") || child.endsWith(".test.ts"))) continue;
    files.add(`${root}/${child}`);
  }
}

function safeRepositoryFile(repositoryRoot, file) {
  const absolutePath = resolve(repositoryRoot, file);
  const repositoryRelative = relative(repositoryRoot, absolutePath);
  assert(
    repositoryRelative !== "" && !repositoryRelative.startsWith(`..${sep}`) && repositoryRelative !== ".." && !isAbsolute(repositoryRelative),
    `EVIDENCE_FILE_OUTSIDE_REPOSITORY:${file}`,
  );
  return absolutePath;
}

export function decodePng(input, label = "<buffer>") {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assert(bytes.length >= 33, `EVIDENCE_PNG_TRUNCATED:${label}`);
  assert(bytes.subarray(0, 8).toString("hex") === PNG_SIGNATURE, `EVIDENCE_NOT_PNG:${label}`);

  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  let ended = false;
  const idat = [];
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length, `EVIDENCE_PNG_CHUNK_TRUNCATED:${label}`);
    const length = bytes.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    assert(crcOffset + 4 <= bytes.length, `EVIDENCE_PNG_CHUNK_TRUNCATED:${label}`);
    const typeBytes = bytes.subarray(typeOffset, dataOffset);
    const type = typeBytes.toString("ascii");
    const data = bytes.subarray(dataOffset, crcOffset);
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    assert(expectedCrc === actualCrc, `EVIDENCE_PNG_CRC_INVALID:${label}:${type}`);

    if (type === "IHDR") {
      assert(header === null && length === 13, `EVIDENCE_PNG_IHDR_INVALID:${label}`);
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      assert(length === 0, `EVIDENCE_PNG_IEND_INVALID:${label}`);
      ended = true;
      offset = crcOffset + 4;
      break;
    } else if (/^[A-Z]/u.test(type)) {
      throw new Error(`EVIDENCE_PNG_CRITICAL_CHUNK_UNSUPPORTED:${label}:${type}`);
    }
    offset = crcOffset + 4;
  }

  assert(header && ended && idat.length > 0, `EVIDENCE_PNG_STRUCTURE_INVALID:${label}`);
  assert(offset === bytes.length, `EVIDENCE_PNG_TRAILING_BYTES:${label}`);
  assert(header.width > 0 && header.height > 0, `EVIDENCE_PNG_DIMENSIONS_INVALID:${label}`);
  assert(header.width * header.height <= 10_000_000, `EVIDENCE_PNG_DIMENSIONS_UNSAFE:${label}`);
  assert(header.bitDepth === 8, `EVIDENCE_PNG_BIT_DEPTH_UNSUPPORTED:${label}`);
  assert([0, 2, 3, 4, 6].includes(header.colorType), `EVIDENCE_PNG_COLOR_TYPE_UNSUPPORTED:${label}`);
  assert(header.compression === 0 && header.filter === 0, `EVIDENCE_PNG_METHOD_UNSUPPORTED:${label}`);
  assert(header.interlace === 0, `EVIDENCE_PNG_INTERLACE_UNSUPPORTED:${label}`);

  const channels = pngChannels(header.colorType);
  const rowBytes = header.width * channels;
  const expectedInflatedLength = (rowBytes + 1) * header.height;
  let filtered;
  try {
    filtered = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflatedLength });
  } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE") {
      throw new Error(`EVIDENCE_PNG_DEFLATE_LIMIT:${label}`);
    }
    throw new Error(`EVIDENCE_PNG_DEFLATE_INVALID:${label}`);
  }
  assert(
    filtered.length === expectedInflatedLength,
    `EVIDENCE_PNG_SCANLINE_LENGTH_INVALID:${label}`,
  );
  const samples = unfilterPng(filtered, header.width, header.height, channels, label);
  const rgba = pngSamplesToRgba(samples, header, palette, transparency, label);
  return { width: header.width, height: header.height, rgba };
}

function unfilterPng(filtered, width, height, bytesPerPixel, label) {
  const rowBytes = width * bytesPerPixel;
  const output = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    assert(filter <= 4, `EVIDENCE_PNG_FILTER_UNSUPPORTED:${label}:${filter}`);
    const rowOffset = y * rowBytes;
    const previousOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? output[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? output[previousOffset + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? output[previousOffset + x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      output[rowOffset + x] = (raw + predictor) & 0xff;
    }
    sourceOffset += rowBytes;
  }
  return output;
}

function pngSamplesToRgba(samples, header, palette, transparency, label) {
  const pixels = header.width * header.height;
  const rgba = Buffer.alloc(pixels * 4);
  if (header.colorType === 3) {
    assert(palette && palette.length > 0 && palette.length % 3 === 0, `EVIDENCE_PNG_PALETTE_INVALID:${label}`);
  }
  for (let index = 0; index < pixels; index += 1) {
    const target = index * 4;
    if (header.colorType === 6) {
      const source = index * 4;
      rgba[target] = samples[source];
      rgba[target + 1] = samples[source + 1];
      rgba[target + 2] = samples[source + 2];
      rgba[target + 3] = samples[source + 3];
    } else if (header.colorType === 2) {
      const source = index * 3;
      const red = samples[source];
      const green = samples[source + 1];
      const blue = samples[source + 2];
      rgba[target] = red;
      rgba[target + 1] = green;
      rgba[target + 2] = blue;
      rgba[target + 3] = transparentRgb(red, green, blue, transparency) ? 0 : 255;
    } else if (header.colorType === 4) {
      const source = index * 2;
      rgba[target] = samples[source];
      rgba[target + 1] = samples[source];
      rgba[target + 2] = samples[source];
      rgba[target + 3] = samples[source + 1];
    } else if (header.colorType === 0) {
      const gray = samples[index];
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = transparentGray(gray, transparency) ? 0 : 255;
    } else {
      const paletteIndex = samples[index];
      const paletteOffset = paletteIndex * 3;
      assert(paletteOffset + 2 < palette.length, `EVIDENCE_PNG_PALETTE_INDEX_INVALID:${label}`);
      rgba[target] = palette[paletteOffset];
      rgba[target + 1] = palette[paletteOffset + 1];
      rgba[target + 2] = palette[paletteOffset + 2];
      rgba[target + 3] = transparency?.[paletteIndex] ?? 255;
    }
  }
  return rgba;
}

function transparentGray(gray, transparency) {
  return Boolean(transparency && transparency.length >= 2 && transparency.readUInt16BE(0) === gray);
}

function transparentRgb(red, green, blue, transparency) {
  return Boolean(
    transparency
      && transparency.length >= 6
      && transparency.readUInt16BE(0) === red
      && transparency.readUInt16BE(2) === green
      && transparency.readUInt16BE(4) === blue,
  );
}

function pngChannels(colorType) {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  return 4;
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

export function assertImageHasVariation(image, label = "<image>") {
  assert(image.rgba.length === image.width * image.height * 4, `EVIDENCE_RGBA_LENGTH_INVALID:${label}`);
  let firstVisible = null;
  for (let offset = 0; offset < image.rgba.length; offset += 4) {
    if (image.rgba[offset + 3] === 0) continue;
    const color = (image.rgba[offset] << 16) | (image.rgba[offset + 1] << 8) | image.rgba[offset + 2];
    if (firstVisible === null) firstVisible = color;
    else if (color !== firstVisible) return;
  }
  assert(false, `EVIDENCE_IMAGE_PURE_COLOR:${label}`);
}

export function assertNoShiftRepeat(image, label = "<image>") {
  const shift = antiRepeatShift(image.height, label);
  const overlap = image.height - shift;
  const normalizedRgbMae = normalizedRgbMaeRegion(
    image,
    { x: 0, y: 0, width: image.width, height: overlap },
    image,
    { x: 0, y: shift, width: image.width, height: overlap },
  );
  assert(
    normalizedRgbMae >= ANTI_REPEAT_MAE_LIMIT,
    `EVIDENCE_VERTICAL_REPEAT:${label}:shift=${shift}:overlap=${overlap}:mae=${formatMae(normalizedRgbMae)}`,
  );
  assertNoExactRepeatedRowRun(image, label);
  return { shift, overlap, normalizedRgbMae };
}

function assertNoExactRepeatedRowRun(image, label) {
  const rowBytes = image.width * 4;
  const rowHashes = Array.from({ length: image.height }, (_, y) => createHash("sha256")
    .update(image.rgba.subarray(y * rowBytes, (y + 1) * rowBytes))
    .digest("hex"));

  for (let shift = 1; shift <= image.height - ANTI_REPEAT_MIN_OVERLAP; shift += 1) {
    let runStart = 0;
    let runLength = 0;
    const overlap = image.height - shift;
    for (let y = 0; y <= overlap; y += 1) {
      if (y < overlap && rowHashes[y] === rowHashes[y + shift]) {
        if (runLength === 0) runStart = y;
        runLength += 1;
        continue;
      }
      if (runLength >= ANTI_REPEAT_MIN_OVERLAP) {
        const distinctRows = new Set(rowHashes.slice(runStart, runStart + runLength));
        assert(
          distinctRows.size === 1 && rowIsSolidColor(image, runStart),
          `EVIDENCE_VERTICAL_REPEAT_RUN:${label}:shift=${shift}:start=${runStart}:rows=${runLength}`,
        );
      }
      runLength = 0;
    }
  }
}

function rowIsSolidColor(image, y) {
  const rowOffset = y * image.width * 4;
  for (let x = 1; x < image.width; x += 1) {
    const pixelOffset = rowOffset + x * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      if (image.rgba[pixelOffset + channel] !== image.rgba[rowOffset + channel]) return false;
    }
  }
  return true;
}

function antiRepeatShift(height, label) {
  const preferredOverlap = height - ANTI_REPEAT_PREFERRED_SHIFT;
  if (preferredOverlap >= ANTI_REPEAT_MIN_OVERLAP) return ANTI_REPEAT_PREFERRED_SHIFT;
  const halfHeight = Math.floor(height / 2);
  assert(
    halfHeight > 0 && height - halfHeight >= ANTI_REPEAT_MIN_OVERLAP,
    `EVIDENCE_ANTI_REPEAT_IMAGE_TOO_SHORT:${label}:height=${height}`,
  );
  return halfHeight;
}

export function assertExactCanvasCrop(comparison, current, label = "<comparison>") {
  const normalizedRgbMae = normalizedRgbMaeRegion(
    comparison,
    COMPARISON_CANVAS_CROP,
    current,
    { x: 0, y: 0, width: current.width, height: current.height },
  );
  let alphaMismatch = false;
  for (let y = 0; y < current.height && !alphaMismatch; y += 1) {
    let comparisonOffset = ((COMPARISON_CANVAS_CROP.y + y) * comparison.width + COMPARISON_CANVAS_CROP.x) * 4 + 3;
    let currentOffset = y * current.width * 4 + 3;
    for (let x = 0; x < current.width; x += 1) {
      if (comparison.rgba[comparisonOffset] !== current.rgba[currentOffset]) {
        alphaMismatch = true;
        break;
      }
      comparisonOffset += 4;
      currentOffset += 4;
    }
  }
  assert(
    normalizedRgbMae === 0 && !alphaMismatch,
    `EVIDENCE_COMPARISON_CANVAS_MISMATCH:${label}:mae=${formatMae(normalizedRgbMae)}:alpha=${alphaMismatch ? "mismatch" : "exact"}`,
  );
  return normalizedRgbMae;
}

export function assertExactDerivedCrop(source, derived, crop, label = "<focus>") {
  validateImageRegion(source, crop, "FOCUS_SOURCE");
  assert(
    derived.width === crop.width && derived.height === crop.height,
    `EVIDENCE_FOCUS_DIMENSIONS_INVALID:${label}`,
  );
  assert(
    derived.rgba.length === derived.width * derived.height * 4,
    `EVIDENCE_RGBA_LENGTH_INVALID:${label}`,
  );
  const rowBytes = crop.width * 4;
  for (let y = 0; y < crop.height; y += 1) {
    const sourceOffset = ((crop.y + y) * source.width + crop.x) * 4;
    const derivedOffset = y * rowBytes;
    assert(
      source.rgba.subarray(sourceOffset, sourceOffset + rowBytes)
        .equals(derived.rgba.subarray(derivedOffset, derivedOffset + rowBytes)),
      `EVIDENCE_FOCUS_SOURCE_MISMATCH:${label}:row=${y}`,
    );
  }
}

export function assertUniqueEvidenceContent(records) {
  const byteHashes = new Map();
  const pixelHashes = new Map();
  for (const record of records) {
    const duplicateBytes = byteHashes.get(record.sha256);
    assert(
      duplicateBytes === undefined,
      `EVIDENCE_FILE_CONTENT_DUPLICATE:${record.file}:${duplicateBytes}`,
    );
    byteHashes.set(record.sha256, record.file);

    const pixelHash = record.pixelContentHash ?? pixelContentHash(record.image);
    const duplicatePixels = pixelHashes.get(pixelHash);
    assert(
      duplicatePixels === undefined,
      `EVIDENCE_PIXEL_CONTENT_DUPLICATE:${record.file}:${duplicatePixels}`,
    );
    pixelHashes.set(pixelHash, record.file);
  }
}

function evidenceContentRecord(file, sha256, image) {
  return { file, sha256, pixelContentHash: pixelContentHash(image) };
}

function pixelContentHash(image) {
  return createHash("sha256")
    .update(`${image.width}x${image.height}\0`, "utf8")
    .update(image.rgba)
    .digest("hex");
}

export function assertDensityCaptureIndependent(
  density,
  current,
  renderDpr,
  label = "<density>",
) {
  assert(DENSITY_DPRS.includes(renderDpr), `EVIDENCE_RENDER_DPR_INVALID:${renderDpr}`);
  assert(
    density.width === current.width * renderDpr && density.height === current.height * renderDpr,
    `EVIDENCE_DENSITY_DIMENSIONS_INVALID:${label}`,
  );
  let differentPixels = 0;
  let rgbDifference = 0;
  let bilinearDifferentPixels = 0;
  let bilinearRgbDifference = 0;
  for (let y = 0; y < density.height; y += 1) {
    const sourceY = Math.floor(y / renderDpr);
    const bilinearY = (y + 0.5) / renderDpr - 0.5;
    const top = Math.max(0, Math.floor(bilinearY));
    const bottom = Math.min(current.height - 1, top + 1);
    const yWeight = Math.max(0, bilinearY - top);
    for (let x = 0; x < density.width; x += 1) {
      const sourceX = Math.floor(x / renderDpr);
      const densityOffset = (y * density.width + x) * 4;
      const currentOffset = (sourceY * current.width + sourceX) * 4;
      let different = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(density.rgba[densityOffset + channel] - current.rgba[currentOffset + channel]);
        if (delta !== 0) different = true;
        if (channel < 3) rgbDifference += delta;
      }
      if (different) differentPixels += 1;

      const bilinearX = (x + 0.5) / renderDpr - 0.5;
      const left = Math.max(0, Math.floor(bilinearX));
      const right = Math.min(current.width - 1, left + 1);
      const xWeight = Math.max(0, bilinearX - left);
      const topLeft = (top * current.width + left) * 4;
      const topRight = (top * current.width + right) * 4;
      const bottomLeft = (bottom * current.width + left) * 4;
      const bottomRight = (bottom * current.width + right) * 4;
      const alpha = bilinearSample(
        current.rgba[topLeft + 3],
        current.rgba[topRight + 3],
        current.rgba[bottomLeft + 3],
        current.rgba[bottomRight + 3],
        xWeight,
        yWeight,
      );
      const predictedAlpha = Math.round(alpha);
      let bilinearDifferent = predictedAlpha !== density.rgba[densityOffset + 3];
      for (let channel = 0; channel < 3; channel += 1) {
        const premultiplied = bilinearSample(
          current.rgba[topLeft + channel] * current.rgba[topLeft + 3] / 255,
          current.rgba[topRight + channel] * current.rgba[topRight + 3] / 255,
          current.rgba[bottomLeft + channel] * current.rgba[bottomLeft + 3] / 255,
          current.rgba[bottomRight + channel] * current.rgba[bottomRight + 3] / 255,
          xWeight,
          yWeight,
        );
        const predicted = alpha > 0 ? Math.round(premultiplied * 255 / alpha) : 0;
        const delta = Math.abs(density.rgba[densityOffset + channel] - predicted);
        if (delta !== 0) bilinearDifferent = true;
        bilinearRgbDifference += delta;
      }
      if (bilinearDifferent) bilinearDifferentPixels += 1;
    }
  }
  const pixels = density.width * density.height;
  const differentPixelRatio = differentPixels / pixels;
  const normalizedRgbMae = rgbDifference / (pixels * 3 * 255);
  const bilinearDifferentPixelRatio = bilinearDifferentPixels / pixels;
  const bilinearNormalizedRgbMae = bilinearRgbDifference / (pixels * 3 * 255);
  const nearestIndependent = differentPixelRatio >= DENSITY_MIN_DIFFERENT_PIXEL_RATIO
    && normalizedRgbMae >= DENSITY_MIN_NEAREST_RGB_MAE;
  const bilinearIndependent = bilinearDifferentPixelRatio >= DENSITY_MIN_DIFFERENT_PIXEL_RATIO
    && bilinearNormalizedRgbMae >= DENSITY_MIN_NEAREST_RGB_MAE;
  assert(
    nearestIndependent && bilinearIndependent,
    `EVIDENCE_DENSITY_MECHANICAL_UPSCALE:${label}:nearest=${differentPixelRatio.toFixed(6)}/${normalizedRgbMae.toFixed(6)}:bilinear=${bilinearDifferentPixelRatio.toFixed(6)}/${bilinearNormalizedRgbMae.toFixed(6)}`,
  );
  return {
    nearest: { differentPixelRatio, normalizedRgbMae },
    bilinear: {
      differentPixelRatio: bilinearDifferentPixelRatio,
      normalizedRgbMae: bilinearNormalizedRgbMae,
    },
  };
}

function bilinearSample(topLeft, topRight, bottomLeft, bottomRight, xWeight, yWeight) {
  const top = topLeft + (topRight - topLeft) * xWeight;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
  return top + (bottom - top) * yWeight;
}

export function normalizedRgbMaeRegion(left, leftRect, right, rightRect) {
  validateImageRegion(left, leftRect, "LEFT");
  validateImageRegion(right, rightRect, "RIGHT");
  assert(
    leftRect.width === rightRect.width && leftRect.height === rightRect.height,
    "EVIDENCE_IMAGE_REGION_SIZE_MISMATCH",
  );
  if (leftRect.width === 0 || leftRect.height === 0) return 0;
  let difference = 0;
  for (let y = 0; y < leftRect.height; y += 1) {
    let leftOffset = ((leftRect.y + y) * left.width + leftRect.x) * 4;
    let rightOffset = ((rightRect.y + y) * right.width + rightRect.x) * 4;
    for (let x = 0; x < leftRect.width; x += 1) {
      difference += Math.abs(left.rgba[leftOffset] - right.rgba[rightOffset]);
      difference += Math.abs(left.rgba[leftOffset + 1] - right.rgba[rightOffset + 1]);
      difference += Math.abs(left.rgba[leftOffset + 2] - right.rgba[rightOffset + 2]);
      leftOffset += 4;
      rightOffset += 4;
    }
  }
  return difference / (leftRect.width * leftRect.height * 3 * 255);
}

function validateImageRegion(image, rect, label) {
  requireObject(image, `EVIDENCE_${label}_IMAGE_INVALID`);
  requireObject(rect, `EVIDENCE_${label}_REGION_INVALID`);
  for (const key of ["x", "y", "width", "height"]) {
    assert(Number.isInteger(rect[key]) && rect[key] >= 0, `EVIDENCE_${label}_REGION_INVALID:${key}`);
  }
  assert(rect.x + rect.width <= image.width, `EVIDENCE_${label}_REGION_OUT_OF_BOUNDS`);
  assert(rect.y + rect.height <= image.height, `EVIDENCE_${label}_REGION_OUT_OF_BOUNDS`);
  assert(image.rgba.length === image.width * image.height * 4, `EVIDENCE_${label}_RGBA_LENGTH_INVALID`);
}

export function decodeJpegHeader(input, label = "<buffer>") {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assert(bytes.length >= 8, `REFERENCE_JPEG_TRUNCATED:${label}`);
  assert(bytes[0] === 0xff && bytes[1] === 0xd8, `REFERENCE_NOT_JPEG:${label}`);
  assert(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9, `REFERENCE_JPEG_EOI_MISSING:${label}`);
  let offset = 2;
  while (offset < bytes.length - 2) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    assert(offset < bytes.length, `REFERENCE_JPEG_MARKER_TRUNCATED:${label}`);
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    assert(offset + 2 <= bytes.length, `REFERENCE_JPEG_SEGMENT_TRUNCATED:${label}`);
    const length = bytes.readUInt16BE(offset);
    assert(length >= 2 && offset + length <= bytes.length, `REFERENCE_JPEG_SEGMENT_INVALID:${label}`);
    if (isJpegStartOfFrame(marker)) {
      assert(length >= 8, `REFERENCE_JPEG_SOF_INVALID:${label}`);
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      assert(width > 0 && height > 0, `REFERENCE_JPEG_DIMENSIONS_INVALID:${label}`);
      return { width, height };
    }
    if (marker === 0xda) break;
    offset += length;
  }
  throw new Error(`REFERENCE_JPEG_SOF_MISSING:${label}`);
}

function isJpegStartOfFrame(marker) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertExactUniqueKeys(entries, keyFor, expectedKeys, code) {
  const keys = entries.map(keyFor);
  const unique = new Set(keys);
  assert(unique.size === keys.length, `${code}_DUPLICATE_KEY`);
  assertSetEquals(unique, new Set(expectedKeys), `${code}_INCOMPLETE`);
}

function assertSetEquals(actual, expected, code) {
  const missing = [...expected].filter((value) => !actual.has(value));
  const unexpected = [...actual].filter((value) => !expected.has(value));
  assert(
    missing.length === 0 && unexpected.length === 0,
    `${code}:missing=${missing.join(",") || "-"}:unexpected=${unexpected.join(",") || "-"}`,
  );
}

function assertSize(actual, expected, code) {
  requireObject(actual, code);
  assert(actual.width === expected.width && actual.height === expected.height, code);
}

function assertRect(actual, expected, code) {
  requireObject(actual, code);
  for (const key of ["x", "y", "width", "height"]) {
    assert(Number.isFinite(actual[key]) && Math.abs(actual[key] - expected[key]) <= 0.01, code);
  }
}

function assertNearlyEqual(actual, expected, tolerance, code) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${code}:expected=${formatMae(expected)}:actual=${actual}`);
}

function viewportSize(viewport, code = "EVIDENCE_VIEWPORT_INVALID") {
  assert(typeof viewport === "string" && /^\d+x\d+$/u.test(viewport), code);
  const [width, height] = viewport.split("x").map(Number);
  assert(width > 0 && height > 0, code);
  return { width, height };
}

function scaleSize(size, dpr) {
  assert(DENSITY_DPRS.includes(dpr), `EVIDENCE_RENDER_DPR_INVALID:${dpr}`);
  return { width: size.width * dpr, height: size.height * dpr };
}

function requireTemplate(template, placeholders, label) {
  assert(typeof template === "string" && template.length > 0, `EVIDENCE_${label}_PATH_TEMPLATE_INVALID`);
  for (const placeholder of placeholders) {
    assert(template.includes(`<${placeholder}>`), `EVIDENCE_${label}_PATH_TEMPLATE_PLACEHOLDER_MISSING:${placeholder}`);
  }
}

function expandTemplate(template, values) {
  let output = template;
  for (const [key, value] of Object.entries(values)) output = output.replaceAll(`<${key}>`, String(value));
  assert(!/<[^>]+>/u.test(output), `EVIDENCE_PATH_TEMPLATE_UNRESOLVED:${output}`);
  return normalizeRepositoryPath(output);
}

function normalizeRepositoryPath(path) {
  return path.split("\\").join("/");
}

function compareUtf8Paths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function requireObject(value, code) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), code);
}

function formatMae(value) {
  return value.toFixed(8);
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

const mainArgument = process.argv?.[1];
const isMain = mainArgument
  && pathToFileURL(resolve(mainArgument)).href === import.meta.url;

if (isMain) await verifyEvidence();
