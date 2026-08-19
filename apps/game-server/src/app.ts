import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import websocket from "@fastify/websocket";
import { parseClientEnvelope, ProtocolDecodeError } from "@exploding-kitty/protocol";
import type { AuthService } from "./auth/authService.js";
import { ServiceError, toProblem } from "./errors.js";
import type { RoomCoordinator } from "./room/roomCoordinator.js";
import type { RawData } from "ws";
import type { GameStore } from "./persistence/store.js";
import type { ConnectionHub } from "./transport/connectionHub.js";
import { AuthRateLimiter } from "./transport/authRateLimiter.js";
import type { SessionGateway } from "./transport/sessionGateway.js";
import type { AuthContext } from "./model.js";

export type AppDependencies = Readonly<{
  auth: AuthService;
  rooms: RoomCoordinator;
  store: GameStore;
  gateway: SessionGateway;
  hub: ConnectionHub;
  devAuthEnabled: boolean;
  wechatTrustCloudHeaders: boolean;
  logger?: FastifyServerOptions["logger"];
  authRateLimiter?: AuthRateLimiter;
}>;

type AuthBody = { code?: string; developmentIdentity?: string; profile?: { displayName?: string; avatarUrl?: string } };

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.logger ?? false,
    bodyLimit: 16 * 1024,
    requestIdHeader: false,
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024, perMessageDeflate: false } });

  // Lightweight in-memory IP-based rate limit for auth endpoints.
  // >60 POST /v1/auth/* from the same IP in 60s returns 429.
  // Non-auth routes are unaffected.
  const authRateLimiter = dependencies.authRateLimiter ?? new AuthRateLimiter();
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST" || !request.url.startsWith("/v1/auth/")) return;
    if (authRateLimiter.tryAcquire(request.ip)) return;
    app.log.warn({ ip: request.ip, url: request.url }, "auth rate limit exceeded");
    return reply.code(429).send({ code: "RATE_LIMITED", message: "Too many auth requests", retryable: true });
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try { await dependencies.store.healthCheck(); return { status: "ready" }; }
    catch { return reply.code(503).send({ status: "unavailable" }); }
  });

  app.post<{ Body: AuthBody }>("/v1/auth/dev", async (request, reply) => {
    if (!dependencies.devAuthEnabled) return reply.code(404).send({ code: "NOT_FOUND" });
    return dependencies.auth.issueDevelopment(request.body?.developmentIdentity, request.body?.profile);
  });
  app.post<{ Body: AuthBody }>("/v1/auth/wechat", async (request, reply) => {
    try {
      if (dependencies.wechatTrustCloudHeaders) {
        return dependencies.auth.issueTrustedWechat(
          request.headers["x-wx-openid"],
          request.headers["x-wx-source"],
          request.body?.profile,
        );
      }
      return await dependencies.auth.issueWechat(request.body?.code ?? "", request.body?.profile);
    }
    catch (error) { return reply.code(401).send(toProblem(error)); }
  });

  app.get("/v1/session", { websocket: true }, (socket, request) => {
    let auth: AuthContext | undefined;
    let activeSessionId: string | undefined;
    let removeConnection: (() => void) | undefined;
    let authenticationTimer: ReturnType<typeof setTimeout> | undefined;
    let connectionTerminated = false;
    let messageQueue: Promise<void> = Promise.resolve();

    const bindConnection = (context: AuthContext, sessionId: string): void => {
      const removePreviousConnection = removeConnection;
      activeSessionId = sessionId;
      removeConnection = dependencies.hub.add({
        playerId: context.playerId,
        sessionId,
        send: (envelope) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(envelope)); },
        close: (code, reason) => {
          if (socket.readyState === socket.OPEN) {
            app.log.warn({ playerId: context.playerId, sessionId }, "connection cap: evicting oldest connection");
            socket.close(code ?? 1008, reason ?? "connection replaced");
          }
        },
      });
      // Register the replacement first so a bootstrap -> room/match rebind
      // never makes the player appear to have no live connection.
      removePreviousConnection?.();
    };
    const authenticateConnection = (context: AuthContext, sessionId: string): void => {
      auth = context;
      if (authenticationTimer) clearTimeout(authenticationTimer);
      authenticationTimer = undefined;
      bindConnection(context, sessionId);
      void dependencies.rooms.setConnected(context, true)
        .then((room) => { if (room) dependencies.gateway.broadcastPresence(room.id); });
    };

    if (dependencies.wechatTrustCloudHeaders) {
      authenticationTimer = setTimeout(() => {
        if (!auth && socket.readyState === socket.OPEN) {
          connectionTerminated = true;
          socket.close(1008, "authentication timeout");
        }
      }, 8_000);
    } else {
      try {
        const directAuth = dependencies.auth.authenticate(readBearer(request.headers.authorization));
        authenticateConnection(directAuth, `bootstrap_${directAuth.playerId}`);
      } catch { socket.close(1008, "unauthorized"); return; }
    }

    socket.on("message", (data: RawData, isBinary: boolean) => {
      messageQueue = messageQueue.then(() => handleMessage(data, isBinary)).catch(() => undefined);
    });
    const handleMessage = async (data: RawData, isBinary: boolean): Promise<void> => {
      try {
        if (connectionTerminated) return;
        if (isBinary) throw new ProtocolDecodeError("$", "UTF-8 JSON text");
        const envelope = parseClientEnvelope(JSON.parse(data.toString("utf8")) as unknown);
        if (!auth) {
          if (!dependencies.wechatTrustCloudHeaders || envelope.type !== "resume" || !envelope.resumeToken) {
            connectionTerminated = true;
            socket.close(1008, "unauthorized");
            return;
          }
          try {
            authenticateConnection(
              dependencies.auth.authenticateTrustedWechatSocket(
                envelope.resumeToken,
                request.headers["x-wx-openid"],
                request.headers["x-wx-source"],
              ),
              envelope.sessionId,
            );
          } catch {
            connectionTerminated = true;
            socket.close(1008, "unauthorized");
            return;
          }
        }
        const authenticated = auth;
        if (!authenticated || !activeSessionId) {
          connectionTerminated = true;
          socket.close(1008, "unauthorized");
          return;
        }
        // Per-playerId cross-connection throttle (30 cmd/s). The counter lives
        // in ConnectionHub keyed by playerId, so it survives socket reconnects
        // — a new socket does not get a fresh budget.
        if (!dependencies.hub.tryAcquire(authenticated.playerId)) {
          app.log.warn({ playerId: authenticated.playerId }, "message throttle: rate limit exceeded");
          throw new ServiceError("RATE_LIMITED", "Too many commands", true);
        }
        if (envelope.sessionId !== activeSessionId) {
          bindConnection(authenticated, envelope.sessionId);
        }
        if (envelope.type === "resume") {
          socket.send(JSON.stringify(await dependencies.gateway.resume(authenticated, envelope.sessionId)));
        } else {
          socket.send(JSON.stringify(await dependencies.gateway.command(authenticated, envelope)));
        }
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof ProtocolDecodeError) {
          connectionTerminated = true;
          socket.close(1008, "invalid protocol message");
          return;
        }
        // There is no protocol-level anonymous error envelope. Command failures are
        // acknowledged by SessionGateway; failures while resuming require a clean
        // reconnect so the client can retry its persisted resume/outbox sequence.
        void toProblem(error);
        connectionTerminated = true;
        if (socket.readyState === socket.OPEN) socket.close(1011, "session operation failed");
      }
    };
    socket.on("close", () => {
      connectionTerminated = true;
      if (authenticationTimer) clearTimeout(authenticationTimer);
      authenticationTimer = undefined;
      removeConnection?.();
      const authenticated = auth;
      if (!authenticated || dependencies.hub.hasConnections(authenticated.playerId)) return;
      void dependencies.rooms.setConnected(authenticated, false).then(async (room) => {
        // A replacement socket may have arrived while the room transaction was
        // waiting. Restore presence rather than letting an older close win.
        if (dependencies.hub.hasConnections(authenticated.playerId)) {
          const restored = await dependencies.rooms.setConnected(authenticated, true);
          if (restored) dependencies.gateway.broadcastPresence(restored.id);
          return;
        }
        if (room) dependencies.gateway.broadcastPresence(room.id);
      });
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    const problem = toProblem(error);
    const status = error instanceof ServiceError
      ? error.code === "UNAUTHORIZED" ? 401
        : error.code === "INVALID_DEVELOPMENT_IDENTITY" ? 400
          : 500
      : 500;
    void reply.code(status).send(problem);
  });
  return app;
}

function readBearer(header: string | string[] | undefined): string {
  if (typeof header !== "string") return "";
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  return match?.[1] ?? "";
}
