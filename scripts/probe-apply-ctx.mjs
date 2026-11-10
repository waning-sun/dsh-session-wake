#!/usr/bin/env node
/**
 * probe-apply-ctx.mjs —— 用「审计探针式」的假 ctx 跑一遍 apply()，确认三件事：
 *
 *   ① apply 不抛异常 —— dsh-market 的 host apply 审计会拿一份**没声明 inject** 的 ctx
 *      调一次 apply()，那里直接写 ctx.agents / ctx.webServer 就会炸
 *      `cannot get property "…" without inject`，整行判红。
 *   ② apply 的返回值是 undefined —— cordis 的 safeCollect 只认 undefined 或清理函数；
 *      返回 Promise/对象会变成 `TypeError: Invalid effect`，整个 entry 不激活。
 *   ③ ctx.effect 回调返回的确实是函数 —— 曾经写成 ctx.effect(() => webServer.register(...))，
 *      register 返回值不是函数，直接炸 Invalid effect。
 *
 * 用法：node scripts/probe-apply-ctx.mjs
 * 退出码：0 = 全过；1 = 有问题
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const 根 = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const 问题 = []
const 说 = (ok, 名, 细节 = '') => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + 名 + (细节 ? '：' + 细节 : ''))
  if (!ok) 问题.push(名)
}

const mod = await import(pathToFileURL(join(根, 'lib/index.js')).href)

// ── ① 裸探针：什么服务都没有 ────────────────────────────────────────────────
{
  const 日志 = []
  const ctx = {
    logger: { info: (s) => 日志.push(String(s)) },
    effect: (fn) => {
      const f = fn()
      说(typeof f === 'function', 'effect 回调返回了函数（裸探针）')
    },
  }
  let 返回
  let 抛了 = ''
  try {
    返回 = mod.apply(ctx, {})
  } catch (e) {
    抛了 = e && e.message ? e.message : String(e)
  }
  说(抛了 === '', 'apply 在不注入任何服务的 ctx 下不抛', 抛了)
  说(返回 === undefined, 'apply 返回 undefined（不能返回 Promise/对象）', String(返回))
}

// ── ② 带服务的探针：工具与路由都要挂上 ──────────────────────────────────────
{
  const 工具 = []
  const 路由 = []
  const ctx = {
    logger: { info: () => {} },
    tools: { register: (def) => 工具.push(def.name) },
    webServer: { register: (opt) => (路由.push(opt.path), () => {}) },
    agents: { get: () => undefined, resume: async () => ({ agent: { status: 'idle', whenIdle: async () => {}, followup() {} } }) },
    sessionQuery: { listSessions: async () => [], readSession: async () => ({ events: [] }) },
    sessions: { get: () => undefined, flush: async () => {} },
    effect: (fn) => {
      const f = fn()
      说(typeof f === 'function', 'effect 回调返回了函数（带服务探针）')
      if (typeof f === 'function') f() // 顺手把清理跑一遍，确认不抛
    },
  }
  let 抛了 = ''
  try {
    mod.apply(ctx, { 启动延迟毫秒: 0, 自动唤醒: [] })
  } catch (e) {
    抛了 = e && e.message ? e.message : String(e)
  }
  说(抛了 === '', 'apply 在带服务的 ctx 下不抛', 抛了)
  for (const t of ['list_sessions', 'wake_session', 'session_task']) {
    说(工具.includes(t), '注册了工具 ' + t)
  }
  for (const p of ['/state', '/sessions', '/llm', '/save', '/test']) {
    说(路由.includes(mod.ROUTE + p), '注册了路由 ' + mod.ROUTE + p)
  }
  // apply 里是「发出去就不等」，给定时器一点时间把 0ms 的开机唤醒跑完
  await new Promise((r) => setTimeout(r, 60))
}

if (问题.length > 0) {
  console.log(`\napply 探针没过：${问题.length} 项`)
  process.exit(1)
}
console.log('\napply 探针通过')
process.exit(0)
