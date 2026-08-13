import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "assets.manifest.json"), "utf8"));
const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".wav"]);
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
for (const file of manifest.files) {
  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error(`Unsupported release asset type: ${file}.`);
  const { size } = await stat(resolve(root, manifest.output, file));
  total += size;
  if (size > largest.bytes) largest = { file, bytes: size };
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
console.log(`Assets: ${total} bytes; release: ${releaseBytes} bytes (limit ${releaseLimit}); largest ${largest.file}: ${largest.bytes} bytes.`);
