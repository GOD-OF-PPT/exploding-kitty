import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = resolve(root, "release");
const watch = process.argv.includes("--watch");
const apiBaseUrl = process.env.MINIGAME_API_BASE_URL ?? "";

await mkdir(release, { recursive: true });
if (!watch) {
  await rm(resolve(release, "game.js"), { force: true });
  await rm(resolve(release, "game.js.map"), { force: true });
}
await cp(resolve(root, "game.json"), resolve(release, "game.json"));

const options = {
  entryPoints: [resolve(root, "src/main.ts")],
  outfile: resolve(release, "game.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: watch,
  minify: !watch,
  define: {
    "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production"),
    "process.env.MINIGAME_API_BASE_URL": JSON.stringify(apiBaseUrl),
  },
  banner: { js: "var GameGlobal = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;" },
  logLevel: "info"
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching native mini-game client...");
} else {
  await build(options);
}
