import { build } from "esbuild";
import { resolve } from "node:path";

export async function collectProductionDisplayFontStrings(minigameRoot) {
  const result = await build({
    absWorkingDir: resolve(minigameRoot, "../.."),
    entryPoints: [resolve(minigameRoot, "visual-preview/src/displayFontCoverage.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  if (result.outputFiles.length !== 1) throw new Error("Display font coverage bundle is invalid.");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`;
  const coverage = await import(moduleUrl);
  const strings = coverage.collectDisplayFontStrings?.();
  if (!Array.isArray(strings) || strings.length === 0 || strings.some((value) => typeof value !== "string")) {
    throw new Error("Display font coverage collector returned no production strings.");
  }
  return strings;
}
