# Authoritative game server

Node.js + TypeScript modular monolith for authenticated rooms, authoritative matches, private projections, reliable deadlines and reconnect snapshots. PostgreSQL is the production source of truth; the in-memory adapter is intended for tests and local smoke runs only.

## Run locally

From the repository root:

```sh
npm install
npm --workspace @exploding-kitty/game-core run build
npm --workspace @exploding-kitty/protocol run build
npm --workspace @exploding-kitty/game-server run dev
```

Without `DATABASE_URL`, state is in memory. With PostgreSQL, apply migrations first:

```sh
npm --workspace @exploding-kitty/game-server run migrate
```

Or start PostgreSQL, migrations and the server together:

```sh
docker compose -f apps/game-server/docker-compose.yml up --build
```

Copy values from `.env.example` into the process environment. Production requires `DATABASE_URL`, a random `AUTH_SECRET` of at least 32 characters, TLS termination and WeChat credentials. `POST /v1/auth/dev` is disabled by default when `NODE_ENV=production`.

## Transport

- `POST /v1/auth/dev` accepts `{ developmentIdentity, profile? }` and returns `{ token, playerId }` for local development. `developmentIdentity` must be a stable, installation-scoped 32-character lowercase hexadecimal value; it alone determines `playerId`, while `profile.displayName` is display-only. Missing or invalid identities are rejected.
- `POST /v1/auth/wechat` accepts `{ code, profile? }` and calls WeChat `jscode2session`.
- `GET /health/live` and `GET /health/ready` expose process and store health.
- `WS /v1/session` accepts protocol v1 `command` and `resume` envelopes. The handshake authenticates with `Authorization: Bearer <session>`; credentials never enter the URL.

Client actions never carry `actorId`, server time, random results or deadline commands. Each successful match command advances `revision`; duplicate `(match, actor, commandId)` submissions return their original receipt. Reconnect always returns a complete viewer-private snapshot. The server pushes snapshots after room or match changes.

The first production topology is intentionally one server instance plus PostgreSQL. Connection fan-out is process-local; add PostgreSQL `LISTEN/NOTIFY` (or an equivalent bus) before horizontal scaling.

`UpdateSettings` is a device-local client action and is explicitly rejected by the server. `Login` is performed over HTTP. `StartTutorial` creates a server-owned `room.tutorial=true` room, adds a Bot and starts the authoritative rules engine with a deterministic teaching seed; the flag is persisted by migration `004_tutorial_mode.sql` and projected in lobby/match snapshots. That migration also marks historical durable receipt snapshots as ordinary rooms so strict idempotent replay remains decodable. Restart and restart-vote actions are also handled by the room coordinator.

## Verify

```sh
npm --workspace @exploding-kitty/game-server test
npm --workspace @exploding-kitty/game-server run typecheck
npm --workspace @exploding-kitty/game-server run build
```

`src/app.websocket.test.ts` 使用真实 Fastify WebSocket 路由与两个认证客户端，覆盖房间闭环、实际 Nope、私密 Favor/预见未来/拆弹投影、重连、结算、投票、重开和离房。它使用内存存储验证传输与领域链路；PostgreSQL 迁移、重启和故障注入仍应在部署环境单独演练。
