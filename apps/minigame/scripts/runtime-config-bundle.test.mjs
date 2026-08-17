import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the browser bundle reads its embedded Cloud Run target without a Node process global", async () => {
  const result = await build({
    stdin: {
      contents: `
        import { readRuntimeConfig } from "./src/composition/runtime";
        globalThis.__runtimeConfig = readRuntimeConfig({
          getLaunchOptionsSync: () => ({ query: {} }),
          getSystemInfoSync: () => ({ platform: "ios" }),
        });
      `,
      resolveDir: root,
      sourcefile: "runtime-config-device-smoke.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2020",
    write: false,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "process.env.MINIGAME_API_BASE_URL": JSON.stringify(""),
      "process.env.MINIGAME_CLOUD_ENV_ID": JSON.stringify("prod-device-env"),
      "process.env.MINIGAME_CLOUD_SERVICE_NAME": JSON.stringify("exploding-kitty-api"),
    },
    logLevel: "silent",
  });
  const sandbox = {};
  runInNewContext(result.outputFiles[0].text, sandbox);
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.__runtimeConfig)),
    {
      cloudEnvironmentId: "prod-device-env",
      cloudServiceName: "exploding-kitty-api",
      forceDemo: false,
      allowDevAuth: false,
    },
  );
});
