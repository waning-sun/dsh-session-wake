# Changelog

## 1.0.3 — 2026-11-11

修「开机自动唤醒设置存了，重启 DSH 就没了」。

- **根因**：`apply()` 里是 `归一({ ...读配置(), ...config })` —— 插件配置（`cordis.patch.yml` 的 `config`）里那条 `自动唤醒: []` 是空默认，展开时把文件里存的两条整段盖掉了，于是每次启动都判成「还没配自动唤醒的会话」。同一台机器 12:25:36 存完当场是「已排队：2 间会话」，重启后 12:25:53 就变成「还没配自动唤醒的会话」，日志里能看到这两句。
- **修法**：新增 `起始配置(插件配置)` —— 只把**文件里真写了的键**叠到插件配置上（读原文，不补默认），文件优先。`apply()` 改走它；面板里明确清空（文件里存了 `自动唤醒: []`）才算清空。
- `读配置()` 保持原样（面板 `/state`、`存配置` 的兜底仍用它）。
- `selftest` 新增 5 项：无文件走插件配置 / 文件条目不被空默认盖掉 / 文件没写的键回落插件配置 / 文件里明确清空才清空 / `apply()` 真按文件里的条目排队（35 项全过）。

## 1.0.2 — 2026-11-11

补上面板接口的准入围栏（awesome-dsh-plugin PR review 提的问题）。

- **每条路由入口先过准入**：`/state`、`/sessions`、`/llm`、`/save`、`/test` 是 `webServer.register` 挂的，宿主对这类路由不做任何准入；现在统一先调 `connection.requestRejection(req)`（Host/Origin 围栏 + 浏览器登录态），拿不到 `connection` 服务时退回内置等价围栏（Host 必须是回环/本机网卡地址、`sec-fetch-site` 不能是 `cross-site`、`Origin` 必须与 `Host` 同权威），401/403 原样回。
- **POST 强制 JSON**：`/save`、`/test` 要求 `content-type: application/json`，否则 415 —— 表单式简单请求带不了这个头，跨站页面（含 DNS 重绑定）写不进配置、也触发不了测试。
- 面板自身是同源请求，行为不变。

自检：`probe-apply-ctx` 新增 13 项围栏断言（回环放行 / 无 Host 拒 / 非本机 Host 拒 / cross-site 拒 / 跨源 Origin 拒 / 同源放行 / 表单 POST 415 / 跨站 POST 403）全过，其余三个脚本照旧全绿。

## 1.0.1 — 2026-11-08

修「思考强度选不了」+ 重排「默认模型」卡片。

- **思考强度全空**：`llm快照()` 原来从 `listModels()` 的条目里读 `reasoning.efforts`，但宿主返回的模型清单不带这个字段 —— 强度要另外问 `llm.resolveModelInfo(provider, model)`。现在逐个模型异步取 `resolveModelInfo(...).reasoning.efforts`，面板里三项下拉（provider / model / 思考强度）都能正常列出；provider 留空时按「现在生效」的那一套去列。
- **布局**：默认模型卡片改成三列等宽字段组（provider / model / 思考强度），标题行右侧显示「现在生效：provider / model · 强度 x」；启动延迟与等答复上限改成两列字段组，数字框占满列宽。
- 换 provider 时清空 model 与思考强度（避免残留不匹配的组合）；选模型时若 provider 为空，自动补成当前生效的 provider。

## 1.0.0 — 2026-11-08

改名 + 重新定位：`dsh-qq-wake` → `dsh-session-wake`。

- **不再跟 QQ / `dsh-qq-link` 有任何关系**：删掉读 `qq-bridge-config.json`、盯 `desktop-next.log` 找「那间会话没活着」、心跳巡检那一整套。包的 name、ModuleLoader id、设置项标题、路由前缀、工具名全部换成 session 语义。
- **新增：开机自动唤醒列表**。设置页里挑一个或几个会话，DSH 一启动就把它们提起来，可带一句「开机提示词」。`state.booted` 去重，一次启动只叫一遍。
- **新增：每间会话单独指定 provider / model / 思考强度**。条目级 > 全局默认 > DSH `agent-default-model` > 硬默认。
- **新增：`session_task` 工具**。唤醒目标会话 → 把内容投进去 → 等它这轮跑完 → 把答复原文带回本对话。另有 `wake_session`（只叫醒/投递，不等）与 `list_sessions`（挑目标用）。
- **新增：设置页「会话唤醒」**（`settings.section`，order 55）：总开关、默认模型、自动唤醒列表（逐条勾选/模型/提示词）、启动延迟、等答复超时、测一下。
- 配置落 `~/.dsh/dsh-session-wake.json`；面板存的优先于 `cordis.patch.yml` 的 `config`，改完即生效。
- 唤醒走 `ctx.agents.resume` + `agentPresets.mount`，投递走 `agent.followup`，取答复走 `ctx.sessionQuery.readSession`（只取投递之后那一轮的 text 块）。
- 宿主服务晚就绪时经 `取服务()` 兜底并每秒补挂，最多 30 次（沿用 0.5.5 的修法）。
- 会话清单适配宿主真实结构：entry 用 `header.id` / `header.cwd`，标题另取 `readTitleSnapshots`；`认会话` 支持完整 id、去前缀、后 8 位、唯一子串、标题。

自检：`check-manifest` 32 项、`probe-apply-ctx` 全过、`selftest` 30 项、`smoke-client` 全过。
