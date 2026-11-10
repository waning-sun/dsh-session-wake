// dsh-session-wake · 网页半边
//
// 在 **设置 → 会话唤醒** 里：
//   · 开/关、默认模型（provider / model / 思考强度）
//   · 从会话列表里挑一个或几个，勾上「开机自动唤醒」
//   · 每一条都能单独指定模型与思考强度，还可以带一句开机提示词
//   · 点「测一下」把每一条真叫一遍，看是不是都叫得动
//
// 这里不碰会话本身、不碰日志 —— 只往宿主那几条 /dsh-session-wake/* 路由上读写。

window.__ModuleLoader__.load({
  id: 'dsh-session-wake',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']

    const B = '/dsh-session-wake'
    const get = (p) =>
      fetch(B + p, { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null)
    const post = (p, body) =>
      fetch(B + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
        .then((r) => r.json())
        .catch(() => null)

    const h = React.createElement

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.65 },
      card: { border: '1px solid rgba(128,128,128,.28)', borderRadius: 10, padding: '12px 14px' },
      h: { fontSize: 13.5, fontWeight: 600, marginBottom: 6, letterSpacing: '.01em' },
      hint: { opacity: 0.66, fontSize: 12, lineHeight: 1.6 },
      row: { display: 'flex', alignItems: 'center', gap: 10, margin: '7px 0', flexWrap: 'wrap' },
      lab: { width: 132, flex: '0 0 auto', opacity: 0.84 },
      grid3: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 10,
        margin: '10px 0 0',
        padding: '10px 12px',
        borderRadius: 9,
        background: 'rgba(128,128,128,.07)',
      },
      grid2: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 10,
        margin: '10px 0 0',
      },
      field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
      flab: { fontSize: 11.5, letterSpacing: '.04em', opacity: 0.6, textTransform: 'uppercase' },
      fsel: {
        width: '100%',
        padding: '6px 8px',
        border: '1px solid rgba(128,128,128,.35)',
        borderRadius: 7,
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        fontFamily: 'inherit',
      },
      input: {
        flex: '1 1 200px',
        minWidth: 0,
        padding: '5px 8px',
        border: '1px solid rgba(128,128,128,.35)',
        borderRadius: 7,
        background: 'transparent',
        color: 'inherit',
        fontSize: 13,
        fontFamily: 'inherit',
      },
      select: {
        flex: '1 1 150px',
        minWidth: 0,
        padding: '5px 8px',
        border: '1px solid rgba(128,128,128,.35)',
        borderRadius: 7,
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        fontFamily: 'inherit',
      },
      area: {
        width: '100%',
        minHeight: 54,
        padding: '6px 8px',
        border: '1px solid rgba(128,128,128,.35)',
        borderRadius: 7,
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        fontFamily: 'ui-monospace,Consolas,monospace',
        resize: 'vertical',
      },
      btn: {
        padding: '6px 14px',
        border: '1px solid rgba(128,128,128,.4)',
        borderRadius: 8,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'inherit',
      },
      btnOn: { borderColor: '#41d392', color: '#41d392' },
      btnDel: { borderColor: 'rgba(240,112,95,.5)', color: '#f0705f', padding: '3px 9px', fontSize: 12 },
      ok: { color: '#41d392' },
      bad: { color: '#f0705f' },
      warn: { color: '#f5c451' },
      kv: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 14px', fontSize: 12.5 },
      k: { opacity: 0.62 },
      mono: { fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 12 },
      log: {
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontFamily: 'ui-monospace,Consolas,monospace',
        fontSize: 11.5,
        opacity: 0.78,
        maxHeight: 200,
        overflow: 'auto',
      },
      tag: {
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid currentColor',
        fontSize: 11.5,
        lineHeight: 1.5,
      },
      item: {
        border: '1px solid rgba(128,128,128,.22)',
        borderRadius: 9,
        padding: '9px 11px',
        marginTop: 8,
      },
      itemHead: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      grow: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    }

    const 空配 = {
      开: true,
      自动唤醒: [],
      provider: '',
      model: '',
      思考强度: '',
      唤醒超时秒: 300,
      启动延迟毫秒: 1500,
    }

    function 短(id) {
      const s = String(id || '')
      return s.length <= 14 ? s : '…' + s.slice(-12)
    }

    /** 从 llm 快照里取某个 provider 的模型清单（provider 留空 = 按现在生效的那个列）。 */
    function 模型表(llm, provider) {
      const 真 = provider || String((llm && llm.现在用的 && llm.现在用的.provider) || '')
      const p = (llm && Array.isArray(llm.providers) ? llm.providers : []).find((x) => x.id === 真)
      return p && Array.isArray(p.models) ? p.models : []
    }

    function 强度表(llm, provider, model) {
      const want = String(model || '')
      if (want === '') return []
      const 挑 = (m) => (m && Array.isArray(m.强度) ? m.强度 : [])
      if (provider) {
        const hit = 模型表(llm, provider).find((x) => x.id === want)
        return 挑(hit)
      }
      // 没指定 provider：在全部 provider 里按模型 id 找一份带强度的
      const 全 = (llm && Array.isArray(llm.providers) ? llm.providers : [])
      for (const p of 全) {
        const m = (p.models || []).find((x) => x.id === want)
        const 们 = 挑(m)
        if (们.length > 0) return 们
      }
      const 先 = 模型表(llm, '').find((x) => x.id === want)
      return 挑(先)
    }

    function 选择(props) {
      // 统一的小下拉：空值 = 用默认
      return h(
        'select',
        {
          style: props.style || S.select,
          value: props.value || '',
          disabled: props.disabled,
          onChange: (e) => props.onChange(e.target.value),
          title: props.title || '',
        },
        h('option', { value: '' }, props.空 || '（用默认）'),
        (props.options || []).map((o) =>
          h('option', { key: o.value, value: o.value }, o.label),
        ),
      )
    }

    function Section() {
      // ⚠ 所有 hook 必须排在任何 early return / 条件之前，否则 React #310 会把整个设置面板搞白。
      const [盘, set盘] = React.useState(null)
      const [草, set草] = React.useState(null)
      const [会话表, set会话表] = React.useState([])
      const [llm, setLlm] = React.useState({ providers: [] })
      const [测, set测] = React.useState(null)
      const [忙, set忙] = React.useState('')
      const [提, set提] = React.useState('')
      const [新会话, set新会话] = React.useState('')

      const 刷 = React.useCallback(() => {
        get('/state').then((r) => {
          if (!r) return
          set盘(r)
          set草((旧) => 旧 || { ...空配, ...(r.配置 || {}) })
        })
        get('/sessions').then((r) => {
          if (r && Array.isArray(r.会话)) set会话表(r.会话)
        })
        get('/llm').then((r) => {
          if (r && Array.isArray(r.providers)) setLlm(r)
        })
      }, [])

      React.useEffect(() => {
        刷()
      }, [刷])

      const 配置 = 草 || { ...空配 }
      const 条目们 = Array.isArray(配置.自动唤醒) ? 配置.自动唤醒 : []
      const providers = (llm.providers || []).map((p) => ({ value: p.id, label: p.id }))
      // 「跟 DSH 默认」时，模型/强度下拉要按实际生效的那一套去列，否则列表永远空着。
      const 现在用的 = llm.现在用的 || {}
      const 有效provider = 配置.provider || String(现在用的.provider || '')
      const 有效model = 配置.model || String(现在用的.model || '')
      const 模型们 = 模型表(llm, 有效provider)
      const 强度们 = 强度表(llm, 有效provider, 有效model)
      const 现在生效 =
        [有效provider || '—', 有效model || '—'].join(' / ') +
        (配置.思考强度 || 现在用的.reasoningEffort ? '　·　强度 ' + String(配置.思考强度 || 现在用的.reasoningEffort) : '')

      const 改 = (patch) => set草((旧) => ({ ...(旧 || 空配), ...patch }))
      const 改条 = (i, patch) =>
        set草((旧) => {
          const 基 = { ...(旧 || 空配) }
          const 表 = Array.isArray(基.自动唤醒) ? [...基.自动唤醒] : []
          表[i] = { ...(表[i] || {}), ...patch }
          基.自动唤醒 = 表
          return 基
        })
      const 删条 = (i) =>
        set草((旧) => {
          const 基 = { ...(旧 || 空配) }
          const 表 = Array.isArray(基.自动唤醒) ? [...基.自动唤醒] : []
          表.splice(i, 1)
          基.自动唤醒 = 表
          return 基
        })
      const 加条 = (id) => {
        const 真 = String(id || '').trim()
        if (真 === '') return
        if (条目们.some((x) => x.会话 === 真)) {
          set提('这间已经在列表里了')
          return
        }
        set草((旧) => {
          const 基 = { ...(旧 || 空配) }
          基.自动唤醒 = [...(Array.isArray(基.自动唤醒) ? 基.自动唤醒 : []), { 会话: 真, 开: true, provider: '', model: '', 思考强度: '', 提示词: '' }]
          return 基
        })
        set新会话('')
      }

      const 存 = () => {
        set忙('save')
        set提('')
        post('/save', 配置)
          .then((r) => {
            set忙('')
            if (!r) {
              set提('保存失败：没拿到响应')
              return
            }
            set提(r.说 || (r.ok ? '存好了' : '没存上'))
            if (r.配置) set草({ ...空配, ...r.配置 })
            if (r.状态) set盘((旧) => ({ ...(旧 || {}), ...r.状态 }))
          })
          .catch((e) => {
            set忙('')
            set提('保存失败：' + (e && e.message ? e.message : e))
          })
      }

      const 试 = () => {
        set忙('test')
        set测(null)
        post('/test', { 使用文件: false })
          .then((r) => {
            set忙('')
            set测(r)
          })
          .catch((e) => {
            set忙('')
            set测({ ok: false, 说: '测试失败：' + (e && e.message ? e.message : e) })
          })
      }

      const 状态 = 盘 || {}
      const 标题表 = React.useMemo(() => {
        const m = {}
        for (const x of 会话表) if (x && x.id) m[x.id] = x.标题 || ''
        return m
      }, [会话表])

      return h(
        'div',
        { style: S.wrap },

        // ── 状态 ─────────────────────────────────────────────
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('div', { style: { ...S.h, marginBottom: 0 } }, '会话唤醒'),
            h('span', { style: { ...S.tag, ...(状态.开 === false ? S.bad : S.ok) } }, 状态.开 === false ? '已停用' : '在跑'),
            h('span', { style: { ...S.hint, marginLeft: 'auto' } }, 'v' + String(状态.版本 || '?')),
          ),
          h(
            'div',
            { style: S.hint },
            'DSH 一启动就把勾上的会话叫醒；每一条可以单独指定模型与思考强度。AI 还能用 session_task 把活派给别的会话、等它做完再把答复取回来。',
          ),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '总开关'),
            h(
              'label',
              { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
              h('input', {
                type: 'checkbox',
                checked: 配置.开 !== false,
                onChange: (e) => 改({ 开: e.target.checked }),
              }),
              '开',
            ),
            h('span', { style: S.hint }, '关掉之后既不自动唤醒，也不注册工具'),
          ),
          h(
            'div',
            { style: S.kv },
            h('span', { style: S.k }, '配置文件'),
            h('span', { style: S.mono }, String(状态.文件 || 状态.配置 || '~/.dsh/dsh-session-wake.json')),
            h('span', { style: S.k }, '唤醒过 / 失败'),
            h('span', null, String(状态.唤醒过 || 0) + ' / ' + String(状态.失败过 || 0)),
            h('span', { style: S.k }, '最后一句'),
            h('span', { style: S.mono }, String(状态.最后一句 || '—')),
          ),
        ),

        // ── 默认模型 ─────────────────────────────────────────
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { ...S.h, marginBottom: 0 } }, '默认模型'),
            h('span', { style: S.hint }, '没单独指定的会话都用这套'),
            h('span', { style: { ...S.hint, marginLeft: 'auto' } }, '现在生效：' + 现在生效),
          ),
          h(
            'div',
            { style: S.grid3 },
            h(
              'div',
              { style: S.field },
              h('span', { style: S.flab }, 'provider'),
              选择({
                style: S.fsel,
                value: 配置.provider,
                options: providers,
                空: '跟 DSH 默认',
                onChange: (v) => 改({ provider: v, model: '', 思考强度: '' }),
              }),
            ),
            h(
              'div',
              { style: S.field },
              h('span', { style: S.flab }, 'model'),
              选择({
                style: S.fsel,
                value: 配置.model,
                options: 模型们.map((m) => ({ value: m.id, label: m.名 || m.id })),
                空: 配置.provider ? '跟这个 provider 默认' : '跟 DSH 默认',
                onChange: (v) =>
                  改({
                    model: v,
                    思考强度: '',
                    provider: v ? 配置.provider || 有效provider : 配置.provider,
                  }),
              }),
            ),
            h(
              'div',
              { style: S.field },
              h('span', { style: S.flab }, '思考强度'),
              选择({
                style: S.fsel,
                value: 配置.思考强度,
                options: 强度们.map((x) => ({ value: x, label: x })),
                空: 强度们.length === 0 ? '这个模型没有可调强度' : '跟模型默认',
                disabled: 强度们.length === 0,
                onChange: (v) =>
                  改({
                    思考强度: v,
                    provider: 配置.provider || 有效provider,
                    model: 配置.model || 有效model,
                  }),
              }),
            ),
          ),
          h(
            'div',
            { style: S.grid2 },
            h(
              'div',
              { style: S.field },
              h('span', { style: S.flab }, '启动后延迟（毫秒）'),
              h('input', {
                style: S.fsel,
                type: 'number',
                min: 0,
                max: 60000,
                value: 配置.启动延迟毫秒,
                onChange: (e) => 改({ 启动延迟毫秒: Number(e.target.value) }),
              }),
            ),
            h(
              'div',
              { style: S.field },
              h('span', { style: S.flab }, '等答复上限（秒）'),
              h('input', {
                style: S.fsel,
                type: 'number',
                min: 5,
                max: 3600,
                value: 配置.唤醒超时秒,
                onChange: (e) => 改({ 唤醒超时秒: Number(e.target.value) }),
              }),
            ),
          ),
          h(
            'div',
            { style: { ...S.hint, marginTop: 8 } },
            providers.length === 0
              ? '宿主没报 provider 清单（ctx.llm 拿不到），可以先手填：把 provider / model 直接写进下面每条的输入框。'
              : '三项全留空 = 跟 DSH 自己的 agent-default-model 走；单条会话的模型优先于这里。',
          ),
        ),

        // ── 自动唤醒列表 ─────────────────────────────────────
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { ...S.h, marginBottom: 0 } }, '开机自动唤醒（' + 条目们.length + '）'),
            h('span', { style: { ...S.hint, marginLeft: 'auto' } }, 会话表.length + ' 间会话可用'),
          ),
          h(
            'div',
            { style: S.row },
            选择({
              value: 新会话,
              options: 会话表.map((x) => ({
                value: x.id,
                label: (x.标题 || 短(x.id)) + '　' + 短(x.id) + (x.live ? '　●在线' : ''),
              })),
              空: '选一个会话…',
              onChange: (v) => set新会话(v),
            }),
            h(
              'button',
              { style: S.btn, disabled: !新会话, onClick: () => 加条(新会话) },
              '加进来',
            ),
            h(
              'button',
              { style: S.btn, onClick: 刷, title: '重新拉会话列表' },
              '刷新列表',
            ),
          ),
          条目们.length === 0
            ? h('div', { style: S.hint }, '还没有。上面挑一个会话加进来，DSH 下次启动就会把它叫醒。')
            : 条目们.map((条, i) => {
                const 模型 = 模型表(llm, 条.provider)
                const 强度 = 强度表(llm, 条.provider, 条.model)
                return h(
                  'div',
                  { key: 条.会话 + '#' + i, style: S.item },
                  h(
                    'div',
                    { style: S.itemHead },
                    h('input', {
                      type: 'checkbox',
                      checked: 条.开 !== false,
                      title: '这条要不要生效',
                      onChange: (e) => 改条(i, { 开: e.target.checked }),
                    }),
                    h(
                      'span',
                      { style: S.grow, title: 条.会话 },
                      标题表[条.会话] || '（没在会话列表里）',
                      h('span', { style: { ...S.hint, marginLeft: 8 } }, 短(条.会话)),
                    ),
                    h('button', { style: { ...S.btn, ...S.btnDel }, onClick: () => 删条(i) }, '移除'),
                  ),
                  h(
                    'div',
                    { style: S.row },
                    选择({
                      value: 条.provider,
                      options: providers,
                      空: 'providers：用默认',
                      onChange: (v) => 改条(i, { provider: v, model: '', 思考强度: '' }),
                    }),
                    选择({
                      value: 条.model,
                      options: 模型.map((m) => ({ value: m.id, label: m.名 || m.id })),
                      空: 'model：用默认',
                      onChange: (v) => 改条(i, { model: v, 思考强度: '' }),
                    }),
                    选择({
                      value: 条.思考强度,
                      options: 强度.map((x) => ({ value: x, label: x })),
                      空: '强度：用默认',
                      onChange: (v) => 改条(i, { 思考强度: v }),
                    }),
                  ),
                  h('textarea', {
                    style: S.area,
                    placeholder: '开机提示词（可空）：叫醒之后顺手投给它的第一句话，例如「继续上次没做完的活」',
                    value: 条.提示词 || '',
                    onChange: (e) => 改条(i, { 提示词: e.target.value }),
                  }),
                )
              }),
        ),

        // ── 按钮 ─────────────────────────────────────────────
        h(
          'div',
          { style: S.row },
          h(
            'button',
            { style: { ...S.btn, ...S.btnOn }, disabled: 忙 !== '', onClick: 存 },
            忙 === 'save' ? '保存中…' : '保存',
          ),
          h(
            'button',
            { style: S.btn, disabled: 忙 !== '', onClick: 试 },
            忙 === 'test' ? '在叫…' : '测一下',
          ),
          提 ? h('span', { style: { ...S.hint, ...(提.indexOf('失败') >= 0 ? S.bad : S.ok) } }, 提) : null,
        ),

        // ── 测试结果 ─────────────────────────────────────────
        测
          ? h(
              'div',
              { style: S.card },
              h('div', { style: { ...S.h, ...(测.ok ? S.ok : S.bad) } }, 测.说 || (测.ok ? '都叫得动' : '有叫不动的')),
              (测.明细 || []).length > 0
                ? h(
                    'div',
                    { style: { ...S.log, marginTop: 6 } },
                    (测.明细 || [])
                      .map(
                        (x) =>
                          `${x.尾 || 短(x.会话)}  ${x.状态}  ${(x.模型 && (x.模型.provider + '/' + x.模型.model)) || ''}${x.原因 ? '   ← ' + x.原因 : ''}`,
                      )
                      .join('\n'),
                  )
                : null,
            )
          : null,

        // ── 工具说明 ─────────────────────────────────────────
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '给 AI 的三个工具'),
          h(
            'div',
            { style: S.kv },
            h('span', { style: S.mono }, 'list_sessions'),
            h('span', { style: S.hint }, '列出所有会话（id / 标题 / 是否在线）'),
            h('span', { style: S.mono }, 'wake_session'),
            h('span', { style: S.hint }, '叫醒一间会话，可顺手投一句话，不等它做完'),
            h('span', { style: S.mono }, 'session_task'),
            h('span', { style: S.hint }, '把内容交给另一间会话、等它跑完，再把答复原文取回来'),
          ),
          h(
            'div',
            { style: S.hint },
            '例：在一个对话里说「让 XX 那间会话去查这个 bug」，模型就会用 session_task 把上下文丢过去，等那边回话再接着往下做。',
          ),
        ),

        // ── 最近 ─────────────────────────────────────────────
        Array.isArray(状态.最近) && 状态.最近.length > 0
          ? h(
              'div',
              { style: S.card },
              h('div', { style: S.h }, '最近叫醒的（最多 10 条）'),
              h(
                'div',
                { style: S.log },
                状态.最近.map((x) => `${x.at}  ${x.尾 || 短(x.会话)}  ${x.状态 || ''}  ${x.尾巴 || ''}`).join('\n'),
              ),
            )
          : null,
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'session-wake', order: 55, label: () => '会话唤醒' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
