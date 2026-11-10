/**
 * dsh-session-wake — 让 DSH 的会话之间互相叫醒。
 *
 * 三件事：
 *   1. 开机自动唤醒：配置页里勾一个或几个对话，DSH 一启动就把它们提起来（可以顺手投一句话）。
 *   2. 每间会话单独指定 provider / model / 思考强度，互不影响。
 *   3. 给 AI 一个 session_task 工具：把当前对话的内容交给另一间会话去做，等它跑完再把答复取回来。
 *
 * 不依赖 QQ、不读任何桥的配置文件 —— 跟 dsh-qq-link 完全没有关系了。
 *
 * 几条踩过的坑（别改回去）：
 *   · apply 必须同步、且不返回任何值：返回 Promise / 对象都会被 cordis 判成
 *     `TypeError: Invalid effect`，整个 entry 不激活。
 *   · ctx.effect(() => ctx.webServer.register(...)) 也不行：register 的返回值不一定是函数
 *     （本机就不是），同样炸 Invalid effect。要手动收 unsubscribe，再交给一个确定返回函数的 effect。
 *   · 宿主服务可能比 apply 晚一步就绪 → 一律经 取服务() 读，失败就每秒补挂。
 *   · resume 必须带 provider/model，否则 agent 建起来但一跑就报 has no provider/model。
 *   · resume 还要 setup 里 agentPresets.mount()，否则没有预设装配，一轮都跑不动。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-session-wake'
export const version = '1.0.1'
export const inject = ['agents', 'webServer', 'tools']

// ── 宿主服务读取 ───────────────────────────────────────────────────────────

/** 宿主服务一律经这里读。
 *  直接写的 ctx.agents 在 dsh-market 的 apply 审计里会抛 `cannot get property "…" without inject`；
 *  包一层 try/catch 之后，探针上下文下只是「拿不到服务」，真宿主里照旧。 */
function 取服务(ctx, 名) {
  try {
    const 直接 = ctx ? ctx[名] : null
    if (直接) return 直接
  } catch {
    /* 审计探针 / 服务未注入：继续往下试 */
  }
  try {
    const 经由get = ctx && typeof ctx.get === 'function' ? ctx.get(名) : null
    if (经由get) return 经由get
  } catch {
    /* 连 get 都没有：当作拿不到 */
  }
  return null
}

const STATE_KEY = Symbol.for('dsh.session-wake.state')

/** 热重载会重新 import 这个模块：状态挂 globalThis，否则定时器会叠起来。 */
const state = (() => {
  const 空 = {
    timers: new Set(),
    handles: new Map(),
    cfg: null,
    ctx: null,
    gen: 0,
    woke: 0,
    failed: 0,
    lastNote: '',
    lastAt: 0,
    最近: [],
    booted: new Set(),
    面板补挂: null,
  }
  const 旧 = globalThis[STATE_KEY]
  const s = 旧 && typeof 旧 === 'object' ? 旧 : 空
  for (const k of Object.keys(空)) {
    if (s[k] === undefined || s[k] === null) s[k] = 空[k]
  }
  if (!(s.timers instanceof Set)) s.timers = new Set()
  if (!(s.handles instanceof Map)) s.handles = new Map()
  if (!Array.isArray(s.最近)) s.最近 = []
  if (!(s.booted instanceof Set)) s.booted = new Set()
  globalThis[STATE_KEY] = s
  return s
})()

function dshHome() {
  const env = process.env.DSH_HOME
  return env && env.trim() !== '' ? env : path.join(homedir(), '.dsh')
}

function 说(ctx, msg) {
  const line = `[session-wake] ${msg}`
  state.lastNote = msg
  try {
    const 源 = ctx || state.ctx
    if (源 && 源.logger && typeof 源.logger.info === 'function') {
      源.logger.info(line)
      return
    }
    if (源 && typeof 源.logger === 'function') {
      源.logger(line)
      return
    }
  } catch {
    /* 落到 console */
  }
  console.log(line)
}

function 短(id) {
  const s = String(id == null ? '' : id)
  return s.length <= 12 ? s : s.slice(-12)
}

// ── 默认模型 ───────────────────────────────────────────────────────────────

/** 从 profile 的 patch 层里抠 agent-default-model 的 provider/model —— 本机最权威的一处。 */
export function 读默认模型() {
  const 候选 = [
    path.join(dshHome(), 'profiles', 'desktop', 'cordis.patch.yml'),
    path.join(dshHome(), 'profiles', 'desktop', 'cordis.yml'),
  ]
  for (const file of 候选) {
    try {
      if (!existsSync(file)) continue
      const 文 = readFileSync(file, 'utf8')
      const 位 = 文.indexOf('agent-default-model')
      if (位 < 0) continue
      const 块 = 文.slice(位, 位 + 800)
      const p = /(?:^|\n)\s*provider:\s*['"]?([A-Za-z0-9_.:-]+)/.exec(块)
      const m = /(?:^|\n)\s*model:\s*['"]?([A-Za-z0-9_.:-]+)/.exec(块)
      const r = /(?:^|\n)\s*reasoningEffort:\s*['"]?([A-Za-z0-9_-]+)/.exec(块)
      if (p && m) return { provider: p[1], model: m[1], 思考强度: r ? r[1] : '', 来源: file }
    } catch {
      /* 换下一个候选 */
    }
  }
  return { provider: '', model: '', 思考强度: '', 来源: '' }
}

/** 某间会话该用的模型：条目自己填了就用条目的，没填就落回全局默认，再落回 DSH 的默认。 */
export function 拼模型(条目, 全局) {
  const a = 条目 && typeof 条目 === 'object' ? 条目 : {}
  const b = 全局 && typeof 全局 === 'object' ? 全局 : {}
  const 盘 = 读默认模型()
  const provider = String(a.provider || b.provider || '').trim() || 盘.provider || 'deepseek-account'
  const model = String(a.model || b.model || '').trim() || 盘.model || 'deepseek-flash'
  const out = { provider, model }
  const 强度 = String(a.思考强度 || b.思考强度 || '').trim() || 盘.思考强度 || ''
  if (强度 !== '') out.reasoningEffort = 强度
  return out
}

// ── 配置 ───────────────────────────────────────────────────────────────────

const DEFAULTS = {
  开: true,
  看日志: false,
  /** [{ 会话, 开, provider, model, 思考强度, 提示词 }] */
  自动唤醒: [],
  provider: '',
  model: '',
  思考强度: '',
  唤醒超时秒: 300,
  启动延迟毫秒: 1500,
}

export const ROUTE = '/dsh-session-wake'

export function 配置路径() {
  return path.join(dshHome(), 'dsh-session-wake.json')
}

function 夹紧(n, lo, hi, 缺) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 缺
  return Math.min(hi, Math.max(lo, x))
}

function 真(v, 缺) {
  if (v === undefined) return 缺
  return v !== false && v !== 'false' && v !== 0 && v !== '0'
}

/** 一条自动唤醒条目：会话 id 必须有；其余字段缺了就让位给全局默认。 */
export function 归一条目(源) {
  const s = 源 && typeof 源 === 'object' ? 源 : {}
  const 会话 = String(s.会话 || s.session || s.id || '').trim()
  if (会话 === '') return null
  return {
    会话,
    开: 真(s.开, true),
    provider: String(s.provider || '').trim(),
    model: String(s.model || '').trim(),
    思考强度: String(s.思考强度 || s.reasoningEffort || '').trim(),
    提示词: String(s.提示词 || s.prompt || '').trim(),
  }
}

/** 白名单合并：只认 DEFAULTS 那几项，数字夹紧，列表去重（同一间会话只留第一条）。 */
export function 归一(patch) {
  const 源 = patch && typeof patch === 'object' ? patch : {}
  const 表 = []
  const 见过 = new Set()
  if (Array.isArray(源.自动唤醒)) {
    for (const 一 of 源.自动唤醒) {
      const e = 归一条目(一)
      if (!e || 见过.has(e.会话)) continue
      见过.add(e.会话)
      表.push(e)
    }
  }
  return {
    开: 真(源.开, DEFAULTS.开),
    看日志: 真(源.看日志, DEFAULTS.看日志),
    自动唤醒: 表,
    provider: String(源.provider || '').trim(),
    model: String(源.model || '').trim(),
    思考强度: String(源.思考强度 || '').trim(),
    唤醒超时秒: 夹紧(源.唤醒超时秒, 5, 3600, DEFAULTS.唤醒超时秒),
    启动延迟毫秒: 夹紧(源.启动延迟毫秒, 0, 60000, DEFAULTS.启动延迟毫秒),
  }
}

export function 读配置() {
  const file = 配置路径()
  try {
    if (!existsSync(file)) return { ...DEFAULTS }
    return 归一({ ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) })
  } catch {
    return { ...DEFAULTS }
  }
}

export function 存配置(patch) {
  const 旧 = state.cfg || 读配置()
  const 送 = patch && typeof patch === 'object' ? patch : {}
  const 新 = 归一({ ...旧, ...送 })
  const file = 配置路径()
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(新, null, 2) + '\n', 'utf8')
  } catch (error) {
    return { ok: false, 说: `存不下：${error && error.message ? error.message : error}`, 配置: 新 }
  }
  state.cfg = 新
  return { ok: true, 说: '存好了', 配置: 新, 文件: file }
}

// ── 会话发现 ───────────────────────────────────────────────────────────────

/** 一间会话的短标识：去掉 session- 前缀取后 8 位。 */
export function 尾八(id) {
  const s = String(id == null ? '' : id).trim().replace(/^session-/, '')
  return s.slice(-8)
}

/** 列会话：优先 sessionQuery.listSessions()，退到 sessions.list()。都拿不到就回空表。 */
export async function 会话清单(ctx) {
  const q = 取服务(ctx, 'sessionQuery')
  let 原 = []
  if (q && typeof q.listSessions === 'function') {
    try {
      原 = await q.listSessions()
    } catch {
      原 = []
    }
  }
  if (!Array.isArray(原) || 原.length === 0) {
    const ses = 取服务(ctx, 'sessions')
    if (ses && typeof ses.list === 'function') {
      try {
        原 = ses.list()
      } catch {
        原 = []
      }
    }
  }
  /* 有的实现回 Map / 对象，统一成数组 */
  if (原 && !Array.isArray(原) && typeof 原 === 'object') {
    原 = typeof 原.values === 'function' ? Array.from(原.values()) : Object.values(原)
  }

  const 字 = (v) => (v === undefined || v === null ? '' : String(v).trim())
  const 行 = []
  for (const 一 of Array.isArray(原) ? 原 : []) {
    if (!一) continue
    /* 宿主的 entry 是 { header: { id, cwd, createdAt, … }, … }，兼容扁平的写法 */
    const h = 一.header && typeof 一.header === 'object' ? 一.header : {}
    const id = 字(h.id) || 字(一.id) || 字(一.sessionId) || 字(一.session)
    if (id === '') continue
    const 起 = Number(h.createdAt || 一.createdAt || 0)
    行.push({
      id,
      标题: 字(一.title) || 字(一.name) || 字(一.标题),
      live: 一.live === true || 一.live === false ? 一.live : 找活(ctx, id) !== undefined,
      工作目录: 字(h.cwd) || 字(一.cwd) || 字(一.workingDirectory),
      更新时间: 起 > 0 ? new Date(起).toISOString() : 字(一.updatedAt || 一.lastUpdatedAt),
    })
  }

  /* 标题另取：readTitleSnapshots 回的是 observation（fulfilled 才有 value.title.title） */
  const 缺 = 行.filter((x) => x.标题 === '').map((x) => x.id)
  if (缺.length > 0 && q && typeof q.readTitleSnapshots === 'function') {
    try {
      const 报 = await q.readTitleSnapshots(缺)
      const 表 = new Map()
      for (const o of Array.isArray(报) ? 报 : []) {
        const sid = 字(o && o.sessionId)
        if (sid === '') continue
        const t = o && o.status === 'fulfilled' ? 字(o.value && o.value.title && o.value.title.title) : ''
        if (t !== '') 表.set(sid, t)
      }
      for (const x of 行) {
        if (x.标题 === '' && 表.has(x.id)) x.标题 = 表.get(x.id)
      }
    } catch {
      /* 标题拿不到就不显示，不影响唤醒 */
    }
  }
  return 行
}

/** 用户/AI 给的会话引用 → 完整会话 id。认：完整 id、去掉 session- 的、尾巴 8 位、标题包含。 */
export async function 认会话(ctx, 输入) {
  const 原 = String(输入 == null ? '' : 输入).trim()
  if (原 === '') return { ok: false, 说: '没给会话' }
  const 清单 = await 会话清单(ctx)
  const 全 = 清单.map((x) => x.id)
  for (const id of 全) {
    if (id === 原) return { ok: true, id, 标题: (清单.find((x) => x.id === id) || {}).标题 || '' }
  }
  for (const id of 全) {
    const 去 = id.replace(/^session-/, '')
    if (去 === 原 || 去 === 原.replace(/^session-/, '')) return { ok: true, id, 标题: '' }
  }
  for (const id of 全) {
    if (尾八(id) === 尾八(原) && 尾八(原) !== '') return { ok: true, id, 标题: '' }
  }
  /* 只给 id 中间一段（比如 8 位前缀）也认，但必须唯一 */
  const 净 = 原.replace(/^session-/, '')
  if (净.length >= 4) {
    const 含 = 清单.filter((x) => x.id.includes(净))
    if (含.length === 1) return { ok: true, id: 含[0].id, 标题: 含[0].标题 }
  }
  const 候选 = 清单.filter((x) => x.标题 !== '' && (x.标题.includes(原) || 原.includes(x.标题)))
  if (候选.length === 1) return { ok: true, id: 候选[0].id, 标题: 候选[0].标题 }
  if (候选.length > 1) {
    return { ok: false, 说: `「${原}」对上 ${候选.length} 间会话，请给完整 id`, 候选: 候选.slice(0, 8).map((x) => ({ id: x.id, 标题: x.标题 })) }
  }
  // 清单拿不到时，直接把输入当 id 试
  return { ok: true, id: 原.startsWith('session-') ? 原 : 'session-' + 原, 标题: '' }
}

function 找活(ctx, id) {
  const 原 = String(id == null ? '' : id).trim()
  if (原 === '') return undefined
  const 候选 = [原]
  if (原.startsWith('session-')) 候选.push(原.slice('session-'.length))
  else 候选.push('session-' + 原)
  const agents = 取服务(ctx, 'agents')
  if (!agents || typeof agents.get !== 'function') return undefined
  for (const 一个 of 候选) {
    try {
      const a = agents.get(一个)
      if (a !== undefined) return a
    } catch {
      /* 有的实现会抛，当成没有 */
    }
  }
  return undefined
}

// ── 唤醒 / 投递 / 取答复 ───────────────────────────────────────────────────

function 造消息(文案, 来源 = 'external') {
  return {
    id: 'sw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    role: 'user',
    content: [{ type: 'text', text: String(文案) }],
    source: { kind: 来源 },
  }
}

/** 叫醒一间会话（活着就直接用），并把模型选项钉在 agent 上。 */
export async function 唤醒(ctx, id, 模型) {
  const 会话 = String(id == null ? '' : id).trim()
  if (会话 === '') return { ok: false, 状态: '没给会话 id', 原因: '没给会话 id' }
  const 已活 = 找活(ctx, 会话)
  if (已活 !== undefined) return { ok: true, 会话, agent: 已活, 状态: '活着' }

  const agents = 取服务(ctx, 'agents')
  if (!agents || typeof agents.resume !== 'function') {
    return { ok: false, 会话, 状态: '唤醒失败', 原因: '宿主没给 agents 服务' }
  }
  const 选项 = { resumeSessionId: 会话, agentOptions: 模型 && typeof 模型 === 'object' ? 模型 : 拼模型({}, state.cfg) }
  let 尾巴 = ''
  const presets = 取服务(ctx, 'agentPresets')
  if (presets && typeof presets.resolve === 'function' && typeof presets.mount === 'function') {
    try {
      const 预设 = await presets.resolve(undefined)
      选项.setup = async (agentCtx) => {
        await presets.mount(agentCtx, 预设.id)
      }
      尾巴 = '带预设装配 ' + 预设.id
    } catch {
      尾巴 = '预设装配没取到，只做裸唤醒'
    }
  } else {
    尾巴 = '没有 agentPresets 服务，只做裸唤醒'
  }
  try {
    const handle = await agents.resume(选项)
    state.handles.set(会话, handle)
    const agent = handle && handle.agent ? handle.agent : 找活(ctx, 会话)
    if (!agent) return { ok: false, 会话, 状态: '唤醒失败', 原因: 'resume 没给出 agent' }
    state.woke += 1
    state.最近.unshift({ at: new Date().toISOString(), 会话, 尾: 尾八(会话), 状态: '已唤醒', 尾巴 })
    if (state.最近.length > 20) state.最近.length = 20
    说(ctx, `唤醒成功 ${短(会话)}（${选项.agentOptions.provider}/${选项.agentOptions.model}${选项.agentOptions.reasoningEffort ? '·' + 选项.agentOptions.reasoningEffort : ''}）`)
    return { ok: true, 会话, agent, 状态: '已唤醒', 尾巴 }
  } catch (error) {
    state.failed += 1
    const 因 = error && error.message ? error.message : String(error)
    说(ctx, `唤醒失败 ${短(会话)}：${因}`)
    return { ok: false, 会话, 状态: '唤醒失败', 原因: 因 }
  }
}

/** 往一间（已经拿到的）agent 里投一句话，让它自己跑一轮。 */
export async function 投递(ctx, agent, 文案) {
  const 话 = 文案 == null ? '' : String(文案)
  if (agent === undefined || agent === null) return { ok: false, 说: '没拿到 agent' }
  try {
    agent.followup(造消息(话))
    const ses = 取服务(ctx, 'sessions')
    if (ses && typeof ses.flush === 'function') {
      try {
        await ses.flush(agent.session)
      } catch {
        /* 落盘失败不挡投递结果 */
      }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, 说: error && error.message ? error.message : String(error) }
  }
}

/** 当前这间会话已经到第几号事件了 —— 之后的事件才算「这次任务的产出」。 */
export async function 末号(ctx, id) {
  const live = 取服务(ctx, 'sessions')
  try {
    const s = live && typeof live.get === 'function' ? live.get(id) : null
    if (s && s.seq !== undefined && s.seq !== null) return Number(s.seq)
  } catch {
    /* 往下走 */
  }
  const q = 取服务(ctx, 'sessionQuery')
  if (q && typeof q.readSession === 'function') {
    try {
      const log = await q.readSession(id)
      const evs = Array.isArray(log && log.events) ? log.events : []
      let 最 = -1
      for (const e of evs) {
        const n = Number(e && e.seq)
        if (Number.isFinite(n) && n > 最) 最 = n
      }
      return 最
    } catch {
      /* 读不到就当 0 */
    }
  }
  return 0
}

/** 从那之后到现在，这间会话里助手说过的话（assistant/message 里的 text 块）。 */
export async function 抓答复(ctx, id, 起) {
  const q = 取服务(ctx, 'sessionQuery')
  if (!q || typeof q.readSession !== 'function') {
    return { ok: false, 文本: '', 说: '宿主没有 sessionQuery，取不回答复' }
  }
  let log
  try {
    log = await q.readSession(id)
  } catch (error) {
    return { ok: false, 文本: '', 说: `读会话失败：${error && error.message ? error.message : error}` }
  }
  const evs = Array.isArray(log && log.events) ? log.events : []
  const 段 = []
  for (const e of evs) {
    if (!e || e.type !== 'assistant/message') continue
    const n = Number(e.seq)
    if (Number.isFinite(起) && Number.isFinite(n) && n <= 起) continue
    const msg = e.data && e.data.message
    const 块 = Array.isArray(msg && msg.content) ? msg.content : []
    for (const b of 块) {
      if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') 段.push(b.text.trim())
    }
  }
  return { ok: true, 文本: 段.join('\n\n'), 段数: 段.length }
}

function 睡(ms) {
  return new Promise((r) => {
    const t = setTimeout(r, ms)
    if (typeof t.unref === 'function') t.unref()
  })
}

/** 等它把这轮跑完：先等它真的开始跑（最多 8 秒），再等 whenIdle。 */
async function 等跑完(agent, 毫秒) {
  const 开始 = Date.now()
  while (Date.now() - 开始 < 8000) {
    if (agent && agent.status === 'running') break
    await 睡(120)
  }
  const 余 = Math.max(2000, Number(毫秒) || 300000)
  const 结果 = await Promise.race([
    Promise.resolve(agent.whenIdle()).then(() => '跑完了').catch(() => '出错'),
    睡(余).then(() => '超时'),
  ])
  return { 结果, 用时秒: Math.round((Date.now() - 开始) / 100) / 10 }
}

/**
 * 把一件事交给另一间会话，等它做完把答复取回来。
 * 参：{ 会话, 内容, 等待秒?, provider?, model?, 思考强度? }
 */
export async function 会话任务(ctx, 参) {
  const a = 参 && typeof 参 === 'object' ? 参 : {}
  const 认 = await 认会话(ctx, a.会话)
  if (!认.ok) return { ok: false, 状态: '认不出会话', 说: 认.说 || '认不出会话', 候选: 认.候选 }
  const 全局 = state.cfg || 读配置()
  const 模型 = 拼模型({ provider: a.provider, model: a.model, 思考强度: a.思考强度 }, 全局)
  const 起 = await 末号(ctx, 认.id)
  const 醒 = await 唤醒(ctx, 认.id, 模型)
  if (!醒.ok) return { ok: false, 会话: 认.id, 标题: 认.标题, 状态: 醒.状态, 说: 醒.原因 || '' }
  const 内容 = String(a.内容 == null ? '' : a.内容)
  const 投 = await 投递(ctx, 醒.agent, 内容)
  if (!投.ok) return { ok: false, 会话: 认.id, 标题: 认.标题, 状态: '投递失败', 说: 投.说 || '' }
  const 等 = await 等跑完(醒.agent, 夹紧(a.等待秒, 5, 3600, 全局.唤醒超时秒) * 1000)
  const 答 = await 抓答复(ctx, 认.id, 起)
  说(ctx, `${短(认.id)} ${等.结果}（${等.用时秒}s，${答.段数 || 0} 段答复）`)
  return {
    ok: 等.结果 === '跑完了' && 答.ok,
    会话: 认.id,
    标题: 认.标题,
    状态: 等.结果,
    用时秒: 等.用时秒,
    答复: 答.文本 || '',
    说明: 答.ok ? '' : 答.说 || '',
  }
}

// ── 工具 ───────────────────────────────────────────────────────────────────

function 干净(v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(干净)
  const o = {}
  for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = 干净(v[k])
  return o
}

const 模型参数 = {
  provider: { type: 'string', description: '覆盖这次用的 provider（留空用该会话/全局默认）' },
  model: { type: 'string', description: '覆盖这次用的模型（留空用该会话/全局默认）' },
  思考强度: { type: 'string', description: '思考强度 id（如 low/medium/high，留空用默认）' },
}

function 注册工具(ctx) {
  const tools = 取服务(ctx, 'tools')
  if (!tools || typeof tools.register !== 'function') return false
  let 成了 = 0
  const 挂 = (def) => {
    try {
      tools.register(def)
      成了 += 1
    } catch (error) {
      说(ctx, `工具 ${def.name} 没挂上：${error && error.message ? error.message : error}`)
    }
  }

  挂({
    name: 'list_sessions',
    description: '列出这台机器上所有 DSH 会话（id、标题、是否活着），用于挑一个会话去唤醒或派活。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          会话: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, 标题: { type: 'string' }, live: { type: 'boolean' } },
            },
          },
        },
      },
      render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
    },
    async execute() {
      const 清单 = await 会话清单(state.ctx || ctx)
      return 干净({ ok: true, 会话: 清单.map((x) => ({ id: x.id, 标题: x.标题, live: x.live })) })
    },
  })

  挂({
    name: 'wake_session',
    description:
      '唤醒一间会话（给会话 id、id 尾巴 8 位或标题）。可以顺带投一句话让它开始干活，但不等它做完。要「派活并拿回结果」用 session_task。',
    parameters: {
      type: 'object',
      properties: {
        会话: { type: 'string', description: '完整 session id、后 8 位，或会话标题' },
        内容: { type: 'string', description: '要投给它的话；留空就只唤醒不投内容' },
        ...模型参数,
      },
      required: ['会话'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          会话: { type: 'string' },
          标题: { type: 'string' },
          状态: { type: 'string' },
          说明: { type: 'string' },
        },
      },
      render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
    },
    async execute(参) {
      const c = 参 && typeof 参 === 'object' ? 参 : {}
      const 认 = await 认会话(state.ctx || ctx, c.会话)
      if (!认.ok) return 干净({ ok: false, 状态: '认不出会话', 说明: 认.说 || '' })
      const 全局 = state.cfg || 读配置()
      const 醒 = await 唤醒(state.ctx || ctx, 认.id, 拼模型({ provider: c.provider, model: c.model, 思考强度: c.思考强度 }, 全局))
      if (!醒.ok) return 干净({ ok: false, 会话: 认.id, 标题: 认.标题, 状态: 醒.状态, 说明: 醒.原因 || '' })
      const 内容 = String(c.内容 == null ? '' : c.内容)
      if (内容.trim() === '') return 干净({ ok: true, 会话: 认.id, 标题: 认.标题, 状态: 醒.状态 })
      const 投 = await 投递(state.ctx || ctx, 醒.agent, 内容)
      return 干净({ ok: 投.ok, 会话: 认.id, 标题: 认.标题, 状态: 投.ok ? '已投递' : '投递失败', 说明: 投.说 || '' })
    },
  })

  挂({
    name: 'session_task',
    description:
      '把当前对话里的一件事交给另一间会话：唤醒它、把你的内容投进去、等它这轮跑完，然后把它的答复原文取回来。适合把子任务甩给专门的会话（例如让它去改代码、查资料）再把结果带回本对话。',
    parameters: {
      type: 'object',
      properties: {
        会话: { type: 'string', description: '完整 session id、后 8 位，或会话标题' },
        内容: { type: 'string', description: '要交给它的完整内容（背景 + 要求）；它会当作一句话收到' },
        等待秒: { type: 'number', description: '最多等多久（秒），默认用插件设置里的唤醒超时' },
        ...模型参数,
      },
      required: ['会话', '内容'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          会话: { type: 'string' },
          标题: { type: 'string' },
          状态: { type: 'string' },
          用时秒: { type: 'number' },
          答复: { type: 'string' },
          说明: { type: 'string' },
        },
      },
      render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
    },
    async execute(参) {
      return 干净(await 会话任务(state.ctx || ctx, 参))
    },
  })

  return 成了 > 0
}

// ── HTTP 路由（只给 DSH 自己的页面用） ─────────────────────────────────────

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let buf = ''
    let over = false
    req.on('data', (c) => {
      if (over) return
      buf += c
      if (buf.length > limit) {
        over = true
        buf = ''
      }
    })
    req.on('end', () => {
      if (over) return resolve(null)
      if (buf.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(buf))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

export async function llm快照(ctx) {
  const llm = 取服务(ctx, 'llm')
  if (!llm) return { ok: false, 说: '这个宿主没装 llm 服务', providers: [] }
  let 原始 = []
  try {
    原始 = typeof llm.listProviders === 'function' ? await llm.listProviders() : []
  } catch (error) {
    return { ok: false, 说: `listProviders 炸了：${error && error.message ? error.message : error}`, providers: [] }
  }
  const providers = []
  for (const 一 of Array.isArray(原始) ? 原始 : []) {
    const id = typeof 一 === 'string' ? 一 : String((一 && (一.id || 一.name || 一.provider)) || '')
    if (id === '') continue
    let 模型 = []
    try {
      模型 = await llm.listModels({ provider: id })
    } catch {
      try {
        模型 = await llm.listModels(id)
      } catch {
        模型 = []
      }
    }
    const 原始模型 = Array.isArray(模型) ? 模型 : []
    const 清 = []
    for (const m of 原始模型) {
      if (!m) continue
      if (typeof m === 'string') {
        清.push({ id: m, 名: m, 强度: [] })
        continue
      }
      const mid = String(m.id || m.name || m.model || '')
      if (mid === '') continue
      /* 思考强度不在这条清单里：得单独问 resolveModelInfo(provider, model).reasoning.efforts */
      let 强度 = []
      if (llm && typeof llm.resolveModelInfo === 'function') {
        try {
          const 详 = await llm.resolveModelInfo(id, mid)
          const 们 = 详 && 详.reasoning && Array.isArray(详.reasoning.efforts) ? 详.reasoning.efforts : []
          强度 = 们
            .map((e) => (typeof e === 'string' ? e : String((e && (e.id || e.name)) || '')))
            .filter(Boolean)
        } catch {
          强度 = []
        }
      }
      清.push({
        id: mid,
        名: String(m.label || m.displayName || m.name || mid),
        强度,
      })
    }
    providers.push({ id, models: 清 })
  }
  return { ok: true, 说: '', providers }
}

/** 面板上「测一下」：把配置里每一间挨个叫一遍，回明细。 */
export async function 测试(ctx, cfg) {
  const 实 = 归一({ ...DEFAULTS, ...(cfg || {}) })
  const 明细 = []
  for (const 条 of 实.自动唤醒) {
    if (条.开 === false) {
      明细.push({ 会话: 条.会话, 尾: 尾八(条.会话), 状态: '已停用', 模型: 拼模型(条, 实), 原因: '' })
      continue
    }
    const 模型 = 拼模型(条, 实)
    const r = await 唤醒(ctx, 条.会话, 模型)
    明细.push({ 会话: 条.会话, 尾: 尾八(条.会话), 状态: r.状态, 模型, 原因: r.原因 || '' })
  }
  const 败 = 明细.filter((x) => x.状态 === '唤醒失败').length
  return {
    ok: 明细.length > 0 && 败 === 0,
    at: new Date().toISOString(),
    条数: 明细.length,
    明细,
    说:
      明细.length === 0
        ? '还没配任何会话：在下面从会话列表里挑几个'
        : 败 === 0
          ? '都叫得动'
          : `${败} 间叫不醒，看下面的原因`,
  }
}

function 注册路由(ctx, quiet = false) {
  const web = 取服务(ctx, 'webServer')
  if (!web || typeof web.register !== 'function') {
    if (!quiet) console.warn('[dsh-session-wake] webServer 还没就绪，面板接口稍后再挂')
    return false
  }
  const 卸 = []
  const 收 = (r) => {
    if (typeof r === 'function') 卸.push(r)
    else if (r && typeof r.then === 'function') {
      r.then((f) => {
        if (typeof f === 'function') 卸.push(f)
      }).catch(() => {})
    }
  }
  const route = (子, handler) => {
    try {
      收(
        web.register({
          kind: 'exact',
          path: ROUTE + 子,
          handler: (req, res) => {
            Promise.resolve(handler(req, res)).catch((error) => {
              try {
                sendJson(res, 500, { ok: false, 说: String(error && error.message ? error.message : error) })
              } catch {
                /* 已经回过了 */
              }
            })
          },
        }),
      )
    } catch (error) {
      说(ctx, `路由 ${子} 挂不上：${error && error.message ? error.message : error}`)
    }
  }
  ctx.effect(() => () => {
    for (const f of 卸.splice(0)) {
      try {
        f()
      } catch {
        /* 已经不在 webServer 里了 */
      }
    }
  })

  route('/state', (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, 说: '只认 GET' })
    const 盘 = state.cfg || 读配置()
    sendJson(res, 200, { ...状态(盘), 配置: 盘, 文件: 配置路径(), 在跑: state.cfg || null })
  })

  route('/sessions', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, 说: '只认 GET' })
    const 清单 = await 会话清单(state.ctx || ctx)
    sendJson(res, 200, { ok: true, 会话: 清单 })
  })

  route('/llm', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, 说: '只认 GET' })
    const 快照 = await llm快照(state.ctx || ctx)
    sendJson(res, 200, { ...快照, 跟随DSH: 读默认模型(), 现在用的: 拼模型({}, state.cfg || 读配置()) })
  })

  route('/save', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, 说: '只认 POST' })
    const body = await readBody(req)
    if (!body) return sendJson(res, 400, { ok: false, 说: 'body 不是合法 JSON' })
    const r = 存配置(body)
    if (r.ok && state.ctx) {
      try {
        装配(state.ctx, r.配置)
      } catch (error) {
        r.说 = `存好了，但重装失败：${error && error.message ? error.message : error}`
      }
    }
    sendJson(res, r.ok ? 200 : 500, { ...r, 状态: 状态(r.配置) })
  })

  route('/test', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, 说: '只认 POST' })
    const body = (await readBody(req)) || {}
    const cfg = body && body.使用文件 === true ? 读配置() : state.cfg || 读配置()
    sendJson(res, 200, await 测试(state.ctx || ctx, cfg))
  })

  return true
}

/** 宿主服务偶尔比 apply 晚一步就绪：没挂上就每秒补挂，最多 30 次。 */
function 补挂(ctx, 试 = 0) {
  let 缺 = false
  if (!注册路由(ctx, 试 > 0)) 缺 = true
  if (!注册工具(ctx)) 缺 = true
  if (!缺) return
  if (试 >= 30) {
    console.warn('[dsh-session-wake] 30 秒内宿主服务一直没就绪：面板/工具没挂全，唤醒照常工作')
    return
  }
  const t = setTimeout(() => {
    state.timers.delete(t)
    补挂(ctx, 试 + 1)
  }, 1000)
  if (typeof t.unref === 'function') t.unref()
  state.timers.add(t)
}

// ── 生命周期 ───────────────────────────────────────────────────────────────

function 停() {
  for (const t of state.timers) {
    try {
      clearTimeout(t)
      clearInterval(t)
    } catch {
      /* 已经清过了 */
    }
  }
  state.timers.clear()
}

/** 开机自动唤醒：每间一条，顺带把「提示词」投进去（没有就只唤醒）。 */
async function 开机唤醒(ctx, cfg) {
  for (const 条 of cfg.自动唤醒) {
    if (条.开 === false) continue
    const 键 = 条.会话 + '|' + (条.提示词 || '')
    if (state.booted.has(键)) continue
    state.booted.add(键)
    const 模型 = 拼模型(条, cfg)
    const r = await 唤醒(ctx, 条.会话, 模型)
    if (!r.ok) continue
    if (条.提示词 !== '') {
      const 投 = await 投递(ctx, r.agent, 条.提示词)
      说(ctx, 投.ok ? `已给 ${短(条.会话)} 投了提示词` : `投提示词失败 ${短(条.会话)}：${投.说}`)
    }
  }
  state.lastAt = Date.now()
}

/** 装配一轮：清定时器、按配置排开机唤醒。apply 和面板保存都走这里。 */
function 装配(ctx, cfg) {
  停()
  state.cfg = cfg
  state.ctx = ctx
  if (cfg.开 === false) {
    说(ctx, '没开（开: false），什么都不做')
    return
  }
  if (cfg.自动唤醒.length === 0) {
    说(ctx, '还没配自动唤醒的会话')
    return
  }
  const 延迟 = Math.max(0, Number(cfg.启动延迟毫秒) || 0)
  const t = setTimeout(() => {
    state.timers.delete(t)
    开机唤醒(ctx, cfg).catch((error) => {
      说(ctx, `开机唤醒出错：${error && error.message ? error.message : error}`)
    })
  }, 延迟)
  if (typeof t.unref === 'function') t.unref()
  state.timers.add(t)
  说(ctx, `已排队：${cfg.自动唤醒.length} 间会话，${延迟}ms 后叫醒`)
}

export function apply(ctx, config) {
  const cfg = 归一({ ...读配置(), ...(config || {}) })
  // 热重载时新实例先 apply、旧实例后 cleanup，state 却在同一份 globalThis 上；
  // 用代际号挡住旧 cleanup 把新一代的定时器掐掉。
  const 我这一代 = (state.gen = (Number(state.gen) || 0) + 1)
  state.ctx = ctx
  state.cfg = cfg
  装配(ctx, cfg)
  补挂(ctx)
  try {
    ctx.effect(() => () => {
      if (state.gen === 我这一代) 停()
    })
  } catch {
    /* 探针 ctx：清理挂不上就算了 */
  }
  // ⚠ 这里必须同步、且不返回任何值（见文件头注释）。
}

export function 状态(cfg) {
  const 实 = 归一({ ...DEFAULTS, ...(cfg || {}) })
  return {
    ok: true,
    版本: version,
    开: 实.开 !== false,
    自动唤醒: 实.自动唤醒.map((条) => ({ ...条, 模型: 拼模型(条, 实) })),
    默认模型: 拼模型({}, 实),
    唤醒超时秒: 实.唤醒超时秒,
    启动延迟毫秒: 实.启动延迟毫秒,
    唤醒过: state.woke,
    失败过: state.failed,
    最近: state.最近.slice(0, 10),
    最后一句: state.lastNote,
    配置: 配置路径(),
  }
}

export const __internals = {
  DEFAULTS,
  取服务,
  找活,
  造消息,
  等跑完,
  会话任务,
  抓答复,
  末号,
  llm快照,
  注册路由,
  注册工具,
}
