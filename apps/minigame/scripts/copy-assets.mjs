import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "assets.manifest.json"), "utf8"));
const source = resolve(root, manifest.source);
const output = resolve(root, manifest.output);

await rm(output, { recursive: true, force: true });
for (const file of manifest.files) {
  const target = resolve(output, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(source, file), target);
}

console.log(`Copied ${manifest.files.length} optimized mini-game assets.`);
