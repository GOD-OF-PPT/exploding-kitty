import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const BUILD_MODES = new Set(["development", "preview", "production"]);
export const DEPLOYED_CLOUD_ENVIRONMENT_ID = "prod-d0g8qcwrb047789af";
export const DEPLOYED_CLOUD_SERVICE_NAME = "exploding-kitty-api";

export async function loadModeEnvironment(root, mode, shellEnvironment = process.env) {
  if (!BUILD_MODES.has(mode)) throw new Error(`MINIGAME_BUILD_MODE_INVALID:${mode}`);
  const names = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
  const fileEnvironment = {};
  const loadedFiles = [];

  for (const name of names) {
    const path = resolve(root, name);
    try {
      Object.assign(fileEnvironment, parseEnv(await readFile(path, "utf8")));
      loadedFiles.push(name);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return {
    environment: { ...fileEnvironment, ...shellEnvironment },
    loadedFiles,
  };
}

export function resolveMiniGameBuildConfig(mode, environment) {
  if (!BUILD_MODES.has(mode)) throw new Error(`MINIGAME_BUILD_MODE_INVALID:${mode}`);
  const cloudEnvironmentId = environment.MINIGAME_CLOUD_ENV_ID?.trim() ?? "";
  const configuredCloudServiceName = environment.MINIGAME_CLOUD_SERVICE_NAME?.trim() ?? "";
  const cloudServiceName = configuredCloudServiceName || DEPLOYED_CLOUD_SERVICE_NAME;
  const apiBaseUrl = mode === "development" ? environment.MINIGAME_API_BASE_URL?.trim() ?? "" : "";

  if (mode !== "development" && !cloudEnvironmentId) {
    throw new Error(`MINIGAME_CLOUD_ENV_ID_REQUIRED_FOR_${mode.toUpperCase()}_BUILD`);
  }
  if (mode !== "development" && !configuredCloudServiceName) {
    throw new Error(`MINIGAME_CLOUD_SERVICE_NAME_REQUIRED_FOR_${mode.toUpperCase()}_BUILD`);
  }
  if (mode !== "development" && (
    cloudEnvironmentId !== DEPLOYED_CLOUD_ENVIRONMENT_ID
    || cloudServiceName !== DEPLOYED_CLOUD_SERVICE_NAME
  )) {
    throw new Error(`MINIGAME_CLOUD_TARGET_MISMATCH:${cloudEnvironmentId}/${cloudServiceName}`);
  }

  const authEndpoint = cloudEnvironmentId
    ? { kind: "cloudContainer", environmentId: cloudEnvironmentId, serviceName: cloudServiceName }
    : apiBaseUrl ? { kind: "direct", apiBaseUrl } : null;

  return {
    mode,
    nodeEnvironment: mode === "development" ? "development" : "production",
    apiBaseUrl,
    cloudEnvironmentId,
    cloudServiceName,
    authEndpoint,
  };
}
