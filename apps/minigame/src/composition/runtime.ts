import { matchSnapshotCodec, parseServerEnvelope, type ClientEnvelope, type ServerEnvelope } from "@exploding-kitty/protocol";
import type { GameSession, RawProductView } from "../ui/model";
import { DemoGameSession } from "../session/demoSession";
import { WxAuthAdapter, WxSessionRepository, WxSocketTransport, createJsonCodec, toWebSocketUrl, type AuthEndpoint } from "../platform";
import type { WxLike } from "../platform";

export type RuntimeConfig = Readonly<{
  /** Direct HTTP endpoint used for local/legacy deployments. */
  apiBaseUrl?: string;
  /** WeChat Cloud Run callContainer target used for HTTP authentication. */
  cloudEnvironmentId?: string;
  cloudServiceName?: string;
  /** Public HTTPS/WSS origin. connectContainer cannot carry the Bearer header. */
  websocketBaseUrl?: string;
  forceDemo?: boolean;
  allowDevAuth?: boolean;
  joinCode?: string;
}>;

type SharedSessionModule = Record<string, unknown>;

export const miniGameServerCodec = createJsonCodec<ClientEnvelope, ServerEnvelope<RawProductView>>(
  (input) => parseServerEnvelope(input, matchSnapshotCodec),
);

function developmentRuntime(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production";
}

export function readRuntimeConfig(wx: WxLike): RuntimeConfig {
  const query = wx.getLaunchOptionsSync?.().query ?? {};
  const configuredApi = typeof process !== "undefined" ? process.env.MINIGAME_API_BASE_URL || undefined : undefined;
  const configuredCloudEnvironment = typeof process !== "undefined" ? process.env.MINIGAME_CLOUD_ENV_ID || undefined : undefined;
  const configuredCloudService = typeof process !== "undefined" ? process.env.MINIGAME_CLOUD_SERVICE_NAME || undefined : undefined;
  const configuredWebsocket = typeof process !== "undefined" ? process.env.MINIGAME_WEBSOCKET_BASE_URL || undefined : undefined;
  // Share/deep-link query data is untrusted. Runtime endpoint overrides and development auth
  // are useful in the developer tools, but must never redirect or downgrade a production build.
  const allowDebugQuery = developmentRuntime();
  const debugServer = allowDebugQuery && query.server ? decodeURIComponent(query.server) : undefined;
  const apiBaseUrl = debugServer ?? configuredApi;
  const cloudEnvironmentId = debugServer ? undefined : configuredCloudEnvironment;
  const cloudServiceName = cloudEnvironmentId ? configuredCloudService ?? "exploding-kitty-api" : undefined;
  const websocketBaseUrl = debugServer ?? configuredWebsocket ?? configuredApi;
  const remoteConfigured = Boolean(websocketBaseUrl && (cloudEnvironmentId || apiBaseUrl));
  const developerToolsWithoutServer = !remoteConfigured && wx.getSystemInfoSync().platform?.toLowerCase() === "devtools";
  return {
    apiBaseUrl,
    cloudEnvironmentId,
    cloudServiceName,
    websocketBaseUrl,
    forceDemo: developerToolsWithoutServer || (allowDebugQuery && query.demo === "1"),
    allowDevAuth: allowDebugQuery && query.dev === "1",
    ...(query.room && /^\d{6}$/.test(query.room) ? { joinCode: query.room } : {}),
  };
}

export async function createGameSession(wx: WxLike, config: RuntimeConfig, shared?: SharedSessionModule): Promise<GameSession<RawProductView>> {
  if (config.forceDemo) return new DemoGameSession();
  const authEndpoint: AuthEndpoint | undefined = config.cloudEnvironmentId
    ? { kind: "cloudContainer", environmentId: config.cloudEnvironmentId, serviceName: config.cloudServiceName ?? "exploding-kitty-api" }
    : config.apiBaseUrl ? { kind: "direct", apiBaseUrl: config.apiBaseUrl } : undefined;
  if (!authEndpoint) throw new Error("MINIGAME_AUTH_ENDPOINT_REQUIRED");
  const websocketBaseUrl = config.websocketBaseUrl ?? config.apiBaseUrl;
  if (!websocketBaseUrl) throw new Error("MINIGAME_WEBSOCKET_BASE_URL_REQUIRED");
  if (!shared) throw new Error("SESSION_CLIENT_UNAVAILABLE");
  const auth = new WxAuthAdapter(wx, authEndpoint);
  let identity;
  try { identity = await auth.signIn(); } catch (error) {
    if (!config.allowDevAuth) throw error;
    identity = await auth.signInForDevelopment();
  }
  const repository = new WxSessionRepository(wx);
  const sessionId = `wx-${identity.playerId}`;
  const transport = new WxSocketTransport(
    wx,
    toWebSocketUrl(websocketBaseUrl),
    miniGameServerCodec,
    { Authorization: `Bearer ${identity.token}` },
  );
  const options = { sessionId, transport, repository };
  type RemoteOptions = typeof options;
  const createRemoteSession = shared.createRemoteSession as ((value: RemoteOptions) => Promise<GameSession<RawProductView>>) | undefined;
  const remoteClass = shared.RemoteGameSession as { open(value: RemoteOptions): Promise<GameSession<RawProductView>> } | undefined;
  const remote = createRemoteSession
    ? await createRemoteSession(options)
    : remoteClass ? await remoteClass.open(options) : null;
  if (remote) return {
    getSnapshot: remote.getSnapshot,
    subscribe: remote.subscribe,
    send: remote.send,
    reconnect: () => transport.reconnect(),
    dispose: remote.dispose,
  };
  throw new Error("SESSION_CLIENT_UNAVAILABLE");
}
