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

// ── ③ 准入围栏：跨站 / DNS 重绑定要挡，本机同源要放 ────────────────────────
{
  const 处理 = new Map()
  const 清 = []
  const ctx = {
    logger: { info: () => {} },
    tools: { register: () => {} },
    webServer: { register: (opt) => (处理.set(opt.path, opt.handler), () => {}) },
    agents: { get: () => undefined, resume: async () => ({ agent: { status: 'idle', whenIdle: async () => {}, followup() {} } }) },
    sessionQuery: { listSessions: async () => [], readSession: async () => ({ events: [] }) },
    sessions: { get: () => undefined, flush: async () => {} },
    effect: (fn) => {
      const f = fn()
      if (typeof f === 'function') 清.push(f)
    },
  }
  mod.apply(ctx, { 启动延迟毫秒: 60000, 自动唤醒: [] })

  const 假res = () => {
    const 记 = { 码: 0, 体: '' }
    return {
      记,
      writeHead: (c) => {
        记.码 = c
      },
      end: (b) => {
        记.体 = String(b == null ? '' : b)
      },
      setHeader: () => {},
      getHeader: () => undefined,
      headersSent: false,
    }
  }
  const 打 = async (子, { method = 'GET', headers = {}, body = '' } = {}) => {
    const res = 假res()
    const h = 处理.get(mod.ROUTE + 子)
    if (typeof h !== 'function') return { 码: 0, 体: '没挂上' }
    const req = {
      method,
      headers,
      on: (ev, fn) => {
        if (ev === 'data' && body) fn(Buffer.from(body))
        if (ev === 'end') setImmediate(() => fn())
      },
    }
    h(req, res)
    await new Promise((r) => setTimeout(r, 30))
    return res.记
  }

  // 纯函数级的围栏规则
  说(mod.本地围栏({ headers: { host: '127.0.0.1:5128' } }) === 0, '围栏放行回环 Host')
  说(mod.本地围栏({ headers: { host: 'localhost:5128' } }) === 0, '围栏放行 localhost')
  说(mod.本地围栏({ headers: {} }) === 403, '围栏挡住没有 Host 的请求')
  说(mod.本地围栏({ headers: { host: 'evil.example:5128' } }) === 403, '围栏挡住非本机 Host（DNS 重绑定）')
  说(
    mod.本地围栏({ headers: { host: '127.0.0.1:5128', 'sec-fetch-site': 'cross-site' } }) === 403,
    '围栏挡住 sec-fetch-site: cross-site',
  )
  说(mod.本地围栏({ headers: { host: '127.0.0.1:5128', origin: 'http://evil.example' } }) === 403, '围栏挡住跨源 Origin')
  说(
    mod.本地围栏({ headers: { host: '127.0.0.1:5128', origin: 'http://127.0.0.1:5128' } }) === 0,
    '围栏放行同源 Origin',
  )
  说(mod.是JSON({ headers: { 'content-type': 'application/json; charset=utf-8' } }), 'isJSON 认 application/json')

  // 走到真实路由处理器上
  const 本机 = { host: '127.0.0.1:5128' }
  const r1 = await 打('/state', { headers: { ...本机, 'sec-fetch-site': 'same-origin' } })
  说(r1.码 === 200, '本机同源 GET /state 放行', String(r1.码))
  const r2 = await 打('/state', { headers: { host: 'evil.example:5128' } })
  说(r2.码 === 403, '跨站 Host 的 GET /state 被 403', String(r2.码))
  const r3 = await 打('/save', {
    method: 'POST',
    headers: { ...本机, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'a=1',
  })
  说(r3.码 === 415, '表单式 POST /save 被 415', String(r3.码))
  const r4 = await 打('/save', {
    method: 'POST',
    headers: { host: 'evil.example:5128', 'content-type': 'application/json' },
    body: '{}',
  })
  说(r4.码 === 403, '跨站 POST /save 被 403（写不进配置）', String(r4.码))
  const r5 = await 打('/save', {
    method: 'POST',
    headers: { ...本机, 'content-type': 'application/json' },
    body: '不是 JSON',
  })
  说(r5.码 === 400, '同源 JSON POST /save 放行到解析层', String(r5.码))

  for (const f of 清) {
    try {
      f()
    } catch {
      /* 清理不该抛 */
    }
  }
  await new Promise((r) => setTimeout(r, 20))
}

if (问题.length > 0) {
  console.log(`\napply 探针没过：${问题.length} 项`)
  process.exit(1)
}
console.log('\napply 探针通过')
process.exit(0)
