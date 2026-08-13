# 微信小游戏客户端

正式客户端是原生微信小游戏：界面使用 `minigame-canvas-engine`，牌桌局部使用 Canvas2D。`prototype/` 只作为设计与回归参考，不进入小游戏发布产物。

## 构建与导入

```powershell
npm install
$env:MINIGAME_API_BASE_URL = "https://game.example.com"
npm --workspace @exploding-kitty/minigame run build
```

在微信开发者工具中导入 `apps/minigame`。`project.config.json` 的 `miniprogramRoot` 已指向 `release/`，并配置小游戏公开 AppID；AppSecret 与开发者工具的每机私有配置不会进入仓库。

正式构建通过 `MINIGAME_API_BASE_URL` 注入 HTTPS API 根地址；未配置时客户端显示启动失败和重试入口，不会静默进入 Demo。构建后的地址固定在产物中，生产构建忽略分享 query 中的 `server`、`dev` 和 `demo` 参数，避免外部链接重定向服务或降级认证。

当前 `npm run build` 是生产模式构建，因此 `demo=1`、`dev=1` 和 `server=...` 只在 `npm run dev` 生成的开发构建中生效：

- `demo=1`：显式启用本地演示会话；
- `server=https%3A...&dev=1`：显式覆盖开发服务器，并在微信登录失败时允许开发身份登录。

开发身份持久化于微信存储键 `ek.development-identity.v1`。身份是安装级随机值，同一设备重启后稳定，不同设备互不共享；昵称仅用于展示。生产微信登录不会读取或发送该身份。开发登录依赖服务端显式开放 `/v1/auth/dev`，不得作为生产认证方案。

WebSocket 固定连接 `/v1/session`，握手通过 `Authorization: Bearer <session>` Header 认证；会话凭证不会拼入 URL。三步新手说明完成后发送 `StartTutorial`，由服务端创建带 Bot 的权威教学局；客户端依据私有快照中的 `room.tutorial` 显示随进度变化的提示，不在本地裁决教学局规则。上述 Header 与教学流程仍须在微信开发者工具和真机复核。

## 资源

正式小游戏素材位于 `apps/minigame/assets/`。图片由原型原创素材机械降采样和 PNG 压缩生成，4 个短 WAV 提示音由仓库脚本确定性生成；原型源图不被修改。`assets.manifest.json` 只列出运行时真实引用的 17 个文件，构建会生成提示音、复制素材到 `release/assets/`，并检查总量和单文件预算。

```powershell
# 只有更新原型源素材时才需要重新生成小游戏副本；需要 ImageMagick
apps/minigame/scripts/optimize-assets.ps1
npm --workspace @exploding-kitty/minigame run check:assets
```

当前素材总量为 2,439,562 字节，其中提示音共 21,224 字节，低于 3,800,000 字节目标；最大文件为 308,250 字节。生产构建会压缩脚本并移除 source map，资源检查同时要求整个 `release/` 在 4 MiB 基准下至少保留 20% 余量。正式上传前仍需在微信开发者工具中确认平台统计口径和主包限制。

## 已知边界

- 真人联机仅使用权威远程会话，客户端不持有牌堆顺序、对手手牌或随机种子。
- 回合、Nope 与私密选择倒计时由服务端时间和截止时间校正后显示；客户端倒计时不参与规则裁决。
- 会话支持重连、全量私有快照和单命令 outbox；目前没有“断线 60 秒后由 Bot 托管”功能。
- 服务端首版只能单实例部署；跨实例连接广播尚未实现。
- 微信登录、合法域名、分享、WSS 和 iOS/Android 真机行为仍需正式 AppID 与真实环境验收。

## 验证

```powershell
npm --workspace @exploding-kitty/minigame run typecheck
npm --workspace @exploding-kitty/minigame test
npm --workspace @exploding-kitty/minigame run build
```
