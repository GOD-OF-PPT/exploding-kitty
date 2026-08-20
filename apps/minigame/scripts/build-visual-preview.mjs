import { build } from "esbuild";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const minigameRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(minigameRoot, "../..");
const previewRoot = resolve(minigameRoot, "visual-preview");
const outputRoot = resolve(previewRoot, "dist");
const assetSource = resolve(minigameRoot, "assets");
const assetOutput = resolve(outputRoot, "assets");
const referenceSource = resolve(repositoryRoot, "prototype/audit/current/after");
const referenceOutput = resolve(outputRoot, "references");

const referenceByScreen = Object.freeze({
  login: "login",
  home: "home",
  "play-mode": "play-mode",
  create: "create",
  join: "join",
  "lobby-host": "lobby",
  "lobby-member": "lobby-member",
  game: "game",
  "other-turn": "other-turn",
  attack: "attack",
  response: "response",
  favor: "favor",
  "give-card": "give-card",
  future: "future",
  explosion: "explosion",
  defuse: "defuse",
  eliminated: "eliminated",
  result: "result",
  tutorial: "tutorial",
  rules: "rules",
  "card-detail": "card-detail",
  history: "history",
  "game-menu": "game-menu",
  network: "network",
  settings: "settings",
});

const referenceFiles = Object.values(referenceByScreen).map(
  (name) => `implementation-${name}-390x844-final.png`,
);

const previewEntryFile = "apps/minigame/visual-preview/src/main.ts";
const previewBundleFile = "apps/minigame/visual-preview/dist/main.js";

export function createPreviewBundleBuildOptions({
  repositoryRoot: buildRoot = repositoryRoot,
  write = true,
  metafile = false,
  logLevel = "silent",
} = {}) {
  return {
    absWorkingDir: buildRoot,
    entryPoints: [previewEntryFile],
    outfile: previewBundleFile,
    bundle: true,
    write,
    metafile,
    platform: "browser",
    format: "iife",
    target: "es2020",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel,
  };
}

// Export the operation, rather than only the options, so verifier-side
// rebuilds use the exact esbuild resolved beside this script.
export function buildPreviewBrowserBundle(options = {}) {
  return build(createPreviewBundleBuildOptions(options));
}

export async function buildVisualPreview() {
  if (Object.keys(referenceByScreen).length !== 25 || new Set(referenceFiles).size !== 25) {
    throw new Error("VISUAL_PREVIEW_REFERENCE_MAP_INVALID");
  }

  // Keep generated output disposable and prevent stale bundles, assets, or
  // references from being mistaken for current visual evidence.
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const entryPoint = resolve(previewRoot, "src/main.ts");
  const htmlSource = resolve(previewRoot, "index.html");
  const stylesSource = resolve(previewRoot, "styles.css");
  const requiredInputs = [entryPoint, htmlSource, stylesSource, assetSource, referenceSource];
  await Promise.all(requiredInputs.map((path) => requirePath(path, "VISUAL_PREVIEW_INPUT_MISSING")));
  await Promise.all(referenceFiles.map(
    (file) => requireNonEmptyFile(resolve(referenceSource, file), "VISUAL_PREVIEW_REFERENCE_MISSING"),
  ));

  await buildPreviewBrowserBundle({ repositoryRoot, write: true, metafile: false, logLevel: "info" });

  await Promise.all([
    cp(htmlSource, resolve(outputRoot, "index.html")),
    cp(stylesSource, resolve(outputRoot, "styles.css")),
    cp(assetSource, assetOutput, { recursive: true }),
    mkdir(referenceOutput, { recursive: true }).then(() => Promise.all(
      referenceFiles.map((file) => cp(resolve(referenceSource, file), resolve(referenceOutput, file))),
    )),
  ]);

  const requiredOutputs = [
    resolve(outputRoot, "main.js"),
    resolve(outputRoot, "index.html"),
    resolve(outputRoot, "styles.css"),
    ...referenceFiles.map((file) => resolve(referenceOutput, file)),
  ];
  await Promise.all(requiredOutputs.map((path) => requireNonEmptyFile(path, "VISUAL_PREVIEW_OUTPUT_INVALID")));

  const sourceAssets = await inventory(assetSource);
  const outputAssets = await inventory(assetOutput);
  assertSameInventory(sourceAssets, outputAssets, "VISUAL_PREVIEW_ASSET_COPY_INCOMPLETE");

  const copiedReferences = (await readdir(referenceOutput, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const expectedReferences = [...referenceFiles].sort();
  if (JSON.stringify(copiedReferences) !== JSON.stringify(expectedReferences)) {
    throw new Error("VISUAL_PREVIEW_REFERENCE_COPY_INCOMPLETE");
  }

  console.log(
    `Visual preview built at ${relative(repositoryRoot, outputRoot)}: `
    + `1 browser bundle, ${sourceAssets.size} assets, ${copiedReferences.length} references.`,
  );
}

const scriptArgument = process.argv?.[1];
const invokedAsScript = scriptArgument
  ? pathToFileURL(resolve(scriptArgument)).href === import.meta.url
  : false;
if (invokedAsScript) await buildVisualPreview();

async function requirePath(path, code) {
  try {
    await stat(path);
  } catch {
    throw new Error(`${code}:${relative(repositoryRoot, path)}`);
  }
}

async function requireNonEmptyFile(path, code) {
  try {
    const metadata = await stat(path);
    if (metadata.isFile() && metadata.size > 0) return;
  } catch {
    // The normalized build error below includes the repository-relative path.
  }
  throw new Error(`${code}:${relative(repositoryRoot, path)}`);
}

async function inventory(root) {
  const files = new Map();
  await walk(root, "", files);
  return files;
}

async function walk(root, directory, files) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, path, files);
      return;
    }
    if (!entry.isFile()) return;
    files.set(path.replaceAll("\\", "/"), (await stat(resolve(root, path))).size);
  }));
}

function assertSameInventory(expected, actual, code) {
  if (expected.size !== actual.size) throw new Error(code);
  for (const [path, bytes] of expected) {
    if (actual.get(path) !== bytes) throw new Error(`${code}:${path}`);
  }
}
