# 微信云托管部署清单

本项目的 API 只部署到微信云托管，目标服务名为 `exploding-kitty-api`。不要将本清单用于 CloudBase 独立控制台。

## 发布版本

- 上传方式：本地代码包（ZIP）
- 代码包：仓库根目录的 `exploding-kitty-api-source.zip`
- Dockerfile：代码包根目录的 `Dockerfile`
- 容器端口：`3000`
- 最小实例数：`1`
- 最大实例数：`1`
- 公网访问：关闭
- 健康检查路径：`/health/live`

正式小游戏的 HTTP 与 WebSocket 都走微信云托管私有协议：登录使用 `wx.cloud.callContainer`，实时会话使用 `wx.cloud.connectContainer`。因此无需开启公网访问或配置通讯域名。只有已获该云托管环境授权的微信端才能通过环境 ID 和服务名调用服务。

## 环境变量

在服务版本中配置以下变量。数据库账号、数据库密码和 `AUTH_SECRET` 只保存在云托管配置中，不写入仓库。

```text
MYSQL_ADDRESS=10.4.110.92:3306
MYSQL_USERNAME=<云托管 MySQL 用户名>
MYSQL_PASSWORD=<云托管 MySQL 密码>
MYSQL_DATABASE=exploding_kitty
AUTH_SECRET=<至少 32 字符的随机值>
WECHAT_TRUST_CLOUD_HEADERS=true
LOG_LEVEL=info
DEADLINE_POLL_MS=1000
```

可信头模式不需要配置 `WECHAT_APP_ID` 或 `WECHAT_APP_SECRET`。此开关只允许在微信云托管网关之后启用；`callContainer` 登录会验证网关注入的 `X-WX-OPENID` 和 `X-WX-SOURCE`。`connectContainer` 以环境、服务和路径选择私有入口，并设置 10 秒连接超时；登录所得 Bearer token 放入连接建立后的首个 `resume.resumeToken`，由服务端在接受业务命令前验证，绝不放进 URL。iOS“高性能+”模式无法提供 `X-WX-OPENID` 时，WebSocket 认证仍可依靠该 token 完成。

## 发布后验证

版本发布成功且健康检查通过后，在微信开发者工具的小游戏环境中验证私有 HTTP 调用：

```js
const env = "<微信云托管环境 ID>"
wx.cloud.init({ env })

for (const path of ["/health/live", "/health/ready"]) {
  const result = await wx.cloud.callContainer({
    config: { env },
    path,
    method: "GET",
    header: { "X-WX-SERVICE": "exploding-kitty-api" },
  })
  console.log(path, result.statusCode, result.data)
}
```

预期状态码均为 `200`，响应分别为 `{ "status": "ok" }` 与 `{ "status": "ready" }`。随后用正式构建完成一次登录、创建/加入房间和断线重连，确认 `callContainer` 与 `connectContainer` 都能在公网访问关闭时工作。无需为验证临时开放公网。

## 小游戏生产构建

在小游戏管理后台把基础库最低版本设为 `2.23.0`，然后只使用云托管环境 ID 和服务名重新构建：

```powershell
$env:MINIGAME_CLOUD_ENV_ID = "<微信云托管环境 ID>"
$env:MINIGAME_CLOUD_SERVICE_NAME = "exploding-kitty-api"
npm --workspace @exploding-kitty/minigame run build
```

`MINIGAME_CLOUD_ENV_ID` 和服务名不是服务端密钥；数据库密码与 `AUTH_SECRET` 仍只保存在云托管服务配置中，不得放进小游戏构建变量。HTTP 登录通过 `callContainer`，实时会话通过 `connectContainer`，Bearer 会话 token 只在加密连接内作为首个 `resume.resumeToken` 发送。

## 官方依据

- [小游戏访问云托管服务（`callContainer`）](https://developers.weixin.qq.com/minigame/dev/wxcloudrun/src/development/call/mini.html)
- [小游戏云托管 WebSocket（`connectContainer`）](https://developers.weixin.qq.com/minigame/dev/wxcloudrun/src/development/websocket/miniprogram.html)
- [小游戏网络说明：云托管私有协议无需配置通讯域名](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/network.html)
- [云托管服务设置：关闭公网访问后仅允许微信体系调用](https://developers.weixin.qq.com/minigame/dev/wxcloudrun/src/guide/service/pipeline.html)
