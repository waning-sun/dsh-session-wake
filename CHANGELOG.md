# Changelog

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
