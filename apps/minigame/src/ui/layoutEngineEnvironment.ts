type SystemInfo = Record<string, unknown>;

type EngineEnvironment = Readonly<{
  getSystemInfoSync: () => unknown;
}>;

type EngineGameGlobal = Record<string, unknown> & {
  wx?: unknown;
};

const engineGlobal = typeof GameGlobal === "undefined"
  ? undefined
  : GameGlobal as EngineGameGlobal;
const originalEnvironment = engineGlobal?.wx;
let compatibleEnvironment: EngineEnvironment | undefined;

if (engineGlobal && isEngineEnvironment(originalEnvironment)) {
  compatibleEnvironment = Object.create(originalEnvironment) as EngineEnvironment;
  Object.defineProperty(compatibleEnvironment, "getSystemInfoSync", {
    configurable: false,
    enumerable: true,
    value: () => withCssCoordinateRatio(originalEnvironment.getSystemInfoSync.call(originalEnvironment)),
    writable: false,
  });
  engineGlobal.wx = compatibleEnvironment;
}

/**
 * `minigame-canvas-engine` reads `GameGlobal.wx` while its bundle is evaluated
 * and caches `devicePixelRatio` for ScrollView touches. We expose a temporary
 * environment whose ratio is 1 because both Layout's viewport and WeChat touch
 * events are already expressed in CSS coordinates. The real `pixelRatio` is
 * deliberately preserved for the Canvas renderer's backing-store scale.
 */
export function restoreLayoutEngineEnvironment(): void {
  if (engineGlobal && compatibleEnvironment && engineGlobal.wx === compatibleEnvironment) {
    engineGlobal.wx = originalEnvironment;
  }
}

function isEngineEnvironment(value: unknown): value is EngineEnvironment {
  return !!value
    && (typeof value === "object" || typeof value === "function")
    && typeof (value as { getSystemInfoSync?: unknown }).getSystemInfoSync === "function";
}

function withCssCoordinateRatio(value: unknown): SystemInfo {
  const systemInfo = value && typeof value === "object" ? value as SystemInfo : {};
  return { ...systemInfo, devicePixelRatio: 1 };
}
