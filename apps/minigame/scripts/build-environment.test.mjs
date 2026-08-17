import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadModeEnvironment, resolveMiniGameBuildConfig } from "./build-environment.mjs";

test("preview loads mode-specific env files and lets the shell override them", async () => {
  const root = await mkdtemp(join(tmpdir(), "exploding-kitty-env-"));
  try {
    await writeFile(join(root, ".env"), "MINIGAME_CLOUD_ENV_ID=base-env\n");
    await writeFile(join(root, ".env.preview"), "MINIGAME_CLOUD_ENV_ID=prod-d0g8qcwrb047789af\nMINIGAME_CLOUD_SERVICE_NAME=stale-service\n");
    const loaded = await loadModeEnvironment(root, "preview", {
      MINIGAME_CLOUD_SERVICE_NAME: "exploding-kitty-api",
    });
    assert.deepEqual(loaded.loadedFiles, [".env", ".env.preview"]);
    assert.equal(loaded.environment.MINIGAME_CLOUD_ENV_ID, "prod-d0g8qcwrb047789af");
    assert.equal(loaded.environment.MINIGAME_CLOUD_SERVICE_NAME, "exploding-kitty-api");
    assert.deepEqual(resolveMiniGameBuildConfig("preview", loaded.environment), {
      mode: "preview",
      nodeEnvironment: "production",
      apiBaseUrl: "",
      cloudEnvironmentId: "prod-d0g8qcwrb047789af",
      cloudServiceName: "exploding-kitty-api",
      authEndpoint: {
        kind: "cloudContainer",
        environmentId: "prod-d0g8qcwrb047789af",
        serviceName: "exploding-kitty-api",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview requires Cloud Run and ignores a direct public endpoint", () => {
  assert.throws(
    () => resolveMiniGameBuildConfig("preview", { MINIGAME_API_BASE_URL: "https://stale.example" }),
    /MINIGAME_CLOUD_ENV_ID_REQUIRED_FOR_PREVIEW_BUILD/,
  );
});

test("preview rejects a missing service name or a different Cloud Run target", () => {
  assert.throws(
    () => resolveMiniGameBuildConfig("preview", {
      MINIGAME_CLOUD_ENV_ID: "prod-d0g8qcwrb047789af",
    }),
    /MINIGAME_CLOUD_SERVICE_NAME_REQUIRED_FOR_PREVIEW_BUILD/,
  );
  assert.throws(
    () => resolveMiniGameBuildConfig("preview", {
      MINIGAME_CLOUD_ENV_ID: "other-env",
      MINIGAME_CLOUD_SERVICE_NAME: "exploding-kitty-api",
    }),
    /MINIGAME_CLOUD_TARGET_MISMATCH:other-env\/exploding-kitty-api/,
  );
  assert.throws(
    () => resolveMiniGameBuildConfig("preview", {
      MINIGAME_CLOUD_ENV_ID: "prod-d0g8qcwrb047789af",
      MINIGAME_CLOUD_SERVICE_NAME: "other-service",
    }),
    /MINIGAME_CLOUD_TARGET_MISMATCH:prod-d0g8qcwrb047789af\/other-service/,
  );
});

test("production requires Cloud Run and ignores a direct public endpoint", () => {
  assert.throws(
    () => resolveMiniGameBuildConfig("production", { MINIGAME_API_BASE_URL: "https://stale.example" }),
    /MINIGAME_CLOUD_ENV_ID_REQUIRED_FOR_PRODUCTION_BUILD/,
  );
  assert.deepEqual(resolveMiniGameBuildConfig("production", {
    MINIGAME_API_BASE_URL: "https://stale.example",
    MINIGAME_CLOUD_ENV_ID: "prod-d0g8qcwrb047789af",
    MINIGAME_CLOUD_SERVICE_NAME: "exploding-kitty-api",
  }).authEndpoint, {
    kind: "cloudContainer",
    environmentId: "prod-d0g8qcwrb047789af",
    serviceName: "exploding-kitty-api",
  });
});

test("development may use a direct endpoint and keeps debug runtime semantics", () => {
  assert.deepEqual(resolveMiniGameBuildConfig("development", {
    MINIGAME_API_BASE_URL: "http://127.0.0.1:3000",
  }), {
    mode: "development",
    nodeEnvironment: "development",
    apiBaseUrl: "http://127.0.0.1:3000",
    cloudEnvironmentId: "",
    cloudServiceName: "exploding-kitty-api",
    authEndpoint: {
      kind: "direct",
      apiBaseUrl: "http://127.0.0.1:3000",
    },
  });
});
