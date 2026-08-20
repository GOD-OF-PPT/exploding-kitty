# 微信小游戏客户端

正式客户端是原生微信小游戏：界面使用 `minigame-canvas-engine`，牌桌局部使用 Canvas2D。`prototype/` 只作为设计与回归参考，不进入小游戏发布产物。

## 构建与导入

客户端不使用 Taro 或 Vite，而是直接调用 esbuild。客户端构建变量统一使用 `MINIGAME_` 前缀，并按以下顺序加载 `apps/minigame` 下的文件（后者覆盖前者，当前 shell 环境变量优先级最高）：

- development：`.env`、`.env.local`、`.env.development`、`.env.development.local`；
- preview：`.env`、`.env.local`、`.env.preview`、`.env.preview.local`；
- production：`.env`、`.env.local`、`.env.production`、`.env.production.local`。

仓库已经在 `.env.preview` 和 `.env.production` 中固定已部署的微信云托管环境 `prod-d0g8qcwrb047789af` 与服务 `exploding-kitty-api`；这些路由标识不是密钥。preview 与 production 构建还会精确校验这一二元组，因此 shell 或 `.env.local` 若覆盖成其他目标，构建会直接失败。真机预览直接执行：

```powershell
npm run build:minigame:preview
```

preview 与 production 包只接受微信云托管目标：

```powershell
npm install
$env:MINIGAME_CLOUD_ENV_ID = "微信云托管环境 ID"
$env:MINIGAME_CLOUD_SERVICE_NAME = "exploding-kitty-api"
npm --workspace @exploding-kitty/minigame run build
```

preview 或 production 缺少微信云托管目标时构建会立即失败，不再生成只能在启动阶段报 `MINIGAME_AUTH_ENDPOINT_REQUIRED` 的微信包。这两种模式同时关闭 query 参数带来的服务地址、开发鉴权和 Demo 覆盖；只有 development 模式允许 `MINIGAME_API_BASE_URL` 直连。每次构建还会在 `release/build-config.json` 记录非敏感的模式和路由目标，`check:bundle` 会反查 `release/game.js` 是否实际包含同一配置。

在微信开发者工具中导入 `apps/minigame`。`project.config.json` 的 `miniprogramRoot` 已指向 `release/`，并配置小游戏公开 AppID；AppSecret 与开发者工具的每机私有配置不会进入仓库。

微信云托管模式通过 `MINIGAME_CLOUD_ENV_ID` 和 `MINIGAME_CLOUD_SERVICE_NAME`（默认 `exploding-kitty-api`）同时配置 HTTP 和 WebSocket。客户端使用 `wx.cloud.callContainer` 登录，使用 `wx.cloud.connectContainer` 连接同一服务的 `/v1/session`；生产云托管服务保持关闭公网访问，无需任何通讯域名配置。`MINIGAME_API_BASE_URL` 只保留给 development 的本地或非云托管开发链路，不会进入 preview 或 production 包。

生产构建要求小游戏基础库最低版本为 `2.23.0`，这是 `callContainer` 的约束；`connectContainer` 自身最低为 `2.21.1`。`connectContainer` 的路由只由 `config.env`、`service` 和 `path` 决定，客户端另设 10 秒连接超时，但不依赖自定义认证 Header。登录得到的 Bearer 会话 token 只放在 Socket 打开后发出的首个 `resume.resumeToken` 中，由服务端在接受业务命令前验证，绝不拼入 URL。iOS“高性能+”模式可能不携带 `X-WX-OPENID`，此时仍由该 token 完成身份认证。

构建后的配置固定在产物中，生产构建忽略分享 query 中的 `server`、`dev` 和 `demo` 参数，避免外部链接重定向服务或降级认证。未配置云托管环境 ID（或本地开发所需的直连地址）时，仅微信开发者工具自动进入本地 Demo，便于首次导入预览；iOS/Android 真机仍显示明确的配置错误和重试入口，不会降级为本地规则。

当前 `npm run build` 是生产模式构建，因此 `demo=1`、`dev=1` 和 `server=...` 只在 `npm run dev` 生成的开发构建中生效：

- `demo=1`：显式启用本地演示会话；
- `server=https%3A...&dev=1`：显式覆盖开发服务器，并在微信登录失败时允许开发身份登录。

开发身份持久化于微信存储键 `ek.development-identity.v1`。身份是安装级随机值，同一设备重启后稳定，不同设备互不共享；昵称仅用于展示。生产微信登录不会读取或发送该身份。开发登录依赖服务端显式开放 `/v1/auth/dev`，不得作为生产认证方案。

WebSocket 固定连接 `/v1/session`。云托管生产模式由 `connectContainer` 创建 `SocketTask`；Socket 打开后，`RemoteGameSession` 的首个 `resume` 使用 `resumeToken` 携带刚登录取得的 Bearer token，服务端认证后才处理恢复和后续命令。会话凭证不会拼入 URL。三步新手说明完成后发送 `StartTutorial`，由服务端创建带 Bot 的权威教学局；客户端依据私有快照中的 `room.tutorial` 显示随进度变化的提示，不在本地裁决教学局规则。上述私有连接、认证回退与教学流程仍须在微信开发者工具和真机复核。

## 资源

正式小游戏素材位于 `apps/minigame/assets/`。卡牌和角色图片是基于仓库原创美术独立裁切、校准和压缩的发布素材，确保完整卡面与单角色头像不会串图；牌桌背景使用压缩 JPEG，4 个短 WAV 提示音由仓库脚本确定性生成。原型源图不被修改，发布图片也不承诺能由旧的批量缩放脚本逐字节再生。`assets.manifest.json` 只列出运行时真实引用的 18 个文件，构建会生成提示音、复制素材到 `release/assets/`，并检查总量和单文件预算。

```powershell
# 旧批量缩放脚本仅用于生成裁切起点；需要 ImageMagick，结果必须重新做视觉校准，不能直接覆盖发布素材
apps/minigame/scripts/optimize-assets.ps1
# DISPLAY_FONT 生产文案变化后，从锁定的 @fontsource 源重新生成单一 TTF；需要 FontTools
npm --workspace @exploding-kitty/minigame run assets:subset-font
npm --workspace @exploding-kitty/minigame run check:assets
```

当前素材总量为 2,764,837 字节，其中提示音共 21,224 字节，低于 3,800,000 字节目标；最大文件为 587,593 字节。生产构建会压缩脚本并移除 source map，资源检查同时要求整个 `release/` 在 4 MiB 基准下至少保留 20% 余量。正式上传前仍需在微信开发者工具中确认平台统计口径和主包限制。

## 已知边界

- 真人联机仅使用权威远程会话，客户端不持有牌堆顺序、对手手牌或随机种子。
- 回合、Nope 与私密选择倒计时由服务端时间和截止时间校正后显示；客户端倒计时不参与规则裁决。
- 会话支持重连、全量私有快照和单命令 outbox；目前没有“断线 60 秒后由 Bot 托管”功能。
- 服务端首版只能单实例部署；跨实例连接广播尚未实现。
- 微信登录、`callContainer`/`connectContainer` 私有链路、分享和 iOS/Android 真机行为仍需正式 AppID 与已授权云托管环境验收。

## 验证

```powershell
npm --workspace @exploding-kitty/minigame run typecheck
npm --workspace @exploding-kitty/minigame test
npm --workspace @exploding-kitty/minigame run build
```
