# Authoritative game server

Node.js + TypeScript modular monolith for authenticated rooms, authoritative matches, private projections, reliable deadlines and reconnect snapshots. MySQL 5.7 is the production source of truth; the in-memory adapter is intended for tests and local smoke runs only.

## Run locally

From the repository root:

```sh
npm install
npm --workspace @exploding-kitty/game-core run build
npm --workspace @exploding-kitty/protocol run build
npm --workspace @exploding-kitty/game-server run dev
```

Without the four `MYSQL_*` variables, state is in memory. With MySQL, apply migrations first:

```sh
npm --workspace @exploding-kitty/game-server run migrate
```

Or start MySQL 5.7 and the server together. The container runs migrations before accepting traffic:

```sh
docker compose -f apps/game-server/docker-compose.yml up --build
```

Copy values from `.env.example` into the process environment. Production requires `MYSQL_ADDRESS`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, a random `AUTH_SECRET` of at least 32 characters and one WeChat identity mode. `MYSQL_ADDRESS` accepts `host` or `host:port`. `POST /v1/auth/dev` is disabled by default when `NODE_ENV=production`. Direct non-cloud deployments require their own TLS termination; the intended WeChat Cloud Run production topology instead uses the platform's private `callContainer`/`connectContainer` gateway with public access disabled.

For WeChat Cloud Run（微信云托管）, set `WECHAT_TRUST_CLOUD_HEADERS=true` only when every request reaches the container through its gateway. In that explicit mode, `POST /v1/auth/wechat` ignores the request body's login code and signs an identity only when both gateway-injected `X-WX-OPENID` and `X-WX-SOURCE` are valid; missing or malformed headers are rejected without fallback. The returned Bearer token authenticates the WebSocket in the first `resume.resumeToken` sent after `connectContainer` opens. This avoids putting credentials in a URL and also covers iOS “High Performance+” connections where `X-WX-OPENID` is unavailable on the WebSocket request. Outside Cloud Run, leave trusted-header mode false and configure `WECHAT_APP_ID` plus `WECHAT_APP_SECRET` for normal `jscode2session` exchange. Never enable trusted-header mode behind a proxy that forwards client-supplied `X-WX-*` headers.

For WeChat Cloud Run manual source upload, upload the repository-root archive and use the root `Dockerfile`. The equivalent `apps/game-server/Dockerfile` remains available for local Compose builds. Both images run the idempotent MySQL migrations before starting the API.

## Transport

- `POST /v1/auth/dev` accepts `{ developmentIdentity, profile? }` and returns `{ token, playerId }` for local development. `developmentIdentity` must be a stable, installation-scoped 32-character lowercase hexadecimal value; it alone determines `playerId`, while `profile.displayName` is display-only. Missing or invalid identities are rejected.
- `POST /v1/auth/wechat` accepts `{ code, profile? }` and calls WeChat `jscode2session`, or consumes only gateway-injected `X-WX-OPENID` and `X-WX-SOURCE` when trusted WeChat Cloud Run mode is explicitly enabled.
- `GET /health/live` and `GET /health/ready` expose process and store health.
- `WS /v1/session` accepts protocol v1 `command` and `resume` envelopes. Cloud Run production connects through `wx.cloud.connectContainer` using only environment, service and path; the first envelope must be `resume` with the login Bearer token in `resumeToken`, and no command is accepted before it verifies. Credentials never enter the URL. Direct/local clients may continue to use the `Authorization: Bearer <session>` handshake compatibility path.

Client actions never carry `actorId`, server time, random results or deadline commands. Each successful match command advances `revision`; duplicate `(match, actor, commandId)` submissions return their original receipt. Reconnect always returns a complete viewer-private snapshot. The server pushes snapshots after room or match changes.

The first production topology is intentionally one server instance plus MySQL. Connection fan-out is process-local; add an external notification bus before horizontal scaling.

`UpdateSettings` is a device-local client action and is explicitly rejected by the server. `Login` is performed over HTTP. `StartTutorial` creates a server-owned `room.tutorial=true` room, adds a Bot and starts the authoritative rules engine with a deterministic teaching seed; the flag is included in the MySQL baseline schema and projected in lobby/match snapshots. Restart and restart-vote actions are also handled by the room coordinator.

## Verify

```sh
npm --workspace @exploding-kitty/game-server test
npm --workspace @exploding-kitty/game-server run typecheck
npm --workspace @exploding-kitty/game-server run build
```

`src/app.websocket.test.ts` 使用真实 Fastify WebSocket 路由与两个认证客户端，覆盖房间闭环、实际 Nope、私密 Favor/预见未来/拆弹投影、重连、结算、投票、重开和离房。它使用内存存储验证传输与领域链路；MySQL 迁移、重启和故障注入仍应在部署环境单独演练。
