import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  stdin: {
    contents: 'import Layout from "./src/ui/layoutEngine"; globalThis.__layoutEngine = Layout;',
    resolveDir: root,
    sourcefile: "layout-engine-smoke.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  minify: true,
  write: false,
  banner: { js: "var GameGlobal = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;" },
  logLevel: "silent",
});
const touch = {
  getSystemInfoSync: () => ({ devicePixelRatio: 1 }),
  offTouchStart: () => undefined,
  offTouchMove: () => undefined,
  offTouchEnd: () => undefined,
  offTouchCancel: () => undefined,
};
const sandbox = { console, window: { devicePixelRatio: 1 }, wx: touch };
runInNewContext(result.outputFiles[0].text, sandbox);

const layout = sandbox.__layoutEngine;
if (typeof layout?.clear !== "function" || typeof layout?.clearAll !== "function") {
  throw new Error("MINIGAME_BUNDLE_LAYOUT_EXPORT_INVALID");
}
layout.clearAll();

const releaseSource = await readFile(resolve(root, "release/game.js"), "utf8");
if (!releaseSource.includes("LAYOUT_ENGINE_EXPORT_INVALID")) {
  throw new Error("MINIGAME_BUNDLE_LAYOUT_ADAPTER_MISSING");
}
if (!releaseSource.includes("__explodingKittyTouchBubbling")) {
  throw new Error("MINIGAME_BUNDLE_TOUCH_BUBBLING_MISSING");
}
console.log("MINIGAME_BUNDLE_SMOKE_OK");
