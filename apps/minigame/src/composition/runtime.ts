import { matchSnapshotCodec, parseServerEnvelope, type ClientEnvelope, type ServerEnvelope } from "@exploding-kitty/protocol";
import type { GameSession, RawProductView } from "../ui/model";
import { DemoGameSession } from "../session/demoSession";
import {
  WxAuthAdapter,
  WxSessionRepository,
  WxSocketTransport,
  createJsonCodec,
  toWebSocketUrl,
  type AuthEndpoint,
  type WxSocketEndpoint,
} from "../platform";
import type { WxLike } from "../platform";

export type RuntimeConfig = Readonly<{
  /** Direct HTTP endpoint used for local/legacy deployments. */
  apiBaseUrl?: string;
  /** WeChat Cloud Run target used for private HTTP authentication and WebSocket sessions. */
  cloudEnvironmentId?: string;
  cloudServiceName?: string;
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
  const allowDebugQuery = developmentRuntime();
  const configuredApi = allowDebugQuery && typeof process !== "undefined"
    ? process.env.MINIGAME_API_BASE_URL || undefined
    : undefined;
  const configuredCloudEnvironment = typeof process !== "undefined" ? process.env.MINIGAME_CLOUD_ENV_ID || undefined : undefined;
  const configuredCloudService = typeof process !== "undefined" ? process.env.MINIGAME_CLOUD_SERVICE_NAME || undefined : undefined;
  // Share/deep-link query data is untrusted. Runtime endpoint overrides and development auth
  // are useful in the developer tools, but must never redirect or downgrade a production build.
  const debugServer = allowDebugQuery && query.server ? decodeURIComponent(query.server) : undefined;
  const apiBaseUrl = debugServer ?? configuredApi;
  const cloudEnvironmentId = debugServer ? undefined : configuredCloudEnvironment;
  const cloudServiceName = cloudEnvironmentId ? configuredCloudService ?? "exploding-kitty-api" : undefined;
  const remoteConfigured = Boolean(cloudEnvironmentId || apiBaseUrl);
  const developerToolsWithoutServer = !remoteConfigured && wx.getSystemInfoSync().platform?.toLowerCase() === "devtools";
  return {
    apiBaseUrl,
    cloudEnvironmentId,
    cloudServiceName,
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
  if (!shared) throw new Error("SESSION_CLIENT_UNAVAILABLE");
  const auth = new WxAuthAdapter(wx, authEndpoint);
  let identity;
  try { identity = await auth.signIn(); } catch (error) {
    if (!config.allowDevAuth) throw error;
    identity = await auth.signInForDevelopment();
  }
  const repository = new WxSessionRepository(wx);
  const sessionId = `wx-${identity.playerId}`;
  const socketEndpoint: WxSocketEndpoint = config.cloudEnvironmentId
    ? {
        kind: "cloudContainer",
        environmentId: config.cloudEnvironmentId,
        serviceName: config.cloudServiceName ?? "exploding-kitty-api",
        path: "/v1/session",
      }
    : {
        kind: "direct",
        url: toWebSocketUrl(config.apiBaseUrl ?? ""),
        header: { Authorization: `Bearer ${identity.token}` },
      };
  const transport = new WxSocketTransport(
    wx,
    socketEndpoint,
    miniGameServerCodec,
  );
  const options = { sessionId, transport, repository, initialResumeToken: identity.token };
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
