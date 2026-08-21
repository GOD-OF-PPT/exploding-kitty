import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectProductionDisplayFontStrings } from "./display-font-coverage.mjs";
import { collectRequiredDisplayCodePoints, readTtfUnicodeCmap } from "./font-cmap.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(root, "../..");
const sourceRelativePath = "@fontsource/zcool-kuaile/files/zcool-kuaile-chinese-simplified-400-normal.woff2";
const expectedSourceSha256 = "843e756c6f01753694d4f5a4e1a91ab295848131e0ce971580dd876d035713fd";
const source = await firstExisting([
  resolve(workspace, "node_modules", sourceRelativePath),
  resolve(workspace, "prototype/node_modules", sourceRelativePath),
]);
const destination = resolve(root, "assets/fonts/zcool-kuaile-minigame-subset.ttf");
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "exploding-kitty-display-font-"));
const temporaryFont = resolve(temporaryDirectory, "zcool-kuaile-minigame-subset.ttf");

try {
  const sourceBytes = await readFile(source);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceSha256 !== expectedSourceSha256) {
    throw new Error(`Untrusted ZCOOL source font: expected ${expectedSourceSha256}, received ${sourceSha256}.`);
  }
  const strings = await collectProductionDisplayFontStrings(root);
  const requiredCodePoints = collectRequiredDisplayCodePoints(strings);
  const unicodes = [...requiredCodePoints]
    .sort((left, right) => left - right)
    .map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`)
    .join(",");
  const subsetArguments = [
    source,
    `--output-file=${temporaryFont}`,
    `--unicodes=${unicodes}`,
    "--layout-features=*",
    "--glyph-names",
    "--symbol-cmap",
    "--legacy-cmap",
    "--notdef-glyph",
    "--notdef-outline",
    "--recommended-glyphs",
    "--name-IDs=*",
    "--name-legacy",
    "--name-languages=*",
  ];
  const subset = runSubset(subsetArguments);
  if (subset.error) throw subset.error;
  if (subset.status !== 0) {
    throw new Error(`pyftsubset failed (${subset.status}): ${subset.stderr || subset.stdout}`);
  }

  const bytes = await readFile(temporaryFont);
  const cmap = readTtfUnicodeCmap(bytes);
  const missing = [...requiredCodePoints].filter((codePoint) => !cmap.has(codePoint));
  if (missing.length > 0) throw new Error(`Generated display font is missing ${missing.length} required code points.`);
  await copyFile(temporaryFont, destination);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`Display TTF: ${bytes.length} bytes; ${requiredCodePoints.size} required characters; sha256 ${sha256}.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function runSubset(args) {
  const executable = spawnSync("pyftsubset", args, { encoding: "utf8", shell: false });
  if (!executable.error || executable.error.code !== "ENOENT") return executable;

  const pythonCommands = [
    process.env.PYFTSUBSET_PYTHON?.trim(),
    "python",
    "python3",
  ].filter(Boolean);
  for (const command of pythonCommands) {
    const result = spawnSync(command, ["-m", "fontTools.subset", ...args], { encoding: "utf8", shell: false });
    if (!result.error || result.error.code !== "ENOENT") return result;
  }
  return executable;
}

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      const metadata = await stat(path);
      if (metadata.isFile() && metadata.size > 0) return path;
    } catch {
      // Try the next npm workspace layout.
    }
  }
  throw new Error(`Locked ZCOOL source font is missing: ${sourceRelativePath}.`);
}
