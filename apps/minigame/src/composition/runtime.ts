import { matchSnapshotCodec, parseServerEnvelope, type ClientEnvelope, type ServerEnvelope } from "@exploding-kitty/protocol";
import type { GameSession, RawProductView } from "../ui/model";
import { DemoGameSession } from "../session/demoSession";
import { WxAuthAdapter, WxSessionRepository, WxSocketTransport, createJsonCodec, toWebSocketUrl } from "../platform";
import type { WxLike } from "../platform";

export type RuntimeConfig = Readonly<{ apiBaseUrl?: string; forceDemo?: boolean; allowDevAuth?: boolean; joinCode?: string }>;

type SharedSessionModule = Record<string, unknown>;

export const miniGameServerCodec = createJsonCodec<ClientEnvelope, ServerEnvelope<RawProductView>>(
  (input) => parseServerEnvelope(input, matchSnapshotCodec),
);

function developmentRuntime(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production";
}

export function readRuntimeConfig(wx: WxLike): RuntimeConfig {
  const query = wx.getLaunchOptionsSync?.().query ?? {};
  const configured = typeof process !== "undefined" ? process.env.MINIGAME_API_BASE_URL : undefined;
  // Share/deep-link query data is untrusted. Runtime endpoint overrides and development auth
  // are useful in the developer tools, but must never redirect or downgrade a production build.
  const allowDebugQuery = developmentRuntime();
  const apiBaseUrl = allowDebugQuery && query.server ? decodeURIComponent(query.server) : configured || undefined;
  return {
    apiBaseUrl,
    forceDemo: allowDebugQuery && query.demo === "1",
    allowDevAuth: allowDebugQuery && query.dev === "1",
    ...(query.room && /^\d{6}$/.test(query.room) ? { joinCode: query.room } : {}),
  };
}

export async function createGameSession(wx: WxLike, config: RuntimeConfig, shared?: SharedSessionModule): Promise<GameSession<RawProductView>> {
  if (config.forceDemo) return new DemoGameSession();
  if (!config.apiBaseUrl) throw new Error("MINIGAME_API_BASE_URL_REQUIRED");
  if (!shared) throw new Error("SESSION_CLIENT_UNAVAILABLE");
  const auth = new WxAuthAdapter(wx, config.apiBaseUrl);
  let identity;
  try { identity = await auth.signIn(); } catch (error) {
    if (!config.allowDevAuth) throw error;
    identity = await auth.signInForDevelopment();
  }
  const repository = new WxSessionRepository(wx);
  const sessionId = `wx-${identity.playerId}`;
  const transport = new WxSocketTransport(
    wx,
    toWebSocketUrl(config.apiBaseUrl),
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
