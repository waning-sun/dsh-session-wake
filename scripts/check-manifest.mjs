#!/usr/bin/env node
/**
 * check-manifest.mjs —— 插件清单体检（0 依赖，纯 Node）
 *
 * 管这几件事：
 *   ① package.json 有没有 BOM / 是不是合法 UTF-8 / JSON 能不能解析 / 有没有双层乱码；
 *   ② 版本号：package.json 与 lib/index.js 的 `export const version` 必须一致；
 *   ③ 名字：清单 name、client.js 的 ModuleLoader id、cordis.patch.yml 的 name 三处一致；
 *   ④ 必带文件在不在（lib/、README.md、cordis.patch.yml、LICENSE）；
 *   ⑤ DSH 认的字段：engines.node / engines.dsh、dsh.bundle.patch、dsh.client；
 *   ⑥ README 有没有 `## Requirements` 段（dsh-market 索引校验要看）。
 *
 * 用法：node scripts/check-manifest.mjs [插件目录]
 * 退出码：0 = 全过；1 = 有问题（发版前卡一道）
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 根 = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'))
const 问题 = []
const 过 = []
const 说 = (ok, 名, 细节 = '') => (ok ? 过.push(名) : 问题.push(名 + (细节 ? '：' + 细节 : '')))

function 读(p) {
  try {
    return { ok: true, buf: readFileSync(p) }
  } catch (e) {
    return { ok: false, err: e.message }
  }
}

// ── ① package.json ─────────────────────────────────────────────────────────
const pkg文 = 读(join(根, 'package.json'))
if (!pkg文.ok) {
  console.error('读不到 package.json：' + pkg文.err)
  process.exit(1)
}
const buf = pkg文.buf
说(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), 'package.json 无 BOM')
let 文本 = ''
try {
  文本 = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  说(true, 'package.json 是合法 UTF-8')
} catch (e) {
  说(false, 'package.json 是合法 UTF-8', e.message)
}
说(!/锟斤拷|鑰佹|锛|鈥/.test(文本), 'package.json 无双层乱码')

let pkg = null
try {
  pkg = JSON.parse(文本)
  说(true, 'package.json JSON 可解析')
} catch (e) {
  说(false, 'package.json JSON 可解析', e.message)
}
if (!pkg) {
  收尾()
}

// ── ③ 名字三处一致 ─────────────────────────────────────────────────────────
const 名 = String(pkg.name || '')
说(名 === 'dsh-session-wake', '清单名是 dsh-session-wake', 名)
const idx = 读(join(根, 'lib/index.js'))
const idx文 = idx.ok ? idx.buf.toString('utf8') : ''
const cli = 读(join(根, 'lib/client.js'))
const cli文 = cli.ok ? cli.buf.toString('utf8') : ''
const patch = 读(join(根, 'cordis.patch.yml'))
const patch文 = patch.ok ? patch.buf.toString('utf8') : ''

说(new RegExp(`export const name = '${名}'`).test(idx文), 'index.js 的 name 与清单一致', 名)
说(cli文.includes(`id: '${名}'`), 'client.js 的 ModuleLoader id 与清单一致', 名)
说(new RegExp(`name: '${名}'`).test(patch文), 'cordis.patch.yml 的 name 与清单一致', 名)

// ── ② 版本 ─────────────────────────────────────────────────────────────────
const 码版本 = (/export const version = '([^']+)'/.exec(idx文) || [])[1] || ''
说(码版本 !== '' && 码版本 === pkg.version, '版本号与 index.js 一致', `清单 ${pkg.version} / 代码 ${码版本 || '（没找到）'}`)
说(/export const version = '/.test(idx文), 'index.js 导出了 version')

// ── ④ 必带文件 ─────────────────────────────────────────────────────────────
for (const f of ['lib/index.js', 'lib/client.js', 'README.md', 'cordis.patch.yml', 'LICENSE']) {
  const p = join(根, f)
  说(existsSync(p) && statSync(p).size > 0, '有文件 ' + f)
}
for (const f of ['lib', 'scripts', 'README.md', 'cordis.patch.yml', 'LICENSE']) {
  说(Array.isArray(pkg.files) && pkg.files.includes(f), 'files 里登记了 ' + f)
}

// ── ⑤ DSH 字段 ─────────────────────────────────────────────────────────────
说(!!(pkg.engines && pkg.engines.node), 'engines.node 有值')
说(!!(pkg.engines && pkg.engines.dsh), 'engines.dsh 有值', 'dsh-market 索引校验会看这个')
说(!!(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch), 'dsh.bundle.patch 指向 cordis.patch.yml')
说(!!(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web'), 'dsh.client.platform 是 web')
说(
  Array.isArray(pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject) && pkg.dsh.client.inject.includes('slots'),
  'dsh.client.inject 里带 slots',
)
说(pkg.type === 'module', 'type 是 module（ESM）')
说(/^\.?\/?lib\/index\.js$/.test(String(pkg.main || '')), 'main 指向 lib/index.js', String(pkg.main))

// ── ⑥ README ───────────────────────────────────────────────────────────────
const rd = 读(join(根, 'README.md'))
const rd文 = rd.ok ? rd.buf.toString('utf8') : ''
说(/^##\s+Requirements/m.test(rd文), 'README 有 ## Requirements 段')
说(/engines\.dsh|>=0\.2\.1-rc/.test(rd文), 'README 写了宿主版本要求')
说(rd文.includes('session_task'), 'README 写到了 session_task 工具')

// ── 客户端静态约束（最容易一把白屏的地方） ─────────────────────────────────
说(cli文.includes("slots.inject('settings.section'"), 'client.js 注册了 settings.section')
const 组件段 = cli文.slice(cli文.indexOf('function Section()'))
const 首个Hook = 组件段.search(/React\.use[A-Z]/)
const 早退 = 组件段.search(/\n\s*(if\s*\(.*\)\s*return)|(return\s+h\()/)
说(首个Hook === -1 || 早退 === -1 || 首个Hook < 早退, '组件里 hook 排在 early return 之前')

收尾()

function 收尾() {
  for (const x of 过) console.log('  ✅ ' + x)
  for (const x of 问题) console.log('  ❌ ' + x)
  if (问题.length > 0) {
    console.log(`\n清单体检没过：${问题.length} 项`)
    process.exit(1)
  }
  console.log(`\n清单体检通过：${过.length} 项`)
  process.exit(0)
}
