import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModeEnvironment, resolveMiniGameBuildConfig } from "./build-environment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = resolve(root, "release");
const watch = process.argv.includes("--watch");
const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
const mode = modeArgument?.slice("--mode=".length) || (watch ? "development" : "production");
const { environment, loadedFiles } = await loadModeEnvironment(root, mode);
if (watch && mode !== "development") throw new Error("MINIGAME_WATCH_REQUIRES_DEVELOPMENT_MODE");

await mkdir(release, { recursive: true });
if (!watch) {
  await rm(resolve(release, "game.js"), { force: true });
  await rm(resolve(release, "game.js.map"), { force: true });
  await rm(resolve(release, "build-config.json"), { force: true });
}
const config = resolveMiniGameBuildConfig(mode, environment);
console.log(`Mini-game build mode: ${mode}; env files: ${loadedFiles.join(", ") || "none"}; auth: ${config.authEndpoint?.kind ?? "demo-only"}`);

await cp(resolve(root, "game.json"), resolve(release, "game.json"));
await writeFile(resolve(release, "build-config.json"), `${JSON.stringify({
  mode: config.mode,
  authEndpoint: config.authEndpoint,
}, null, 2)}\n`);

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
    "process.env.NODE_ENV": JSON.stringify(config.nodeEnvironment),
    "process.env.MINIGAME_API_BASE_URL": JSON.stringify(config.apiBaseUrl),
    "process.env.MINIGAME_CLOUD_ENV_ID": JSON.stringify(config.cloudEnvironmentId),
    "process.env.MINIGAME_CLOUD_SERVICE_NAME": JSON.stringify(config.cloudServiceName),
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
  const bundle = await readFile(resolve(release, "game.js"), "utf8");
  const expectedValues = config.authEndpoint?.kind === "cloudContainer"
    ? [config.authEndpoint.environmentId, config.authEndpoint.serviceName]
    : config.authEndpoint?.kind === "direct" ? [config.authEndpoint.apiBaseUrl] : [];
  for (const value of expectedValues) {
    if (!bundle.includes(value)) throw new Error(`MINIGAME_AUTH_CONFIG_NOT_EMBEDDED:${value}`);
  }
}
