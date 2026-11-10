#!/usr/bin/env node
/**
 * selftest.mjs —— 离线自测：不碰真宿主，全用假 ctx / 假会话日志跑。
 *
 * 覆盖：
 *   归一 / 归一条目        配置白名单、去重、夹紧
 *   拼模型                 条目覆盖 vs 默认 vs 跟随 DSH
 *   尾八 / 认会话          完整 id、后 8 位、标题；标题撞车要报歧义
 *   抓答复                 只取「起」之后那几条 assistant/message 的 text 块
 *   会话任务              唤醒 → 投递 → 等跑完 → 取答复 的整条链路
 *   状态                  面板要看的字段齐不齐
 *
 * 用法：node scripts/selftest.mjs
 * 退出码：0 = 全过；1 = 有失败
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const 根 = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const m = await import(pathToFileURL(join(根, 'lib/index.js')).href)

let 过 = 0
const 失败 = []
function ok(名, 条件, 细节 = '') {
  if (条件) {
    过 += 1
    return
  }
  失败.push(名 + (细节 ? '：' + 细节 : ''))
  console.log('  ❌ ' + 名 + (细节 ? '：' + 细节 : ''))
}
const 等 = (a, b, 名) => ok(名, JSON.stringify(a) === JSON.stringify(b), `拿到 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`)

// ── 归一 / 归一条目 ────────────────────────────────────────────────────────
{
  ok('归一条目：空会话被丢掉', m.归一条目({ 提示词: 'hi' }) === null)
  const e = m.归一条目({ session: ' session-x ', 开: 'false', 思考强度: 'high' })
  ok('归一条目：认 session 别名', e && e.会话 === 'session-x', JSON.stringify(e))
  ok('归一条目：开=false 认', e && e.开 === false)

  const c = m.归一({
    开: 'false',
    自动唤醒: [{ 会话: 'a' }, { 会话: 'a', 提示词: 'x' }, { 会话: 'b' }],
    唤醒超时秒: 99999,
    启动延迟毫秒: -5,
  })
  等(c.自动唤醒.map((x) => x.会话), ['a', 'b'], '归一：同一间会话只留第一条')
  ok('归一：超时上限夹到 3600', c.唤醒超时秒 === 3600, String(c.唤醒超时秒))
  ok('归一：延迟下限夹到 0', c.启动延迟毫秒 === 0, String(c.启动延迟毫秒))
  ok('归一：开=false 认', c.开 === false)
}

// ── 拼模型 ─────────────────────────────────────────────────────────────────
{
  const 盘 = m.读默认模型()
  const 只默认 = m.拼模型({}, {})
  ok('拼模型：有 provider', typeof 只默认.provider === 'string' && 只默认.provider !== '')
  ok('拼模型：有 model', typeof 只默认.model === 'string' && 只默认.model !== '')
  const 条目盖 = m.拼模型({ provider: 'p1', model: 'm1', 思考强度: 'high' }, { provider: 'p0', model: 'm0', 思考强度: 'low' })
  等([条目盖.provider, 条目盖.model, 条目盖.reasoningEffort], ['p1', 'm1', 'high'], '拼模型：条目覆盖全局')
  const 落默认 = m.拼模型({ provider: '', model: '' }, { provider: 'p0', model: 'm0' })
  等([落默认.provider, 落默认.model], ['p0', 'm0'], '拼模型：空字段落回全局')
  ok('拼模型：DSH 默认模型读得到（或至少给硬默认）', 盘.provider !== undefined)
}

// ── 尾八 / 认会话 ──────────────────────────────────────────────────────────
{
  等(m.尾八('session-02b01e82-c126-4119-b1ad-6423b48db196'), 'b48db196', '尾八：取后 8 位')

  const 清单 = [
    { id: 'session-aaaa1111-0000-0000-0000-000000000001', 标题: '改 bug', live: true },
    { id: 'session-bbbb2222-0000-0000-0000-000000000002', 标题: '写文档', live: false },
    { id: 'session-cccc3333-0000-0000-0000-000000000003', 标题: '写文档', live: false },
  ]
  const ctx = { sessionQuery: { listSessions: async () => 清单 } }
  等((await m.认会话(ctx, 'session-aaaa1111-0000-0000-0000-000000000001')).id, 清单[0].id, '认会话：完整 id')
  等((await m.认会话(ctx, 'aaaa1111-0000-0000-0000-000000000001')).id, 清单[0].id, '认会话：去掉 session- 前缀')
  等((await m.认会话(ctx, '00000001')).id, 清单[0].id, '认会话：后 8 位')
  等((await m.认会话(ctx, '改 bug')).id, 清单[0].id, '认会话：标题')
  const 歧义 = await m.认会话(ctx, '写文档')
  ok('认会话：标题撞车要报歧义', 歧义.ok === false && Array.isArray(歧义.候选) && 歧义.候选.length === 2, JSON.stringify(歧义))
  ok('认会话：没给会话要报错', (await m.认会话(ctx, '')).ok === false)
}

// ── 抓答复 ─────────────────────────────────────────────────────────────────
{
  const 事件 = [
    { seq: 1, type: 'user/message', data: {} },
    { seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '旧答复' }] } } },
    { seq: 7, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '新答复一' }] } } },
    { seq: 8, type: 'tool/call', data: {} },
    { seq: 9, type: 'assistant/message', data: { message: { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '新答复二' }] } } },
  ]
  const ctx = { sessionQuery: { readSession: async () => ({ events: 事件 }) } }
  const r = await m.抓答复(ctx, 'x', 5)
  等(r.文本, '新答复一\n\n新答复二', '抓答复：只取起号之后的 text 块')
  等(r.段数, 2, '抓答复：段数')
  const 全 = await m.抓答复(ctx, 'x', -1)
  ok('抓答复：起号 -1 时全收', 全.文本.includes('旧答复') && 全.文本.includes('新答复二'))
  const 空 = await m.抓答复({}, 'x', 0)
  ok('抓答复：没有 sessionQuery 要老实说', 空.ok === false && 空.说 !== '')
}

// ── 会话任务：整条链路 ─────────────────────────────────────────────────────
{
  const 投进 = []
  const 事件 = [
    { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '动手前的旧话' }] } } },
    { seq: 12, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '干完了，改了三处' }] } } },
  ]
  const 假agent = {
    status: 'running',
    session: { seq: 12 },
    whenIdle: async () => {},
    followup: (msg) => 投进.push(msg.content[0].text),
  }
  const ctx = {
    logger: { info: () => {} },
    effect: (fn) => {
      const f = fn()
      if (typeof f !== 'function') throw new Error('effect 没返回函数')
    },
    agents: { get: () => undefined, resume: async () => ({ agent: 假agent }) },
    sessions: { get: () => ({ seq: 5 }), flush: async () => {} },
    sessionQuery: {
      listSessions: async () => [{ id: 'session-zzzz9999', 标题: '干活的会话', live: false }],
      readSession: async () => ({ events: 事件 }),
    },
  }
  m.apply(ctx, { 自动唤醒: [], 启动延迟毫秒: 0 })
  const r = await m.会话任务(ctx, { 会话: '干活的会话', 内容: '请把这三处改掉' })
  ok('会话任务：ok', r.ok === true, JSON.stringify({ 状态: r.状态, 说明: r.说明 }))
  等(r.状态, '跑完了', '会话任务：状态')
  等(投进, ['请把这三处改掉'], '会话任务：内容真的投进去了')
  等(r.答复, '干完了，改了三处', '会话任务：把答复带回来了')
}

// ── 状态 ───────────────────────────────────────────────────────────────────
{
  const s = m.状态({ 自动唤醒: [{ 会话: 'session-aaa', provider: 'p', model: 'mm' }] })
  ok('状态：有版本', typeof s.版本 === 'string' && s.版本 !== '')
  ok('状态：条目带算出来的模型', s.自动唤醒[0] && s.自动唤醒[0].模型 && s.自动唤醒[0].模型.model === 'mm', JSON.stringify(s.自动唤醒[0]))
  ok('状态：有配置路径', typeof s.配置 === 'string' && s.配置.endsWith('dsh-session-wake.json'))
}

console.log(`\n自测：${过} 项通过` + (失败.length ? `，${失败.length} 项失败` : ''))
process.exit(失败.length > 0 ? 1 : 0)
