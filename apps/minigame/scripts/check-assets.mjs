import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectProductionDisplayFontStrings } from "./display-font-coverage.mjs";
import { collectRequiredDisplayCodePoints, formatCodePoint, readTtfUnicodeCmap } from "./font-cmap.mjs";
import { validateAssetIntegrity } from "./asset-integrity.mjs";
import { inspectRaster, validateRasterContract } from "./asset-quality.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "assets.manifest.json"), "utf8"));
const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".wav", ".ttf", ".txt"]);
const positiveBudget = (name) => {
  const value = manifest.budgets?.[name];
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid positive asset budget: ${name}.`);
  return value;
};
const developmentBytes = positiveBudget("developmentBytes");
const releaseTargetBytes = positiveBudget("releaseTargetBytes");
const largestFileTargetBytes = positiveBudget("largestFileTargetBytes");
const mainPackageBytes = positiveBudget("mainPackageBytes");
const minimumHeadroomRatio = manifest.budgets?.minimumHeadroomRatio;
if (!Number.isFinite(minimumHeadroomRatio) || minimumHeadroomRatio <= 0 || minimumHeadroomRatio >= 1) {
  throw new Error("minimumHeadroomRatio must be greater than 0 and less than 1.");
}
let total = 0;
let largest = { file: "", bytes: 0 };
const rasterInspections = new Map();
const sourceAssetBytes = new Map();
const ttfFiles = manifest.files.filter((file) => file.toLowerCase().endsWith(".ttf"));
if (ttfFiles.length !== 1) throw new Error(`Expected exactly one display TTF, found ${ttfFiles.length}.`);
for (const file of manifest.files) {
  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error(`Unsupported release asset type: ${file}.`);
  const sourcePath = resolve(root, manifest.source, file);
  const releasePath = resolve(root, manifest.output, file);
  const [{ size }, sourceBytes, releaseBytes] = await Promise.all([
    stat(releasePath),
    readFile(sourcePath),
    readFile(releasePath),
  ]);
  const expectedHash = manifest.sha256?.[file];
  const isRaster = [".png", ".jpg", ".jpeg", ".webp"].includes(extension);
  validateAssetIntegrity(file, expectedHash, sourceBytes, releaseBytes);
  sourceAssetBytes.set(file, sourceBytes);
  if (isRaster) rasterInspections.set(file, inspectRaster(sourceBytes, file));
  total += size;
  if (size > largest.bytes) largest = { file, bytes: size };
}
validateRasterContract(manifest, rasterInspections);
const displayFont = sourceAssetBytes.get(ttfFiles[0]);
const displayFontStrings = await collectProductionDisplayFontStrings(root);
const requiredDisplayCodePoints = collectRequiredDisplayCodePoints(displayFontStrings);
const displayFontCodePoints = readTtfUnicodeCmap(displayFont);
const missingDisplayCodePoints = [...requiredDisplayCodePoints]
  .filter((codePoint) => !displayFontCodePoints.has(codePoint))
  .sort((left, right) => left - right);
if (missingDisplayCodePoints.length > 0) {
  const missing = missingDisplayCodePoints.map(formatCodePoint).join(", ");
  throw new Error(`Display TTF cmap is missing ${missingDisplayCodePoints.length} of ${requiredDisplayCodePoints.size} required UI characters: ${missing}.`);
}
if (total > developmentBytes) {
  throw new Error(`Asset bundle ${total} exceeds development budget ${developmentBytes}.`);
}
if (total > releaseTargetBytes) {
  throw new Error(`Asset bundle ${total} exceeds release target ${releaseTargetBytes}.`);
}
if (largest.bytes > largestFileTargetBytes) {
  throw new Error(`Largest asset ${largest.file} (${largest.bytes}) exceeds target ${largestFileTargetBytes}.`);
}

async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
  }
  return bytes;
}

const releaseBytes = await directoryBytes(resolve(root, "release"));
const releaseLimit = Math.floor(mainPackageBytes * (1 - minimumHeadroomRatio));
if (releaseBytes > releaseLimit) {
  throw new Error(`Release package ${releaseBytes} exceeds ${releaseLimit}; at least ${minimumHeadroomRatio * 100}% headroom is required.`);
}
console.log(`Assets: ${total} bytes; release: ${releaseBytes} bytes (limit ${releaseLimit}); largest ${largest.file}: ${largest.bytes} bytes; raster contract: ${rasterInspections.size} checked; display TTF cmap: ${requiredDisplayCodePoints.size} required characters, 0 missing.`);
