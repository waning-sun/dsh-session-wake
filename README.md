# dsh-session-wake

让 DSH 的会话之间互相叫醒。

三件事，一件不多：

1. **开机自动唤醒** —— 在设置页勾一个或几个会话，DSH 一启动就把它们提起来（可以顺带投一句「开机提示词」让它接着干活）。
2. **每间会话单独指定模型** —— provider / model / 思考强度都能一条一条配，没配的落回全局默认，全局默认再落回 DSH 自己的 `agent-default-model`。
3. **给 AI 一个派活的工具** —— `session_task`：把当前对话里的内容丢给另一个会话去做，等它这轮跑完，再把它的答复原文取回本对话。

不依赖 QQ，不读任何桥的配置文件。跟 `dsh-qq-link` 没有任何关系 —— 名字里的 `session` 就是字面意思。

## Requirements

- DSH `>= 0.2.1-rc.2`（`engines.dsh`）
- Node `>= 20`
- 宿主需要提供这几个服务：`agents`、`tools`、`webServer`；`sessionQuery`（取答复用）与 `agentPresets`（带预设装配）有则更好，没有会退化成「裸唤醒 / 取不回答复」。

## 装

包名登记进 profile 的 `dsh.profile.bundles` 即可，`cordis.patch.yml` 会自动应用：

```bash
# ~/.dsh/profiles/<profile>/package.json
"dsh": { "profile": { "bundles": ["dsh-session-wake"] } }
```

或者用插件管理器装（它会替你写上面那段）：

```bash
dsh plugin add dsh-session-wake
```

装完在 **DSH → 设置 → 会话唤醒** 里配。

## 设置页能干什么

- 总开关：关掉之后既不自动唤醒，也不注册工具。
- 默认模型：provider / model / 思考强度。空白 = 跟 DSH 的 `agent-default-model` 走。
- 自动唤醒列表：从会话列表里挑（显示标题 + id 尾巴 + 是否在线），每条可以：
  - 勾/不勾（这一条生不生效）
  - 单独指定 provider / model / 思考强度（覆盖默认）
  - 写一句「开机提示词」，叫醒之后顺手投给它
  - 移除
- 启动后延迟（毫秒）：给宿主一点时间把服务起齐，默认 1500。
- 等答复超时（秒）：`session_task` 最多等多久，默认 300。
- 「测一下」：把每一条真叫一遍，摆出明细（活着 / 被叫醒 / 叫不醒 + 原因 + 用的哪个模型）。

## 配置文件

`~/.dsh/dsh-session-wake.json`（`$DSH_HOME` 优先）：

```json
{
  "开": true,
  "看日志": false,
  "自动唤醒": [
    {
      "会话": "session-02b01e82-c126-4119-b1ad-6423b48db196",
      "开": true,
      "provider": "",
      "model": "",
      "思考强度": "",
      "提示词": "继续上次没做完的活"
    }
  ],
  "provider": "",
  "model": "",
  "思考强度": "",
  "唤醒超时秒": 300,
  "启动延迟毫秒": 1500
}
```

- 面板存的那份优先级高于 `cordis.patch.yml` 里的 `config`，改完立刻生效，不用重启 DSH。
- 同一间会话在列表里只留第一条（写入时去重）。

## 给 AI 的三个工具

| 工具 | 干什么 |
| --- | --- |
| `list_sessions` | 列出所有会话：`id`、`标题`、`live`。用来挑目标。 |
| `wake_session` | 叫醒一间会话，可顺手投一句话；**不等**它做完。 |
| `session_task` | 唤醒 → 投内容 → 等这轮跑完 → 把答复原文返回。`参: { 会话, 内容, 等待秒?, provider?, model?, 思考强度? }` |

`会话` 三种写法都认：完整 `session-…`、去掉前缀的 uuid、后 8 位、或者会话标题（标题撞车会回候选让你挑）。

`session_task` 返回：

```json
{
  "ok": true,
  "会话": "session-…",
  "标题": "干活的会话",
  "状态": "跑完了",
  "用时秒": 42.3,
  "答复": "干完了，改了三处…"
}
```

超时时 `状态` 是 `超时`，`答复` 里仍然带着这段时间里它已经说过的话。

## 它到底怎么醒的（实现要点）

- 唤醒走 `ctx.agents.resume({ resumeSessionId, agentOptions, setup })`：
  - `agentOptions` **必须**带 `provider` / `model`，否则 agent 建起来一跑就报 `has no provider/model`；
  - `setup` 里调 `agentPresets.mount(agentCtx, 预设.id)`，否则没有预设装配，一轮都跑不动。
- 已经活着（`agents.get(id)` 拿得到）就不 resume，只投递 `agent.followup(message)`，不会打断正在跑的对话。
- 取答复走 `ctx.sessionQuery.readSession(id)`：只收「投递前那号之后」的 `assistant/message` 事件里的 `text` 块 —— 所以拿回来的是**这一轮**的产出，不是整段历史。
- 宿主服务偶尔比 `apply` 晚一步就绪：一律经 `取服务()` 兜住，没挂上就每秒补挂，最多 30 次。

## 几个坑（改代码前先看）

- `apply` **必须同步、且不返回任何值**：返回 Promise / 对象会被 cordis 判成 `TypeError: Invalid effect`，整个 entry 直接不激活。
- 不能写 `ctx.effect(() => ctx.webServer.register(...))` —— `register` 的返回值不一定是函数，同样炸 `Invalid effect`。要手动收 unsubscribe，再交给一个确定返回函数的 effect。
- 热重载时新实例先 `apply`、旧实例后 `cleanup`，而 state 挂在同一份 `globalThis` 上：用代际号挡住旧 cleanup 把新定时器掐掉。
- 客户端组件里所有 React hook 必须排在所有 early return 之前，否则 React #310 会把整个设置面板搞白。

## 开发

```bash
node scripts/check-manifest.mjs   # 清单体检（BOM/UTF-8/版本/名字/字段/README）
node scripts/probe-apply-ctx.mjs  # 两种假 ctx 跑 apply：不许抛、不许返回值、effect 必须返回函数
node scripts/selftest.mjs         # 离线自测：归一/拼模型/认会话/抓答复/会话任务全链路
node scripts/smoke-client.mjs     # 网页半边静态冒烟：括号配平、路由对齐、控件齐全
npm test                          # 前三个串起来
```

## License

MIT
