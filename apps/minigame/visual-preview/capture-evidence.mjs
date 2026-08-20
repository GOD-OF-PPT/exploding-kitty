import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, platform, tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { buildVisualPreview } from "../scripts/build-visual-preview.mjs";
import {
  assertImageHasVariation,
  assertNoShiftRepeat,
  collectInputFingerprintRecords,
  computeCaptureSourceSnapshot,
  computeInputFingerprint,
  computeRgbaPixelHash,
  decodePng,
  getEvidenceManifestContract,
  resolveEvidenceManifestFile,
  validateManifestShape,
  verifyEvidence,
} from "./verify-evidence.mjs";

const execFileAsync = promisify(execFile);
const PREVIEW_ROOT = dirname(fileURLToPath(import.meta.url));
const MINIGAME_ROOT = resolve(PREVIEW_ROOT, "..");
const REPOSITORY_ROOT = resolve(MINIGAME_ROOT, "../..");
const DIST_ROOT = resolve(PREVIEW_ROOT, "dist");
const CANONICAL_OUTPUT = resolve(PREVIEW_ROOT, "evidence");
const EVIDENCE_PREFIX = "apps/minigame/visual-preview/evidence/";
const DATA_URL_PREFIX = "data:image/png;base64,";
const DEFAULT_TIMEOUT_MS = 45_000;
const COMPARISON_CROP = Object.freeze({ x: 479, y: 81, width: 390, height: 844, normalizedRgbMae: 0 });

export async function captureEvidenceBatch({
  repositoryRoot = REPOSITORY_ROOT,
  outputDirectory,
  chromePath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  keepFailed = false,
} = {}) {
  if (!outputDirectory) throw new Error("EVIDENCE_OUTPUT_DIRECTORY_REQUIRED");
  const root = resolve(repositoryRoot);
  const output = resolveOutputDirectory(outputDirectory, root);
  await assertExplicitEmptyOutputDirectory(output, root);

  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(resolve(parent, `.${basename(output)}.staging-`));
  let published = false;
  try {
    await buildVisualPreview();
    const contract = getEvidenceManifestContract();
    validateGenerationContract(contract);
    const provenance = await captureProvenance(root, contract);
    const chrome = await resolveChromeExecutable(chromePath);
    const server = await startStaticServer(DIST_ROOT);
    let browser;
    let captureError;
    try {
      browser = await launchBrowser(chrome, timeoutMs);
      await capturePlanIntoStaging({
        browser,
        baseUrl: server.baseUrl,
        staging,
        contract,
        provenance,
        timeoutMs,
        repositoryRoot: root,
      });
    } catch (error) {
      captureError = error;
    } finally {
      const cleanup = await Promise.allSettled([
        browser?.close() ?? Promise.resolve(),
        server.close(),
      ]);
      const cleanupErrors = cleanup
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (captureError) {
        if (cleanupErrors.length) throw new AggregateError([captureError, ...cleanupErrors], "EVIDENCE_CAPTURE_AND_CLEANUP_FAILED");
        throw captureError;
      }
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "EVIDENCE_CAPTURE_CLEANUP_FAILED");
    }

    const verify = (directory) => verifyEvidence({
      repositoryRoot: root,
      previewRoot: PREVIEW_ROOT,
      evidenceRoot: directory,
      manifestPath: resolve(directory, "manifest.json"),
    });
    // Re-resolve junctions/symlinks after the multi-minute capture window.
    await assertExplicitEmptyOutputDirectory(output, root);
    await publishEvidenceBatch({ stagingDirectory: staging, outputDirectory: output, verify });
    published = true;
    const manifestBytes = await readFile(resolve(output, "manifest.json"));
    const manifestSha256 = sha256(manifestBytes);
    console.log(`Schema v3 evidence published atomically at ${output}`);
    console.log(`manifest sha256 ${manifestSha256}`);
    return { outputDirectory: output, manifestSha256 };
  } catch (error) {
    if (keepFailed && await pathExists(staging)) {
      console.error(`Failed staging batch preserved at ${staging}`);
    } else if (await pathExists(staging)) {
      await rm(staging, { recursive: true, force: true });
    }
    throw error;
  } finally {
    if (published && await pathExists(staging)) await rm(staging, { recursive: true, force: true });
  }
}

async function capturePlanIntoStaging({
  browser,
  baseUrl,
  staging,
  contract,
  provenance,
  timeoutMs,
  repositoryRoot,
}) {
  await Promise.all(["current", "density", "comparisons", "focus"].map(
    (directory) => mkdir(resolve(staging, directory), { recursive: true }),
  ));

  const bootstrapQuery = "?screen=login&viewport=390x844&mode=canvas&state=initial";
  await browser.navigate(`${baseUrl}/${bootstrapQuery}`, timeoutMs);
  const plan = await browser.evaluate(
    "window.__VISUAL_PREVIEW_CAPTURE__.plan",
    { awaitPromise: false, timeoutMs },
  );
  validateBrowserPlan(plan, contract);

  const current = [];
  const density = [];
  const interactionCaptures = [];
  const comparisons = [];
  const recordsByFile = new Map();

  for (let index = 0; index < plan.length; index += 1) {
    const entry = plan[index];
    console.log(`[${String(index + 1).padStart(3, "0")}/${plan.length}] ${entry.id}`);
    await browser.navigate(`${baseUrl}/${entry.query}`, timeoutMs);

    let acceptedCurrent;
    if (entry.requiresAcceptedCurrentPng) {
      const currentFile = canonicalEvidencePath(entry.acceptedCurrentPath);
      const currentRecord = recordsByFile.get(currentFile);
      if (!currentRecord) throw new Error(`EVIDENCE_ACCEPTED_CURRENT_NOT_CAPTURED:${currentFile}`);
      const currentBytes = await readFile(resolveEvidenceManifestFile(staging, currentFile));
      const currentDataUrl = `${DATA_URL_PREFIX}${currentBytes.toString("base64")}`;
      const composed = await browser.evaluate(
        `window.__VISUAL_PREVIEW_CAPTURE__.composeAcceptedCurrentPng(${JSON.stringify(currentDataUrl)})`,
        { awaitPromise: true, timeoutMs },
      );
      acceptedCurrent = composed.acceptedCurrent;
    }

    const capture = await browser.evaluate(
      `window.__VISUAL_PREVIEW_CAPTURE__.capturePng(${JSON.stringify(entry.selector)})`,
      { awaitPromise: true, timeoutMs },
    );
    const { bytes, pngByteSha256 } = decodeCaptureData(capture);
    const file = canonicalEvidencePath(entry.outputPath);
    const image = decodePng(bytes, file);
    assertImageHasVariation(image, file);
    const antiRepeat = assertNoShiftRepeat(image, file);
    const record = {
      ...capture.record,
      file,
      sha256: pngByteSha256,
      pngByteSha256,
      sourceSnapshotSha256: provenance.sourceSnapshotSha256,
      antiRepeat,
      ...(entry.kind === "interaction" ? interactionFields(entry, recordsByFile) : {}),
      ...(entry.kind === "comparison" ? { acceptedCurrent, canvasCrop: { ...COMPARISON_CROP } } : {}),
    };
    await writeBatchFile(staging, file, bytes);
    recordsByFile.set(file, record);

    if (entry.kind.startsWith("current-")) current.push(record);
    else if (entry.kind === "density") density.push(record);
    else if (entry.kind === "interaction") interactionCaptures.push(record);
    else if (entry.kind === "comparison") comparisons.push(record);
    else throw new Error(`EVIDENCE_CAPTURE_PLAN_KIND_UNKNOWN:${entry.kind}`);
  }

  const focus = await deriveFocusEntries(staging, contract.focus, recordsByFile);
  const references = await referenceEntries(contract.references.items, repositoryRoot);
  const manifest = {
    schemaVersion: contract.schemaVersion,
    fixtureSet: `sha256:${provenance.inputFingerprintSha256}`,
    sourceBaseCommit: await sourceBaseCommit(repositoryRoot),
    pathTemplates: { ...contract.pathTemplates },
    counts: { ...contract.counts },
    capture: {
      ...contract.capture,
      previewBundleSha256: provenance.previewBundleSha256,
      inputFingerprintSha256: provenance.inputFingerprintSha256,
      sourceSnapshotSha256: provenance.sourceSnapshotSha256,
    },
    previewBundle: {
      ...contract.previewBundle,
      sha256: provenance.previewBundleSha256,
    },
    inputFingerprint: {
      ...contract.inputFingerprint,
      sha256: provenance.inputFingerprintSha256,
      files: provenance.inputFingerprintRecords,
    },
    current,
    density,
    interactionCaptures,
    comparisons,
    references: { items: references },
    focus,
  };
  validateManifestShape(manifest);
  await writeFile(resolve(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function interactionFields(entry, recordsByFile) {
  const initialFile = canonicalEvidencePath(entry.initialCapturePath);
  const initial = recordsByFile.get(initialFile);
  if (!initial) throw new Error(`EVIDENCE_INTERACTION_INITIAL_NOT_CAPTURED:${initialFile}`);
  return {
    id: entry.id,
    kind: "interaction",
    state: entry.captureState,
    initialCapture: {
      file: initial.file,
      sha256: initial.sha256,
      pixelHash: initial.pixelHash,
    },
  };
}

async function deriveFocusEntries(staging, descriptors, recordsByFile) {
  const entries = [];
  for (const descriptor of descriptors) {
    const source = recordsByFile.get(descriptor.sourceFile);
    if (!source) throw new Error(`EVIDENCE_FOCUS_SOURCE_NOT_CAPTURED:${descriptor.sourceFile}`);
    const sourceBytes = await readFile(resolveEvidenceManifestFile(staging, descriptor.sourceFile));
    const sourceImage = decodePng(sourceBytes, descriptor.sourceFile);
    const cropped = cropRgbaImage(sourceImage, descriptor.crop);
    const bytes = encodeRgbaPng(cropped);
    const hash = sha256(bytes);
    const entry = {
      ...descriptor,
      sha256: hash,
      pngByteSha256: hash,
      pixelHash: computeRgbaPixelHash(cropped, descriptor.file),
      sourceSha256: source.sha256,
      sourcePixelHash: source.pixelHash,
    };
    await writeBatchFile(staging, descriptor.file, bytes);
    entries.push(entry);
  }
  return entries;
}

async function referenceEntries(descriptors, repositoryRoot) {
  const entries = [];
  for (const descriptor of descriptors) {
    const bytes = await readFile(resolve(repositoryRoot, ...descriptor.file.split("/")));
    entries.push({ ...descriptor, sha256: sha256(bytes) });
  }
  return entries;
}

async function captureProvenance(repositoryRoot, contract) {
  const bundleFile = resolve(repositoryRoot, ...contract.previewBundle.file.split("/"));
  const previewBundleSha256 = sha256(await readFile(bundleFile));
  const inputFingerprintRecords = await collectInputFingerprintRecords(repositoryRoot);
  const inputFingerprintSha256 = computeInputFingerprint(inputFingerprintRecords);
  const sourceSnapshotSha256 = computeCaptureSourceSnapshot(
    previewBundleSha256,
    inputFingerprintSha256,
  );
  return {
    previewBundleSha256,
    inputFingerprintRecords,
    inputFingerprintSha256,
    sourceSnapshotSha256,
  };
}

function validateGenerationContract(contract) {
  if (contract.schemaVersion !== 3) throw new Error("EVIDENCE_GENERATION_SCHEMA_UNSUPPORTED");
  const direct = contract.counts.current
    + contract.counts.density
    + contract.counts.interactionCaptures
    + contract.counts.comparisons;
  if (direct !== 119 || contract.counts.focus !== 11 || contract.counts.references !== 25) {
    throw new Error("EVIDENCE_GENERATION_CONTRACT_COUNT_INVALID");
  }
  if (contract.capture.method !== "CDP Runtime.evaluate -> HTMLCanvasElement.toDataURL(format=png)") {
    throw new Error("EVIDENCE_GENERATION_CAPTURE_METHOD_INVALID");
  }
}

function validateBrowserPlan(plan, contract) {
  if (!Array.isArray(plan) || plan.length !== 119) throw new Error("EVIDENCE_CAPTURE_PLAN_COUNT_INVALID");
  const ids = new Set();
  const paths = new Set();
  const counts = { current: 0, density: 0, interactionCaptures: 0, comparisons: 0 };
  for (const entry of plan) {
    if (!entry || typeof entry !== "object") throw new Error("EVIDENCE_CAPTURE_PLAN_ENTRY_INVALID");
    if (ids.has(entry.id)) throw new Error(`EVIDENCE_CAPTURE_PLAN_ID_DUPLICATE:${entry.id}`);
    if (paths.has(entry.outputPath)) throw new Error(`EVIDENCE_CAPTURE_PLAN_PATH_DUPLICATE:${entry.outputPath}`);
    ids.add(entry.id);
    paths.add(entry.outputPath);
    if (!String(entry.outputPath).startsWith("evidence/")) {
      throw new Error(`EVIDENCE_CAPTURE_PLAN_PATH_INVALID:${entry.outputPath}`);
    }
    if (String(entry.kind).startsWith("current-")) counts.current += 1;
    else if (entry.kind === "density") counts.density += 1;
    else if (entry.kind === "interaction") counts.interactionCaptures += 1;
    else if (entry.kind === "comparison") counts.comparisons += 1;
    else throw new Error(`EVIDENCE_CAPTURE_PLAN_KIND_UNKNOWN:${entry.kind}`);
  }
  for (const key of Object.keys(counts)) {
    if (counts[key] !== contract.counts[key]) throw new Error(`EVIDENCE_CAPTURE_PLAN_${key.toUpperCase()}_COUNT_INVALID`);
  }
}

function decodeCaptureData(capture) {
  if (!capture || typeof capture !== "object" || typeof capture.dataUrl !== "string") {
    throw new Error("EVIDENCE_CAPTURE_RESULT_INVALID");
  }
  if (!capture.dataUrl.startsWith(DATA_URL_PREFIX)) throw new Error("EVIDENCE_CAPTURE_DATA_URL_INVALID");
  const bytes = Buffer.from(capture.dataUrl.slice(DATA_URL_PREFIX.length), "base64");
  const pngByteSha256 = sha256(bytes);
  if (capture.pngByteSha256 !== pngByteSha256) throw new Error("EVIDENCE_CAPTURE_PNG_HASH_MISMATCH");
  return { bytes, pngByteSha256 };
}

async function writeBatchFile(staging, canonicalFile, bytes) {
  const target = resolveEvidenceManifestFile(staging, canonicalFile);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

function canonicalEvidencePath(planPath) {
  const value = String(planPath ?? "").replaceAll("\\", "/");
  if (!value.startsWith("evidence/") || value.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new Error(`EVIDENCE_CAPTURE_PLAN_PATH_INVALID:${value}`);
  }
  return `apps/minigame/visual-preview/${value}`;
}

async function sourceBaseCommit(repositoryRoot) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  const commit = stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("EVIDENCE_SOURCE_COMMIT_INVALID");
  return commit;
}

export async function assertExplicitEmptyOutputDirectory(outputDirectory, repositoryRoot = REPOSITORY_ROOT) {
  const output = resolve(outputDirectory);
  const root = resolve(repositoryRoot);
  const canonical = resolve(root, "apps/minigame/visual-preview/evidence");
  const [rootReal, outputReal, canonicalReal] = await Promise.all([
    resolveRealCandidate(root),
    resolveRealCandidate(output),
    resolveRealCandidate(canonical),
  ]);
  const canonicalTarget = samePath(output, canonical) && samePath(outputReal, canonicalReal);
  const insideRepository = isWithin(root, output) || isWithin(rootReal, outputReal);
  if (insideRepository && !canonicalTarget) {
    throw new Error(`EVIDENCE_OUTPUT_INSIDE_REPOSITORY_FORBIDDEN:${output}`);
  }
  if (output === root || output === resolve(root, "apps/minigame") || output === resolve(root, "apps/minigame/visual-preview")) {
    throw new Error(`EVIDENCE_OUTPUT_UNSAFE:${output}`);
  }
  if (!await pathExists(output)) return output;
  const metadata = await lstat(output);
  if (metadata.isSymbolicLink()) throw new Error(`EVIDENCE_OUTPUT_SYMBOLIC_LINK_FORBIDDEN:${output}`);
  if (!metadata.isDirectory()) throw new Error(`EVIDENCE_OUTPUT_NOT_DIRECTORY:${output}`);
  if ((await readdir(output)).length !== 0) throw new Error(`EVIDENCE_OUTPUT_NOT_EMPTY:${output}`);
  return output;
}

function resolveOutputDirectory(outputDirectory, repositoryRoot) {
  return isAbsolute(outputDirectory)
    ? resolve(outputDirectory)
    : resolve(repositoryRoot, outputDirectory);
}

export async function publishEvidenceBatch({ stagingDirectory, outputDirectory, verify }) {
  if (typeof verify !== "function") throw new Error("EVIDENCE_STRICT_VERIFIER_REQUIRED");
  const staging = resolve(stagingDirectory);
  const output = resolve(outputDirectory);
  await verify(staging);
  const outputExisted = await pathExists(output);
  if (outputExisted) {
    const metadata = await lstat(output);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || (await readdir(output)).length !== 0) {
      throw new Error(`EVIDENCE_OUTPUT_NOT_EMPTY:${output}`);
    }
    // `rmdir` is intentionally non-recursive: if another process creates a
    // file after the emptiness check, publication fails closed without deleting it.
    await rmdir(output);
  }
  let moved = false;
  try {
    await rename(staging, output);
    moved = true;
    await verify(output);
  } catch (error) {
    if (moved && await pathExists(output)) await rename(output, staging);
    if (outputExisted && !await pathExists(output)) await mkdir(output, { recursive: true });
    throw error;
  }
}

export function cropRgbaImage(image, crop) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new Error("EVIDENCE_CROP_SOURCE_INVALID");
  }
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isInteger(crop?.[key]) || crop[key] < 0) throw new Error(`EVIDENCE_CROP_RECT_INVALID:${key}`);
  }
  if (
    crop.width <= 0
    || crop.height <= 0
    || crop.x + crop.width > image.width
    || crop.y + crop.height > image.height
  ) throw new Error("EVIDENCE_CROP_RECT_OUT_OF_BOUNDS");
  const source = Buffer.from(image.rgba);
  if (source.length !== image.width * image.height * 4) throw new Error("EVIDENCE_CROP_RGBA_LENGTH_INVALID");
  const rgba = Buffer.alloc(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y += 1) {
    const sourceStart = ((crop.y + y) * image.width + crop.x) * 4;
    const targetStart = y * crop.width * 4;
    source.copy(rgba, targetStart, sourceStart, sourceStart + crop.width * 4);
  }
  return { width: crop.width, height: crop.height, rgba };
}

export function encodeRgbaPng(image) {
  const { width, height } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("EVIDENCE_PNG_ENCODE_DIMENSIONS_INVALID");
  }
  const rgba = Buffer.from(image.rgba);
  if (rgba.length !== width * height * 4) throw new Error("EVIDENCE_PNG_ENCODE_RGBA_LENGTH_INVALID");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    scanlines[row] = 0;
    rgba.copy(scanlines, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const decoded = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const target = resolve(root, `.${decoded}`);
      if (!isWithin(root, target)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const metadata = await stat(target);
      if (!metadata.isFile()) throw new Error("NOT_FILE");
      const bytes = await readFile(target);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": bytes.length,
        "Content-Type": mimeType(target),
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("EVIDENCE_SERVER_ADDRESS_INVALID");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}

function mimeType(file) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".wav": "audio/wav",
  })[extname(file).toLowerCase()] ?? "application/octet-stream";
}

async function resolveChromeExecutable(explicitPath) {
  const candidates = [explicitPath, process.env.CHROME_PATH, ...defaultChromeCandidates()].filter(Boolean);
  for (const candidate of candidates) {
    const path = resolve(String(candidate));
    try {
      await access(path);
      if ((await stat(path)).isFile()) return path;
    } catch {
      // Try the next supported Chrome/Chromium location.
    }
  }
  throw new Error(`EVIDENCE_CHROME_NOT_FOUND:${candidates.join("|")}`);
}

function defaultChromeCandidates() {
  if (platform() === "win32") {
    return [
      process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].filter(Boolean);
  }
  if (platform() === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

async function launchBrowser(chrome, timeoutMs) {
  if (typeof WebSocket !== "function" || typeof fetch !== "function") {
    throw new Error("EVIDENCE_NODE_WEB_PLATFORM_UNAVAILABLE:Node.js with global fetch and WebSocket is required");
  }
  const debugPort = await unusedPort();
  const profile = await mkdtemp(resolve(tmpdir(), "ek-evidence-chrome-"));
  const child = spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--lang=zh-CN",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let spawnError;
  child.once("error", (error) => { spawnError = error; });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
  try {
    const targets = await pollJson(
      `http://127.0.0.1:${debugPort}/json/list`,
      timeoutMs,
      child,
      () => spawnError,
    );
    const page = targets.find((target) => target.type === "page");
    if (!page?.webSocketDebuggerUrl) throw new Error("EVIDENCE_CHROME_PAGE_TARGET_MISSING");
    const cdp = await CdpClient.connect(page.webSocketDebuggerUrl, timeoutMs);
    await cdp.call("Page.enable", {}, timeoutMs);
    await cdp.call("Runtime.enable", {}, timeoutMs);
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: 389,
      height: 584,
      deviceScaleFactor: 1,
      mobile: false,
    }, timeoutMs);
    return new BrowserSession(cdp, child, profile, stderr, timeoutMs);
  } catch (error) {
    if (child.exitCode === null) child.kill();
    await waitForExit(child, 3000);
    await rm(profile, { recursive: true, force: true });
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  }
}

class BrowserSession {
  constructor(cdp, child, profile, stderr, timeoutMs) {
    this.cdp = cdp;
    this.child = child;
    this.profile = profile;
    this.stderr = stderr;
    this.timeoutMs = timeoutMs;
  }

  async navigate(url, timeoutMs = this.timeoutMs) {
    await this.cdp.call("Page.navigate", { url }, timeoutMs);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const available = await this.evaluate(
          "Boolean(window.__VISUAL_PREVIEW_CAPTURE__ && window.__VISUAL_PREVIEW_CAPTURE__.plan)",
          { awaitPromise: false, timeoutMs: Math.min(2000, timeoutMs) },
        );
        if (available) return;
      } catch {
        // Navigation can destroy the prior execution context; retry the new one.
      }
      await delay(25);
    }
    throw new Error(`EVIDENCE_PREVIEW_NAVIGATION_TIMEOUT:${url}`);
  }

  async evaluate(expression, { awaitPromise = true, timeoutMs = this.timeoutMs } = {}) {
    const response = await this.cdp.call("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: false,
    }, timeoutMs);
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description
        ?? response.exceptionDetails.text
        ?? "Runtime.evaluate failed";
      throw new Error(`EVIDENCE_CDP_EVALUATION_FAILED:${detail}`);
    }
    if (response.result?.subtype === "error") {
      throw new Error(`EVIDENCE_CDP_EVALUATION_FAILED:${response.result.description ?? "unknown"}`);
    }
    return response.result?.value;
  }

  async close() {
    try { await this.cdp.call("Browser.close", {}, 2000); } catch { /* Kill below. */ }
    let exited = await waitForExit(this.child, 3000);
    if (!exited && this.child.exitCode === null) {
      this.child.kill();
      exited = await waitForExit(this.child, 3000);
    }
    this.cdp.close();
    if (!exited) throw new Error("EVIDENCE_CHROME_SHUTDOWN_TIMEOUT");
    await rm(this.profile, { recursive: true, force: true });
  }
}

class CdpClient {
  static async connect(url, timeoutMs) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error("EVIDENCE_CDP_CONNECT_TIMEOUT")), timeoutMs);
      socket.addEventListener("open", () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("EVIDENCE_CDP_CONNECT_FAILED")); }, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => this.onMessage(event.data));
    socket.addEventListener("close", () => this.rejectAll(new Error("EVIDENCE_CDP_CLOSED")));
    socket.addEventListener("error", () => this.rejectAll(new Error("EVIDENCE_CDP_SOCKET_ERROR")));
  }

  call(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = ++this.sequence;
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`EVIDENCE_CDP_CALL_TIMEOUT:${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolveCall, rejectCall, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onMessage(data) {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.rejectCall(new Error(`EVIDENCE_CDP_ERROR:${pending.method}:${message.error.message}`));
    else pending.resolveCall(message.result ?? {});
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.rejectCall(error);
    }
    this.pending.clear();
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function pollJson(url, timeoutMs, child, spawnFailure = () => undefined) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const spawnError = spawnFailure();
    if (spawnError) throw new Error(`EVIDENCE_CHROME_SPAWN_FAILED:${spawnError.message}`);
    if (child.exitCode !== null) throw new Error(`EVIDENCE_CHROME_EXITED:${child.exitCode}`);
    const remaining = deadline - Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(1000, remaining));
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (response.ok) return await response.json();
    } catch {
      // Chrome has not opened its DevTools endpoint yet.
    } finally {
      clearTimeout(timer);
    }
    await delay(30);
  }
  throw new Error("EVIDENCE_CHROME_DEBUG_ENDPOINT_TIMEOUT");
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("EVIDENCE_PORT_INVALID");
  const port = address.port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once("exit", onExit);
    if (child.exitCode !== null) {
      child.removeListener("exit", onExit);
      clearTimeout(timer);
      resolveExit(true);
    }
  });
}

async function resolveRealCandidate(path) {
  const absolute = resolve(path);
  let cursor = absolute;
  const missing = [];
  while (!await pathExists(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`EVIDENCE_OUTPUT_REALPATH_UNAVAILABLE:${absolute}`);
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(await realpath(cursor), ...missing);
}

function samePath(left, right) {
  return relative(resolve(left), resolve(right)) === "";
}

function isWithin(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function pathExists(path) {
  try { await stat(path); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function usage() {
  return [
    "Usage:",
    "  node apps/minigame/visual-preview/capture-evidence.mjs --output-dir <empty-directory> [options]",
    "",
    "Options:",
    "  --chrome <path>       Chrome/Chromium executable (or set CHROME_PATH)",
    "  --timeout-ms <number> Per-navigation/CDP timeout (default 45000)",
    "  --keep-failed         Preserve the failed staging directory for diagnosis",
    "  --help                Show this help",
    "",
    "Relative --output-dir paths resolve from the repository root. Inside the repository,",
    "only apps/minigame/visual-preview/evidence is accepted and it must be empty.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (argument === "--keep-failed") { options.keepFailed = true; continue; }
    if (["--output-dir", "--chrome", "--timeout-ms"].includes(argument)) {
      const value = argv[++index];
      if (!value) throw new Error(`EVIDENCE_ARGUMENT_VALUE_REQUIRED:${argument}`);
      if (argument === "--output-dir") options.outputDirectory = value;
      else if (argument === "--chrome") options.chromePath = value;
      else options.timeoutMs = Number(value);
      continue;
    }
    throw new Error(`EVIDENCE_ARGUMENT_UNKNOWN:${argument}`);
  }
  if (!options.outputDirectory) throw new Error("EVIDENCE_OUTPUT_DIRECTORY_REQUIRED");
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 5000)) {
    throw new Error("EVIDENCE_TIMEOUT_INVALID");
  }
  return options;
}

const mainArgument = process.argv?.[1];
const isMain = mainArgument && pathToFileURL(resolve(mainArgument)).href === import.meta.url;
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(usage());
    else await captureEvidenceBatch(options);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
