import { Pool } from "pg";
import { AuthService, DisabledWechatProvider, WechatCode2SessionProvider } from "./auth/authService.js";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { DeadlineWorker } from "./deadline/deadlineWorker.js";
import { createSafeLoggerOptions } from "./logging.js";
import { MatchCoordinator } from "./match/matchCoordinator.js";
import { MemoryGameStore } from "./persistence/memoryStore.js";
import { PgGameStore } from "./persistence/pgStore.js";
import { RoomCoordinator } from "./room/roomCoordinator.js";
import { secureIds, systemClock } from "./runtime.js";
import { ConnectionHub } from "./transport/connectionHub.js";
import { SessionGateway } from "./transport/sessionGateway.js";

const config = readConfig();
const store = config.databaseUrl
  ? new PgGameStore(new Pool({ connectionString: config.databaseUrl, max: 20 }))
  : new MemoryGameStore();
const wechat = config.wechatAppId && config.wechatAppSecret
  ? new WechatCode2SessionProvider(config.wechatAppId, config.wechatAppSecret)
  : new DisabledWechatProvider();
const auth = new AuthService(config.authSecret, wechat);
const rooms = new RoomCoordinator({ store, clock: systemClock, ids: secureIds });
const matches = new MatchCoordinator({ store, clock: systemClock, token: secureIds });
const hub = new ConnectionHub();
const gateway = new SessionGateway({ rooms, matches, store, hub });
const deadlines = new DeadlineWorker(store, matches, systemClock, config.deadlinePollMs, 20, (matchId) => gateway.broadcast(matchId));
const app = await buildApp({
  auth,
  rooms,
  store,
  gateway,
  hub,
  devAuthEnabled: config.devAuthEnabled,
  logger: createSafeLoggerOptions(config.logLevel),
});

deadlines.start();
const shutdown = async () => {
  deadlines.stop();
  await app.close();
  await store.close();
};
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

await app.listen({ host: config.host, port: config.port });
