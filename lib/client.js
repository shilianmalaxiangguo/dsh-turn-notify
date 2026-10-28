// dsh-turn-notify — settings page for the desktop turn notification.
//
// Client module in the DSH web plugin format: the page registers itself into the
// `settings.section` slot and talks to the host routes in ../index.js. Only
// `react` and the shared UI primitives are available through `require`.
//
// @generated-style bundle: this file IS the shipped client module.
window.__ModuleLoader__.load({
  id: 'dsh-turn-notify',
  factory: (require) => {
    const React = require('react')

    const NS = 'turn-notify'
    const ROUTE = '/turn-notify'

    const zh = {
      nav: '任务通知',
      title: '任务通知',
      description: 'DSH 每完成一轮任务时，在桌面右下角弹出一张必须手动关闭的卡片。',
      enabled: '启用任务通知',
      enabledHint: '关闭后不再弹出任何卡片。',
      includeSubagents: '子代理也通知',
      includeSubagentsHint: '一个回合可能派发多个子代理，开启后每个子代理结束都会弹卡片。',
      sound: '提示音',
      soundHint: '卡片出现时播放系统提示音。',
      skipWhenFocused: '应用在前台时不打扰',
      skipWhenFocusedHint: '当前前台窗口是本应用时跳过弹窗。',
      minDuration: '最短时长',
      minDurationHint: '短于该时长的轮次不弹（毫秒），用来过滤瞬时轮次。',
      test: '测试弹窗',
      testing: '弹出中…',
      testHint: '立即在桌面右下角弹出一张示例卡片，用来确认样式和位置。',
      autostart: '开机自启 DSH',
      autostartHint: '登录 Windows 后自动启动本应用（在「启动」文件夹创建快捷方式）。',
      autostartUnsupported: '当前平台不支持开机自启。',
      loading: '正在读取设置…',
      loadFailed: '读取设置失败',
      saveFailed: '保存失败',
      saved: '已保存',
      testFailed: '测试弹窗失败',
      paths: '配置文件',
      logFile: '诊断日志',
      shortcut: '快捷方式',
      retry: '重试',
    }

    const en = {
      nav: 'Turn notifications',
      title: 'Turn notifications',
      description: 'Every finished DSH turn shows a card in the bottom-right corner of the desktop that only you can dismiss.',
      enabled: 'Enable turn notifications',
      enabledHint: 'Turn this off to stop every card.',
      includeSubagents: 'Notify for subagents too',
      includeSubagentsHint: 'One turn can delegate to several subagents; each of their turns would show a card.',
      sound: 'Play a sound',
      soundHint: 'Play the system sound when a card appears.',
      skipWhenFocused: 'Stay quiet while the app is focused',
      skipWhenFocusedHint: 'Skip the card when this application owns the foreground window.',
      minDuration: 'Minimum duration',
      minDurationHint: 'Turns shorter than this many milliseconds are ignored.',
      test: 'Test popup',
      testing: 'Showing…',
      testHint: 'Show a sample card in the bottom-right corner right now.',
      autostart: 'Start DSH at sign-in',
      autostartHint: 'Launch this application after you sign in to Windows (a shortcut in your Startup folder).',
      autostartUnsupported: 'Autostart is unavailable on this platform.',
      loading: 'Reading settings…',
      loadFailed: 'Could not read settings',
      saveFailed: 'Could not save',
      saved: 'Saved',
      testFailed: 'Could not show the test card',
      paths: 'Settings file',
      logFile: 'Diagnostic log',
      shortcut: 'Shortcut',
      retry: 'Retry',
    }

    const CSS = [
      '.tn-page{display:flex;flex-direction:column;padding:4px 0 28px}',
      '.tn-head{margin-bottom:14px}',
      '.tn-title{font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.tn-desc{margin-top:6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
      '.tn-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.tn-row:last-of-type{border-bottom:none}',
      '.tn-text{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.tn-rowTitle{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.tn-rowHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.tn-switch{position:relative;flex:0 0 auto;width:38px;height:22px;padding:0;border:none;border-radius:11px;cursor:pointer;background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);transition:background .16s ease}',
      '.tn-switch:disabled{opacity:.5;cursor:default}',
      '.tn-switchOn{background:var(--dsw-alias-state-success-primary,#22c55e)}',
      '.tn-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .16s ease}',
      '.tn-switchOn .tn-knob{transform:translateX(16px)}',
      '.tn-input{width:96px;height:32px;padding:0 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}',
      '.tn-input:focus{outline:none;border-color:var(--dsw-alias-state-success-primary,#22c55e)}',
      '.tn-actions{display:flex;align-items:center;gap:10px;padding-top:18px}',
      '.tn-button{height:34px;padding:0 14px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}',
      '.tn-button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.tn-button:disabled{opacity:.5;cursor:default}',
      '.tn-primary{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1,#fff)}',
      '.tn-status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.tn-error{color:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.tn-ok{color:var(--dsw-alias-state-success-primary,#22c55e)}',
      '.tn-paths{margin-top:18px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:6px}',
      '.tn-path{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.tn-pathKey{color:var(--dsw-alias-label-primary)}',
    ].join('')

    let styled = false
    function ensureStyles() {
      if (styled || typeof document === 'undefined') return
      styled = true
      const style = document.createElement('style')
      style.setAttribute('data-dsh-turn-notify', '')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    async function request(path, options) {
      const response = await fetch(ROUTE + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      })
      let body = {}
      try {
        body = await response.json()
      } catch {
        body = {}
      }
      if (!response.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${String(response.status)}`)
      return body
    }

    function Switch(props) {
      const className = props.checked ? 'tn-switch tn-switchOn' : 'tn-switch'
      return React.createElement(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          className,
          disabled: props.disabled === true,
          onClick: () => props.onChange(!props.checked),
        },
        React.createElement('span', { className: 'tn-knob' }),
      )
    }

    function Row(props) {
      return React.createElement(
        'div',
        { className: 'tn-row' },
        React.createElement(
          'div',
          { className: 'tn-text' },
          React.createElement('div', { className: 'tn-rowTitle' }, props.title),
          props.hint === undefined ? null : React.createElement('div', { className: 'tn-rowHint' }, props.hint),
        ),
        props.children,
      )
    }

    function TurnNotifySection(props) {
      ensureStyles()
      const t = (key) => (typeof props.t === 'function' ? props.t(key) : zh[key] ?? key)

      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [notice, setNotice] = React.useState(null)
      const [testing, setTesting] = React.useState(false)
      const [duration, setDuration] = React.useState('')

      const load = React.useCallback(async () => {
        setState({ status: 'loading', data: null, error: null })
        try {
          const body = await request('/config')
          setState({ status: 'ready', data: body, error: null })
          setDuration(String(body.config.minDurationMs))
        } catch (error) {
          setState({ status: 'error', data: null, error: String(error?.message ?? error) })
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      const save = React.useCallback(async (patch) => {
        setNotice(null)
        try {
          const body = await request('/config', { method: 'PUT', body: JSON.stringify({ config: patch }) })
          setState({ status: 'ready', data: body, error: null })
          setNotice({ kind: 'ok', text: t('saved') })
          return true
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}: ${String(error?.message ?? error)}` })
          return false
        }
      }, [props.t])

      const config = state.data?.config
      const autostart = state.data?.autostart

      if (state.status === 'loading') {
        return React.createElement('div', { className: 'tn-page' }, React.createElement('div', { className: 'tn-status' }, t('loading')))
      }
      if (state.status === 'error') {
        return React.createElement(
          'div',
          { className: 'tn-page' },
          React.createElement('div', { className: 'tn-status tn-error' }, `${t('loadFailed')}: ${state.error}`),
          React.createElement('div', { className: 'tn-actions' }, React.createElement('button', { type: 'button', className: 'tn-button', onClick: () => void load() }, t('retry'))),
        )
      }

      const test = async () => {
        setTesting(true)
        setNotice(null)
        try {
          await request('/test', { method: 'POST', body: '{}' })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('testFailed')}: ${String(error?.message ?? error)}` })
        } finally {
          setTesting(false)
        }
      }

      const toggleAutostart = async (enabled) => {
        setNotice(null)
        try {
          const body = await request('/autostart', { method: 'POST', body: JSON.stringify({ enabled }) })
          setState({ status: 'ready', data: body, error: null })
          setNotice({ kind: 'ok', text: t('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}: ${String(error?.message ?? error)}` })
        }
      }

      const rows = [
        { key: 'enabled', title: t('enabled'), hint: t('enabledHint') },
        { key: 'includeSubagents', title: t('includeSubagents'), hint: t('includeSubagentsHint') },
        { key: 'sound', title: t('sound'), hint: t('soundHint') },
        { key: 'skipWhenFocused', title: t('skipWhenFocused'), hint: t('skipWhenFocusedHint') },
      ].map((row) => React.createElement(
        Row,
        { key: row.key, title: row.title, hint: row.hint },
        React.createElement(Switch, {
          checked: config[row.key] === true,
          label: row.title,
          onChange: (next) => void save({ [row.key]: next }),
        }),
      ))

      const durationRow = React.createElement(
        Row,
        { key: 'minDurationMs', title: t('minDuration'), hint: t('minDurationHint') },
        React.createElement('input', {
          className: 'tn-input',
          type: 'number',
          min: 0,
          step: 500,
          value: duration,
          'aria-label': t('minDuration'),
          onChange: (event) => setDuration(event.target.value),
          onBlur: () => {
            const next = Number(duration)
            if (Number.isFinite(next) && next >= 0 && next !== config.minDurationMs) void save({ minDurationMs: Math.round(next) })
            else setDuration(String(config.minDurationMs))
          },
        }),
      )

      const autostartRow = autostart?.supported === true
        ? React.createElement(
          Row,
          { key: 'autostart', title: t('autostart'), hint: t('autostartHint') },
          React.createElement(Switch, {
            checked: autostart.enabled === true,
            label: t('autostart'),
            onChange: (next) => void toggleAutostart(next),
          }),
        )
        : React.createElement(
          Row,
          { key: 'autostart', title: t('autostart'), hint: t('autostartUnsupported') },
          null,
        )

      const paths = state.data?.files ?? {}

      return React.createElement(
        'div',
        { className: 'tn-page' },
        React.createElement(
          'div',
          { className: 'tn-head' },
          React.createElement('div', { className: 'tn-title' }, t('title')),
          React.createElement('div', { className: 'tn-desc' }, t('description')),
        ),
        rows,
        durationRow,
        autostartRow,
        React.createElement(
          'div',
          { className: 'tn-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'tn-button tn-primary',
            disabled: testing,
            onClick: () => void test(),
          }, testing ? t('testing') : t('test')),
          React.createElement('span', { className: 'tn-status' }, t('testHint')),
        ),
        notice === null
          ? null
          : React.createElement('div', { className: notice.kind === 'error' ? 'tn-status tn-error' : 'tn-status tn-ok' }, notice.text),
        React.createElement(
          'div',
          { className: 'tn-paths' },
          React.createElement('div', { className: 'tn-path' }, React.createElement('span', { className: 'tn-pathKey' }, `${t('paths')}: `), paths.config ?? ''),
          React.createElement('div', { className: 'tn-path' }, React.createElement('span', { className: 'tn-pathKey' }, `${t('logFile')}: `), paths.log ?? ''),
          autostart?.shortcut === undefined
            ? null
            : React.createElement('div', { className: 'tn-path' }, React.createElement('span', { className: 'tn-pathKey' }, `${t('shortcut')}: `), autostart.shortcut),
        ),
      )
    }

    function apply(ctx) {
      ensureStyles()
      if (ctx.locale !== undefined && typeof ctx.locale.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-turn-notify: dictionaries')
      }
      ctx.effect(() => {
        const off = ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'turn-notify',
          order: 45,
          label: () => {
            try {
              return ctx.locale.bind(NS)('nav')
            } catch {
              return zh.nav
            }
          },
          locale: NS,
        }, TurnNotifySection))
        return typeof off === 'function' ? off : undefined
      }, 'dsh-turn-notify: settings section')
    }

    return { apply, inject: ['slots', 'locale'] }
  },
})
