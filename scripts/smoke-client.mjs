#!/usr/bin/env node
/**
 * smoke-client.mjs —— 网页半边的静态冒烟（不启浏览器）
 *
 * 查的是「一眼就能定死的错」：
 *   · 括号/花括号数量对不对（少一个就是整块白屏）；
 *   · ModuleLoader id 是不是包名；
 *   · 路由前缀和宿主 ROUTE 一致，用到的每个接口宿主都注册了；
 *   · 有没有残留旧名字（qq-wake / QQ 绑定）；
 *   · 设置页该有的东西都在（总开关、加会话、保存、测一下、三个工具说明）。
 *
 * 用法：node scripts/smoke-client.mjs
 * 退出码：0 = 全过；1 = 有问题
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 根 = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const cli = readFileSync(join(根, 'lib/client.js'), 'utf8')
const idx = readFileSync(join(根, 'lib/index.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(根, 'package.json'), 'utf8'))

const 问题 = []
const 说 = (ok, 名, 细节 = '') => {
  if (!ok) 问题.push(名 + (细节 ? '：' + 细节 : ''))
}
const 数 = (s, ch) => s.split(ch).length - 1

说(pkg.name === 'dsh-session-wake', '包名', pkg.name)
说(cli.includes(`id: '${pkg.name}'`), 'ModuleLoader id 与包名一致')

const 圆 = 数(cli, '(') - 数(cli, ')')
const 方 = 数(cli, '[') - 数(cli, ']')
const 花 = 数(cli, '{') - 数(cli, '}')
说(圆 === 0, '圆括号配平', String(圆))
说(方 === 0, '方括号配平', String(方))
说(花 === 0, '花括号配平', String(花))

const 前缀 = (/const B = '([^']+)'/.exec(cli) || [])[1] || ''
说(前缀 === '/dsh-session-wake', 'client 侧路由前缀', 前缀)
说(idx.includes(`export const ROUTE = '${前缀}'`), 'host 侧 ROUTE 与 client 一致')

// 只看 client 自己那两个 fetch 帮手（get/post），别把 ctx.get('slots') 也算进来
const 用到 = [...cli.matchAll(/(?<![.\w])(?:get|post)\('([^']*)'/g)].map((m) => m[1].replace(/\?.*$/, ''))
for (const p of [...new Set(用到)]) {
  说(idx.includes(`route('${p}'`), `宿主注册了接口 ${p}`)
}

for (const 旧 of ['qq-wake', 'dsh-qq-wake', 'QQ 绑定', '跟随QQ绑定', 'qq-bridge']) {
  说(!cli.includes(旧), `client 里没有旧名字「${旧}」`)
  说(!idx.includes(`'${旧}'`), `host 里没有旧标识「${旧}」`)
}

for (const 词 of ['总开关', '加进来', '保存', '测一下', 'session_task', 'wake_session', 'list_sessions', '开机提示词']) {
  说(cli.includes(词), `设置页有「${词}」`)
}
说(cli.includes("slots.inject('settings.section'"), '注册了 settings.section')
说(/label: \(\) => '会话唤醒'/.test(cli), '设置项标题是「会话唤醒」')

if (问题.length > 0) {
  console.log('客户端冒烟没过：')
  for (const x of 问题) console.log('  ❌ ' + x)
  process.exit(1)
}
console.log('客户端冒烟通过（括号配平 / 路由对齐 / 无旧名字 / 关键控件齐全）')
process.exit(0)
