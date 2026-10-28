/**
 * dsh-turn-notify — a bottom-right desktop popup for every finished DSH turn.
 *
 * The popup is a native, topmost, borderless Windows card that never closes
 * itself: the user dismisses it with the close button, a right-click, or Esc.
 *
 * The plugin runs inside the DSH host process (plain Node, no Electron), so the
 * card is rendered by a short-lived PowerShell process reading `lib/popup.ps1`.
 * Every popup owns a slot; slots stack upward from the bottom-right corner.
 *
 * Settings live in `<dsh home>/turn-notify.config.json`, edited by the settings
 * page in `lib/client.js`. Precedence is defaults < profile patch entry < that
 * file, so the page wins over the patch and takes effect on the next turn.
 *
 * @module dsh-turn-notify
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader identity; the profile's patch entry inserts this module by path. */
export const name = 'dsh-turn-notify'

const HERE = dirname(fileURLToPath(import.meta.url))
const POPUP_SCRIPT = join(HERE, 'popup.ps1')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CONFIG_FILE = join(DSH_HOME, 'turn-notify.config.json')

/** Every `TurnEndReason.kind` this plugin understands. */
const ALL_KINDS = ['completed', 'error', 'aborted', 'interrupted', 'max-tokens', 'blocked', 'forked']

/** Title and status badge colour per turn outcome (Windows XP palette). */
const PRESENTATION = {
  completed: { title: '任务完成', accent: '#3CA03C' },
  error: { title: '任务出错', accent: '#C0392B' },
  aborted: { title: '任务已中断', accent: '#E8A400' },
  interrupted: { title: '任务已中断', accent: '#E8A400' },
  'max-tokens': { title: '达到长度上限', accent: '#E8A400' },
  blocked: { title: '任务被阻止', accent: '#E8A400' },
  forked: { title: '已分叉会话', accent: '#2A5FA8' },
}

/** A slot is never recycled faster than this, even if its exit event is lost. */
const SLOT_GUARD_MS = 12 * 60 * 60 * 1000

/** Settings the settings page is allowed to write. */
const WRITABLE_KEYS = new Set([
  'enabled',
  'kinds',
  'minDurationMs',
  'includeSubagents',
  'skipWhenFocused',
  'focusedProcess',
  'sound',
  'maxPopups',
  'width',
  'margin',
  'logFile',
])

const DEFAULTS = {
  enabled: true,
  kinds: ['completed', 'error', 'aborted', 'interrupted', 'max-tokens', 'blocked'],
  minDurationMs: 2000,
  includeSubagents: false,
  skipWhenFocused: false,
  focusedProcess: 'DeepSeek Harness',
  sound: true,
  maxPopups: 5,
  width: 380,
  margin: 16,
  logFile: join(DSH_HOME, 'turn-notify.jsonl'),
}

/** Coerce one user-supplied option into the shape the renderer expects. */
function normalize(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const config = { ...DEFAULTS }

  if (typeof source.enabled === 'boolean') config.enabled = source.enabled
  if (Array.isArray(source.kinds)) {
    const kinds = source.kinds.filter((kind) => ALL_KINDS.includes(kind))
    if (kinds.length > 0) config.kinds = kinds
  }
  if (Number.isFinite(source.minDurationMs) && source.minDurationMs >= 0) config.minDurationMs = source.minDurationMs
  if (typeof source.includeSubagents === 'boolean') config.includeSubagents = source.includeSubagents
  if (typeof source.skipWhenFocused === 'boolean') config.skipWhenFocused = source.skipWhenFocused
  if (typeof source.focusedProcess === 'string' && source.focusedProcess.trim() !== '') config.focusedProcess = source.focusedProcess.trim()
  if (typeof source.sound === 'boolean') config.sound = source.sound
  if (Number.isSafeInteger(source.maxPopups) && source.maxPopups > 0) config.maxPopups = Math.min(source.maxPopups, 20)
  if (Number.isFinite(source.width) && source.width >= 240) config.width = Math.round(source.width)
  if (Number.isFinite(source.margin) && source.margin >= 0) config.margin = Math.round(source.margin)
  if (typeof source.logFile === 'string') config.logFile = source.logFile

  return config
}

/** Read the settings file the settings page writes; a broken file falls back to {}. */
function readStore(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Replace the settings file atomically enough that a crash cannot truncate it. */
function writeStore(file, value) {
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}

/** Locate an executable on PATH without spawning anything. */
function which(command) {
  const directories = String(process.env.PATH ?? '').split(';').map((entry) => entry.replace(/^"|"$/gu, '')).filter(Boolean)
  const extensions = /\.[a-z0-9]+$/iu.test(command) ? [''] : ['.exe', '.cmd', '.bat', '']
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, command + extension)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Pick the PowerShell host used for rendering, preferring PowerShell 7 and
 * falling back to the Windows PowerShell that ships with the OS.
 * @returns an absolute executable path, or undefined when neither exists.
 */
function resolveShell() {
  const candidates = [
    which('pwsh.exe'),
    process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe'),
    process.env.ProgramFiles === undefined ? undefined : join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    which('powershell.exe'),
  ]
  return candidates.find((candidate) => typeof candidate === 'string' && existsSync(candidate))
}

/** Collapse a message into one short line fit for a notification card. */
function summarize(text, limit = 160) {
  const flat = String(text).replace(/\s+/gu, ' ').trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit - 1)}…`
}

/**
 * Read the human text out of one user message.
 *
 * Only `source.kind === 'user'` is the person's own words: a turn also appends
 * injected `agent-instructions`, `runtime-context`, `skill-catalog` and
 * `time-context` messages, and the newest of those would otherwise become the
 * notification text.
 *
 * @param message - the `user/message` event payload.
 * @returns the collapsed prompt, or undefined when the message is not the user's.
 */
export function promptOf(message) {
  if (message === null || typeof message !== 'object') return undefined
  if (message.source?.kind !== 'user') return undefined
  const blocks = Array.isArray(message.content) ? message.content : []
  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
  return text === '' ? undefined : summarize(text, 100)
}

/** Best-effort message for a failed turn. */
function failureOf(reason) {
  const candidates = [reason?.error, reason?.failure]
  for (const candidate of candidates) {
    if (candidate !== null && typeof candidate === 'object' && typeof candidate.message === 'string' && candidate.message.trim() !== '') {
      return summarize(candidate.message, 90)
    }
  }
  return undefined
}

/**
 * Recover the running turn from the session's own log.
 *
 * `turn/start` is delivered live only, so an instance that loaded after the
 * turn began has no recorded start time — and a turn without a start time is
 * not a zero-second turn. The session log still holds the real one.
 *
 * @param session - the session carried by the `session/event` payload.
 * @returns `{ startedAt, prompt }` for the newest turn, or undefined when the
 *   host exposes no readable log.
 */
function recoverTurn(session) {
  if (typeof session?.snapshotEvents !== 'function') return undefined
  let events
  try {
    events = session.snapshotEvents()
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const start = events[index]
    if (start?.type !== 'turn/start') continue
    // The prompt follows its `turn/start` in the log and precedes the next boundary.
    let prompt
    for (let later = index + 1; later < events.length; later += 1) {
      const event = events[later]
      if (event?.type === 'turn/start' || event?.type === 'turn/end') break
      if (event?.type !== 'user/message') continue
      prompt = promptOf(event.data)
      if (prompt !== undefined) break
    }
    return { startedAt: typeof start.time === 'number' ? start.time : undefined, prompt }
  }
  return undefined
}

/**
 * The conversation's own summary title, read back from the session log.
 *
 * The host writes `session/title` once per conversation - first a fallback
 * built from the opening prompt, then the summarised title an LLM produces -
 * so a session that began before this plugin loaded never delivered the event
 * live. The log still has it.
 *
 * @param session - the session carried by the `session/event` payload.
 * @returns the newest non-empty title, or undefined when none was written.
 */
function titleFromLog(session) {
  if (typeof session?.snapshotEvents !== 'function') return undefined
  let events
  try {
    events = session.snapshotEvents()
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'session/title') continue
    const title = event.data?.title
    if (typeof title === 'string' && title.trim() !== '') return title.trim()
  }
  return undefined
}

/** Render a duration the way a person reads it. */function formatDuration(milliseconds) {
  const seconds = milliseconds / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分 ${Math.round(seconds - minutes * 60)} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes - hours * 60} 分`
}

// ------------------------------------------------------------ Windows login ---

/** The per-user Startup shortcut that makes DSH start when the user signs in. */
function autostartShortcut() {
  const appData = process.env.APPDATA
  if (appData === undefined) return undefined
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'DeepSeek Harness.lnk')
}

/** Run a PowerShell command and collect its output. */
function runPowerShell(shell, script) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
    } catch (error) {
      resolve({ code: -1, stderr: String(error?.message ?? error) })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => resolve({ code: -1, stderr: String(error?.message ?? error) }))
    child.once('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/**
 * Register the turn-end notification.
 * @param ctx - host context owning the listener.
 * @param config - user configuration from the profile patch entry.
 */
export function apply(ctx, config) {
  const patchConfig = config !== null && typeof config === 'object' ? config : {}
  const shell = resolveShell()
  // The settings page writes `configFile`; the path itself may only come from the
  // patch entry, so tests and alternate profiles can redirect the store.
  const configFile = typeof patchConfig.configFile === 'string' && patchConfig.configFile !== '' ? patchConfig.configFile : CONFIG_FILE
  const store = { file: readStore(configFile) }

  /** The settings in force right now: defaults, then the patch entry, then the page. */
  const effective = () => normalize({ ...patchConfig, ...store.file })

  const record = (level, message, extra) => {
    const line = `[dsh-turn-notify] ${message}`
    try {
      if (level === 'warn') ctx.logger?.warn?.(line)
      else ctx.logger?.info?.(line)
    } catch {
      /* logging must never break a turn */
    }
    const file = effective().logFile
    if (file === '') return
    try {
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), level, message, ...extra })}\n`, 'utf8')
    } catch {
      /* a broken diagnostic log never breaks a turn */
    }
  }

  if (shell === undefined) {
    record('warn', 'no PowerShell host found; notifications are disabled')
    return
  }

  record('info', `loaded (shell=${shell}, script=${POPUP_SCRIPT}, config=${configFile})`, {
    event: 'loaded',
    shell,
    script: POPUP_SCRIPT,
    config: configFile,
    execPath: process.execPath,
  })

  const slots = new Array(20).fill(null)
  const turns = new Map()
  // The host summarises each conversation once (`session/title`, usually right
  // after the first prompt), so a title seen live is kept per session and the
  // session log is the fallback for a conversation that started before this
  // plugin loaded.
  const titles = new Map()
  const timers = new Set()

  /** Show one card, claiming the lowest free slot. */
  const popup = (payload) => {
    const settings = effective()
    const limit = Math.max(1, Math.min(slots.length, settings.maxPopups))
    let slot = -1
    for (let index = 0; index < limit; index += 1) {
      if (slots[index] === null) { slot = index; break }
    }
    if (slot < 0) {
      record('warn', `all ${limit} popup slots are busy; notification skipped`)
      return false
    }
    const encoded = Buffer.from(JSON.stringify({ ...payload, slot }), 'utf8').toString('base64')
    const args = ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', POPUP_SCRIPT, '-Payload', encoded]

    let child
    try {
      // No `detached`: a detached child never reaches its first statement in
      // this environment, and the renderer only has to outlive its own window.
      child = spawn(shell, args, { stdio: 'ignore', windowsHide: true })
    } catch (error) {
      record('warn', `could not start the popup renderer: ${String(error?.message ?? error)}`)
      return false
    }

    let guard
    let released = false
    const release = () => {
      if (released) return
      released = true
      clearTimeout(guard)
      timers.delete(guard)
      if (slots[slot] === child) slots[slot] = null
    }

    slots[slot] = child
    guard = setTimeout(release, SLOT_GUARD_MS)
    guard.unref?.()
    timers.add(guard)
    child.once('exit', release)
    child.once('error', (error) => {
      record('warn', `popup renderer failed: ${String(error?.message ?? error)}`)
      release()
    })
    child.unref()

    record('info', `popup shown (slot=${slot}, pid=${String(child.pid)}, kind=${String(payload.kind)}${payload.heading ? `, heading=${payload.heading}` : ''})`, {
      event: 'popup',
      slot,
      pid: child.pid,
      kind: payload.kind,
      title: payload.title,
      heading: payload.heading,
      body: payload.body,
      meta: payload.meta,
    })
    return true
  }

  /** Build and show the card for one finished turn. */
  const notifyTurnEnd = (session, event, turn) => {
    const settings = effective()
    const kind = typeof event.data?.reason?.kind === 'string' ? event.data.reason.kind : 'completed'
    // A reload that lands mid-turn loses the recorded start; the session log
    // still has it, and only a measured duration may drop a notification.
    const recovered = turn?.startedAt === undefined ? recoverTurn(session) : undefined
    const startedAt = turn?.startedAt ?? recovered?.startedAt
    const prompt = turn?.prompt ?? recovered?.prompt
    // The host stamps every event with the same clock the session log records,
    // so a recovered start time measures the turn the host actually ran.
    const endedAt = typeof event.time === 'number' ? event.time : Date.now()
    const durationMs = typeof startedAt === 'number' ? endedAt - startedAt : undefined
    const cwd = typeof session.header?.cwd === 'string' ? session.header.cwd : ''
    const where = cwd === '' ? 'DSH' : basename(cwd)

    if (!settings.kinds.includes(kind)) {
      record('info', `turn ${kind} ignored by configuration (session=${session.id})`)
      return
    }
    if (durationMs !== undefined && durationMs < settings.minDurationMs) {
      record('info', `turn ${kind} too short (${formatDuration(durationMs)}); notification skipped`)
      return
    }

    const presentation = PRESENTATION[kind] ?? { title: '任务结束', accent: '#2A5FA8' }
    let heading = titles.get(session.id)
    if (heading === undefined) {
      heading = titleFromLog(session)
      if (heading !== undefined) titles.set(session.id, heading)
    }
    const detail = [`<${where}>`, durationMs === undefined ? '用时 未知' : `用时 ${formatDuration(durationMs)}`]
    if (kind === 'error') {
      const failure = failureOf(event.data?.reason)
      if (failure !== undefined) detail.push(failure)
    }

    popup({
      kind,
      title: presentation.title,
      accent: presentation.accent,
      heading: heading ?? '',
      body: prompt ?? '',
      meta: detail.join(' · '),
      sound: settings.sound,
      width: settings.width,
      margin: settings.margin,
      skipWhenFocused: settings.skipWhenFocused,
      focusedProcess: settings.focusedProcess,
    })
  }

  const onSessionEvent = (session, event) => {
    try {
      const settings = effective()
      const sessionId = session?.id
      if (typeof sessionId !== 'string') return
      if (session.header?.origin === 'subagent' && !settings.includeSubagents) return

      switch (event?.type) {
        case 'turn/start':
          turns.set(sessionId, { startedAt: typeof event.time === 'number' ? event.time : Date.now(), prompt: undefined })
          break
        case 'user/message': {
          if (event.surfaceOp !== 'append') break
          const text = promptOf(event.data)
          if (text === undefined) break
          const turn = turns.get(sessionId)
          if (turn !== undefined) turn.prompt = text
          break
        }
        case 'session/title': {
          const title = event.data?.title
          if (typeof title === 'string' && title.trim() !== '') titles.set(sessionId, title.trim())
          break
        }
        case 'turn/end': {
          const turn = turns.get(sessionId)
          turns.delete(sessionId)
          notifyTurnEnd(session, event, turn)
          break
        }
        case 'session/disposed':
          turns.delete(sessionId)
          titles.delete(sessionId)
          break
        default:
          break
      }
    } catch (error) {
      record('warn', `session/event handler failed: ${String(error?.message ?? error)}`)
    }
  }

  ctx.on('session/event', onSessionEvent)

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      turns.clear()
    }, 'dsh-turn-notify: cleanup')
  }

  // ----------------------------------------------------------- settings page ---

  const json = (res, code, body) => {
    try {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    } catch {
      /* socket already closed */
    }
  }

  const readBody = async (req, maxBytes = 64 * 1024) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maxBytes) throw new Error('body too large')
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  }

  /** Reject cross-site writes while allowing the local UI. */
  const trusted = (req) => {
    const header = (name) => {
      const value = req?.headers?.[name]
      return Array.isArray(value) ? value[0] : value
    }
    const host = header('x-forwarded-host') ?? header('host')
    const origin = header('origin') ?? header('referer')
    const loopback = (value) => /^(localhost|127\.|\[?::1\]?|::ffff:127\.)/u.test(String(value ?? '').toLowerCase().replace(/^\[|\]$/gu, ''))
    if (header('sec-fetch-site') === 'cross-site') return false
    if (origin === undefined) return loopback(req?.socket?.remoteAddress) || header('sec-fetch-site') === 'same-origin'
    try {
      const url = new URL(origin)
      if (host !== undefined && url.host.toLowerCase() === String(host).toLowerCase()) return true
      return loopback(url.hostname) && loopback(req?.socket?.remoteAddress)
    } catch {
      return false
    }
  }

  const describe = () => {
    const shortcut = autostartShortcut()
    return {
      config: effective(),
      user: store.file,
      writable: [...WRITABLE_KEYS],
      autostart: {
        supported: shortcut !== undefined,
        enabled: shortcut !== undefined && existsSync(shortcut),
        shortcut,
        target: process.execPath,
      },
      files: { config: configFile, popup: POPUP_SCRIPT, log: effective().logFile },
    }
  }

  const registerRoutes = (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: '/turn-notify/config',
      handler: async (req, res) => {
        if (!trusted(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        if (req.method === 'GET') return json(res, 200, { ok: true, ...describe() })
        if (req.method !== 'PUT') return json(res, 405, { ok: false, error: 'GET or PUT' })
        let payload
        try {
          payload = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        } catch {
          return json(res, 400, { ok: false, error: 'invalid json' })
        }
        const patch = payload?.config ?? payload
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
          return json(res, 400, { ok: false, error: 'config must be an object' })
        }
        for (const key of Object.keys(patch)) {
          if (!WRITABLE_KEYS.has(key)) return json(res, 400, { ok: false, error: `unknown config field: ${key}` })
        }
        const next = normalize({ ...effective(), ...patch })
        const accepted = {}
        for (const key of Object.keys(patch)) accepted[key] = next[key]
        store.file = { ...store.file, ...accepted }
        try {
          writeStore(configFile, store.file)
        } catch (error) {
          return json(res, 500, { ok: false, error: `could not save: ${String(error?.message ?? error)}` })
        }
        record('info', `settings saved (${Object.keys(accepted).join(', ')})`, { event: 'settings', keys: Object.keys(accepted) })
        return json(res, 200, { ok: true, ...describe() })
      },
    }), 'dsh-turn-notify: /config')

    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: '/turn-notify/test',
      handler: async (req, res) => {
        if (!trusted(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })
        const settings = effective()
        const shown = popup({
          kind: 'completed',
          title: PRESENTATION.completed.title,
          accent: PRESENTATION.completed.accent,
          heading: '这是一条测试通知',
          body: '这是一条测试通知：DSH 每完成一轮任务，都会像这样出现在桌面右下角。',
          meta: '<测试> · 用时 12.3 秒',
          sound: settings.sound,
          width: settings.width,
          margin: settings.margin,
          skipWhenFocused: false,
          focusedProcess: settings.focusedProcess,
        })
        return json(res, 200, { ok: shown, shown })
      },
    }), 'dsh-turn-notify: /test')

    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: '/turn-notify/autostart',
      handler: async (req, res) => {
        if (!trusted(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })
        const shortcut = autostartShortcut()
        if (shortcut === undefined) return json(res, 400, { ok: false, error: 'autostart is unavailable on this platform' })
        let payload
        try {
          payload = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        } catch {
          return json(res, 400, { ok: false, error: 'invalid json' })
        }
        const enabled = payload?.enabled === true
        const target = process.execPath
        const script = enabled
          ? `$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut(${JSON.stringify(shortcut)}); $sc.TargetPath = ${JSON.stringify(target)}; $sc.WorkingDirectory = ${JSON.stringify(dirname(target))}; $sc.Save()`
          : `Remove-Item -LiteralPath ${JSON.stringify(shortcut)} -Force -ErrorAction SilentlyContinue`
        const result = await runPowerShell(shell, script)
        if (result.code !== 0) {
          return json(res, 500, { ok: false, error: summarize(result.stderr || `powershell exited ${String(result.code)}`, 200) })
        }
        record('info', `autostart ${enabled ? 'enabled' : 'disabled'}`, { event: 'autostart', enabled })
        return json(res, 200, { ok: true, ...describe() })
      },
    }), 'dsh-turn-notify: /autostart')
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], registerRoutes)
  }
}
