import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const previewRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(previewRoot, "../../..");
const manifest = JSON.parse(await readFile(resolve(previewRoot, "evidence/manifest.json"), "utf8"));

assert(manifest.schemaVersion === 1, "EVIDENCE_SCHEMA_UNSUPPORTED");
assert(manifest.counts.current === 41, "EVIDENCE_CURRENT_COUNT_INVALID");
assert(manifest.counts.comparisons === 25, "EVIDENCE_COMPARISON_COUNT_INVALID");
assert(manifest.counts.references === 25, "EVIDENCE_REFERENCE_COUNT_INVALID");

const currentByViewport = new Map();
for (const entry of manifest.current) {
  const path = manifest.pathTemplates.current
    .replace("<screen>", entry.screen)
    .replace("<viewport>", entry.viewport);
  const bytes = await verifiedBytes(path, entry.sha256);
  const dimensions = pngDimensions(bytes, path);
  const [width, height] = entry.viewport.split("x").map(Number);
  assert(dimensions.width === width && dimensions.height === height, `EVIDENCE_DIMENSIONS_INVALID:${path}`);
  currentByViewport.set(entry.viewport, (currentByViewport.get(entry.viewport) ?? 0) + 1);
}

assert(currentByViewport.get("390x844") === 25, "EVIDENCE_390_MATRIX_INCOMPLETE");
assert(currentByViewport.get("372x749") === 8, "EVIDENCE_372_MATRIX_INCOMPLETE");
assert(currentByViewport.get("389x584") === 8, "EVIDENCE_389_MATRIX_INCOMPLETE");

for (const entry of manifest.comparisons) {
  const path = manifest.pathTemplates.comparisons.replace("<screen>", entry.screen);
  const bytes = await verifiedBytes(path, entry.sha256);
  const dimensions = pngDimensions(bytes, path);
  assert(dimensions.width === 964 && dimensions.height === 964, `EVIDENCE_COMPARISON_DIMENSIONS_INVALID:${path}`);
}

for (const entry of manifest.references.items) {
  const referenceScreen = entry.screen === "lobby-host" ? "lobby" : entry.screen;
  const path = manifest.pathTemplates.references.replace("<reference-screen>", referenceScreen);
  const bytes = await verifiedBytes(path, entry.sha256);
  assert(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, `REFERENCE_FORMAT_CHANGED:${path}`);
}

console.log(
  `Visual evidence verified: ${manifest.counts.current} current PNGs, `
  + `${manifest.counts.comparisons} comparison PNGs, ${manifest.counts.references} references.`,
);

async function verifiedBytes(path, expectedHash) {
  const bytes = await readFile(resolve(repositoryRoot, path));
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  assert(actualHash === expectedHash, `EVIDENCE_HASH_MISMATCH:${path}`);
  return bytes;
}

function pngDimensions(bytes, path) {
  const signature = "89504e470d0a1a0a";
  assert(bytes.subarray(0, 8).toString("hex") === signature, `EVIDENCE_NOT_PNG:${path}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
