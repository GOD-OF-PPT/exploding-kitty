# 微信云托管部署清单

本项目的 API 只部署到微信云托管，目标服务名为 `exploding-kitty-api`。不要将本清单用于 CloudBase 独立控制台。

## 发布版本

- 上传方式：本地代码包（ZIP）
- 代码包：仓库根目录的 `exploding-kitty-api-source.zip`
- Dockerfile：代码包根目录的 `Dockerfile`
- 容器端口：`3000`
- 最小实例数：`1`
- 最大实例数：`1`
- 公网访问：开启（小游戏 WSS 需要）
- 健康检查路径：`/health/live`

云托管默认公网域名可用于本次 API/WSS 冒烟，但正式小游戏不能把它配置为 socket 合法域名。正式发布前需给服务绑定已备案的自定义 HTTPS 域名，并在小游戏后台把该域名加入 socket 合法域名；随后用自定义域名作为 `MINIGAME_WEBSOCKET_BASE_URL`。

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

可信头模式不需要配置 `WECHAT_APP_ID` 或 `WECHAT_APP_SECRET`。此开关只允许在微信云托管网关之后启用；API 会同时验证网关注入的 `X-WX-OPENID` 和 `X-WX-SOURCE`。

## 发布后验证

用服务的公网 HTTPS 域名执行：

```powershell
Invoke-RestMethod "https://<公网域名>/health/live"
Invoke-RestMethod "https://<公网域名>/health/ready"
```

预期分别返回 `{ "status": "ok" }` 与 `{ "status": "ready" }`。公网直接调用 `/v1/auth/wechat` 不会带可信微信身份，返回 401 属于正常行为；登录端点应从小游戏通过 `wx.cloud.callContainer` 验证。

## 小游戏生产构建

取得微信云托管环境 ID 和服务公网 HTTPS 域名后重新构建：

```powershell
$env:MINIGAME_CLOUD_ENV_ID = "<微信云托管环境 ID>"
$env:MINIGAME_CLOUD_SERVICE_NAME = "exploding-kitty-api"
$env:MINIGAME_WEBSOCKET_BASE_URL = "https://<已备案自定义域名>"
npm --workspace @exploding-kitty/minigame run build
```

HTTP 登录通过 `wx.cloud.callContainer`，实时会话通过公网 WSS + `Authorization: Bearer`。不要把密钥放进小游戏构建变量。
