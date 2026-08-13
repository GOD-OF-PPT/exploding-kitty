import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import websocket from "@fastify/websocket";
import { parseClientEnvelope, ProtocolDecodeError } from "@exploding-kitty/protocol";
import type { AuthService } from "./auth/authService.js";
import { ServiceError, toProblem } from "./errors.js";
import type { RoomCoordinator } from "./room/roomCoordinator.js";
import type { RawData } from "ws";
import type { GameStore } from "./persistence/store.js";
import type { ConnectionHub } from "./transport/connectionHub.js";
import type { SessionGateway } from "./transport/sessionGateway.js";

export type AppDependencies = Readonly<{
  auth: AuthService;
  rooms: RoomCoordinator;
  store: GameStore;
  gateway: SessionGateway;
  hub: ConnectionHub;
  devAuthEnabled: boolean;
  logger?: FastifyServerOptions["logger"];
}>;

type AuthBody = { code?: string; developmentIdentity?: string; profile?: { displayName?: string; avatarUrl?: string } };

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.logger ?? false,
    bodyLimit: 16 * 1024,
    requestIdHeader: false,
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024, perMessageDeflate: false } });

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
    try { return await dependencies.auth.issueWechat(request.body?.code ?? "", request.body?.profile); }
    catch (error) { return reply.code(401).send(toProblem(error)); }
  });

  app.get("/v1/session", { websocket: true }, (socket, request) => {
    let auth;
    try { auth = dependencies.auth.authenticate(readBearer(request.headers.authorization)); }
    catch { socket.close(1008, "unauthorized"); return; }

    let activeSessionId = `bootstrap_${auth.playerId}`;
    let removeConnection = dependencies.hub.add({
      playerId: auth.playerId,
      sessionId: activeSessionId,
      send: (envelope) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(envelope)); },
    });
    let commandCount = 0;
    let windowStartedAt = Date.now();
    let messageQueue: Promise<void> = Promise.resolve();

    void dependencies.rooms.setConnected(auth, true).then((room) => room && dependencies.gateway.broadcast(room.id));
    socket.on("message", (data: RawData, isBinary: boolean) => {
      messageQueue = messageQueue.then(() => handleMessage(data, isBinary)).catch(() => undefined);
    });
    const handleMessage = async (data: RawData, isBinary: boolean): Promise<void> => {
      try {
        if (isBinary) throw new ProtocolDecodeError("$", "UTF-8 JSON text");
        const now = Date.now();
        if (now - windowStartedAt >= 1_000) { windowStartedAt = now; commandCount = 0; }
        if (++commandCount > 30) throw new ServiceError("RATE_LIMITED", "Too many commands", true);
        const envelope = parseClientEnvelope(JSON.parse(data.toString("utf8")) as unknown);
        if (envelope.sessionId !== activeSessionId) {
          activeSessionId = envelope.sessionId;
          const removePreviousConnection = removeConnection;
          removeConnection = dependencies.hub.add({
            playerId: auth.playerId,
            sessionId: activeSessionId,
            send: (message) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message)); },
          });
          // Register the replacement first so a bootstrap -> room/match rebind
          // never makes the player appear to have no live connection.
          removePreviousConnection();
        }
        if (envelope.type === "resume") {
          socket.send(JSON.stringify(await dependencies.gateway.resume(auth, envelope.sessionId)));
        } else {
          socket.send(JSON.stringify(await dependencies.gateway.command(auth, envelope)));
        }
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof ProtocolDecodeError) {
          socket.close(1008, "invalid protocol message");
          return;
        }
        // There is no protocol-level anonymous error envelope. Command failures are
        // acknowledged by SessionGateway; failures while resuming require a clean
        // reconnect so the client can retry its persisted resume/outbox sequence.
        void toProblem(error);
        if (socket.readyState === socket.OPEN) socket.close(1011, "session operation failed");
      }
    };
    socket.on("close", () => {
      removeConnection();
      if (dependencies.hub.hasConnections(auth.playerId)) return;
      void dependencies.rooms.setConnected(auth, false).then(async (room) => {
        // A replacement socket may have arrived while the room transaction was
        // waiting. Restore presence rather than letting an older close win.
        if (dependencies.hub.hasConnections(auth.playerId)) {
          const restored = await dependencies.rooms.setConnected(auth, true);
          if (restored) await dependencies.gateway.broadcast(restored.id);
          return;
        }
        if (room) await dependencies.gateway.broadcast(room.id);
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
