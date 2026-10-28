/**
 * Behavioural smoke test for dsh-turn-notify.
 *
 * It drives the plugin through a fake cordis context, so it proves the turn
 * bookkeeping and the filtering rules without a running DSH. The notification
 * path is exercised for real: the test spawns the actual PowerShell renderer
 * and asserts the window is still alive a moment later, which is exactly the
 * "never closes itself" guarantee.
 *
 *   node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { apply, promptOf } from '../lib/index.js'

const SESSION = { id: 'sess-main', header: { cwd: 'D:\\self_workspace\\TIPS' } }

// The settings page's store outranks the patch entry, so the suite redirects it
// to a scratch file instead of inheriting whatever the user configured.
const CONFIG_FILE = join(tmpdir(), 'dsh-turn-notify-smoke.config.json')
rmSync(CONFIG_FILE, { force: true })

/** Minimal stand-in for the cordis host context the plugin touches. */
function createContext() {
  const listeners = new Map()
  const logs = []
  return {
    logs,
    logger: {
      info: (line) => logs.push({ level: 'info', line }),
      warn: (line) => logs.push({ level: 'warn', line }),
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
    effect(callback) {
      return callback()
    },
    emit(name, ...args) {
      listeners.get(name)?.(...args)
    },
  }
}

function load(config) {
  const ctx = createContext()
  apply(ctx, { configFile: CONFIG_FILE, ...config })
  return ctx
}

function lines(ctx) {
  return ctx.logs.map((entry) => entry.line).join('\n')
}

/** Drive one complete turn and report the plugin's log. */
function runTurn(ctx, { session = SESSION, prompt = '把弹框通知接进 DSH', reason = { kind: 'completed' } } = {}) {
  ctx.emit('session/event', session, { type: 'turn/start', data: { turn: 1 } })
  if (prompt !== undefined) {
    ctx.emit('session/event', session, {
      type: 'user/message',
      surfaceOp: 'append',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] },
    })
  }
  ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason } })
}

const spawned = []
const results = []

/**
 * A session whose log still holds the `turn/start` a mid-turn plugin reload
 * lost: the live event never reached this instance, the log still has it.
 */
function sessionWithLog(startedAt, prompt) {
  return {
    id: 'sess-main',
    header: { cwd: 'D:\\self_workspace\\TIPS' },
    snapshotEvents: () => [
      { type: 'turn/start', seq: 0, time: startedAt, data: { turn: 23 } },
      { type: 'user/message', seq: 1, time: startedAt + 1, surfaceOp: 'append', data: { source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] } },
      { type: 'turn/end', seq: 2, time: startedAt + 590_500, data: { turn: 23, reason: { kind: 'completed' } } },
    ],
  }
}

async function check(name, fn) {
  try {
    await fn()
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name}\n      ${String(error?.message ?? error).split('\n').join('\n      ')}`)
    process.exitCode = 1
  }
}

await check('a completed turn shows exactly one popup', async () => {
  const ctx = load({ minDurationMs: 0, sound: false })
  runTurn(ctx)
  const shown = ctx.logs.filter((entry) => entry.line.includes('popup shown'))
  assert.equal(shown.length, 1, lines(ctx))
  const pid = Number(/pid=(\d+)/u.exec(shown[0].line)?.[1])
  assert.ok(Number.isSafeInteger(pid) && pid > 0, `no pid in: ${shown[0].line}`)
  spawned.push(pid)
  assert.match(shown[0].line, /kind=completed/u)
})

await check('the popup is still open after 2s (it never closes itself)', async () => {
  assert.ok(spawned.length > 0, 'no popup was spawned')
  await delay(2000)
  for (const pid of spawned) {
    let alive = true
    try {
      process.kill(pid, 0)
    } catch {
      alive = false
    }
    assert.ok(alive, `popup pid ${String(pid)} exited on its own`)
  }
})

await check('subagent sessions stay silent by default', async () => {
  const ctx = load({ minDurationMs: 0, sound: false })
  runTurn(ctx, { session: { id: 'sess-child', header: { cwd: 'C:\\tmp', origin: 'subagent' } } })
  assert.equal(ctx.logs.filter((entry) => entry.line.includes('popup shown')).length, 0, lines(ctx))
})

await check('includeSubagents: true lets a subagent through', async () => {
  const ctx = load({ minDurationMs: 0, sound: false, includeSubagents: true })
  runTurn(ctx, { session: { id: 'sess-child', header: { cwd: 'C:\\tmp', origin: 'subagent' } } })
  const shown = ctx.logs.filter((entry) => entry.line.includes('popup shown'))
  assert.equal(shown.length, 1, lines(ctx))
  spawned.push(Number(/pid=(\d+)/u.exec(shown[0].line)?.[1]))
})

await check('a turn shorter than minDurationMs stays silent', async () => {
  const ctx = load({ minDurationMs: 60_000, sound: false })
  runTurn(ctx)
  assert.equal(ctx.logs.filter((entry) => entry.line.includes('popup shown')).length, 0, lines(ctx))
  assert.match(lines(ctx), /too short/u)
})

await check('a turn whose start the plugin never saw still notifies', async () => {
  // The reported bug: a reload lands mid-turn, so `turn/start` never reached
  // this instance and the turn used to be reported as 0.0 秒 and dropped.
  const ctx = load({ minDurationMs: 60_000, sound: false })
  ctx.emit('session/event', SESSION, { type: 'turn/end', data: { turn: 23, reason: { kind: 'completed' } } })
  const shown = ctx.logs.filter((entry) => entry.line.includes('popup shown'))
  assert.equal(shown.length, 1, lines(ctx))
  spawned.push(Number(/pid=(\d+)/u.exec(shown[0].line)?.[1]))
})

await check('a lost start time is recovered from the session log', async () => {
  const ctx = load({ minDurationMs: 300_000, sound: false })
  ctx.emit('session/event', sessionWithLog(Date.now() - 600_000, '重启前后端项目'), { type: 'turn/end', data: { turn: 23, reason: { kind: 'completed' } } })
  const shown = ctx.logs.filter((entry) => entry.line.includes('popup shown'))
  assert.equal(shown.length, 1, lines(ctx))
  spawned.push(Number(/pid=(\d+)/u.exec(shown[0].line)?.[1]))
})

await check('a genuinely short turn recovered from the log stays silent', async () => {
  const ctx = load({ minDurationMs: 300_000, sound: false })
  ctx.emit('session/event', sessionWithLog(Date.now(), 'quick one'), { type: 'turn/end', data: { turn: 23, reason: { kind: 'completed' } } })
  assert.equal(ctx.logs.filter((entry) => entry.line.includes('popup shown')).length, 0, lines(ctx))
  assert.match(lines(ctx), /too short/u)
})

await check('the conversation\'s summary title heads the card', async () => {
  const ctx = load({ minDurationMs: 0, sound: false })
  ctx.emit('session/event', SESSION, { type: 'session/title', data: { title: '实现 DSH 任务完成弹窗通知', messageSeqs: [16], source: { kind: 'provider' } } })
  runTurn(ctx)
  const shown = ctx.logs.filter((entry) => entry.line.includes('popup shown'))
  assert.equal(shown.length, 1, lines(ctx))
  assert.match(shown[0].line, /heading=实现 DSH 任务完成弹窗通知/u, lines(ctx))
  spawned.push(Number(/pid=(\d+)/u.exec(shown[0].line)?.[1]))
})

await check('a title written before the plugin loaded is recovered from the log', async () => {
  const ctx = load({ minDurationMs: 0, sound: false })
  const startedAt = Date.now() - 90_000
  const session = {
    id: 'sess-title',
    header: { cwd: 'D:\\self_workspace\\TIPS' },
    snapshotEvents: () => [
      { type: 'session/title', seq: 0, time: startedAt - 1000, data: { title: '先写下的标题', messageSeqs: [1], source: { kind: 'fallback' } } },
      { type: 'turn/start', seq: 1, time: startedAt, data: { turn: 4 } },
      { type: 'turn/end', seq: 2, time: startedAt + 90_000, data: { turn: 4, reason: { kind: 'completed' } } },
    ],
  }
  ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } })
  const shown = ctx.logs.filter((entry) => entry.line.includes('popup shown'))
  assert.equal(shown.length, 1, lines(ctx))
  assert.match(shown[0].line, /heading=先写下的标题/u, lines(ctx))
  spawned.push(Number(/pid=(\d+)/u.exec(shown[0].line)?.[1]))
})

await check('a turn with no title anywhere still notifies', async () => {
  const ctx = load({ minDurationMs: 0, sound: false })
  runTurn(ctx)
  const shown = ctx.logs.filter((entry) => entry.line.includes('popup shown'))
  assert.equal(shown.length, 1, lines(ctx))
  assert.doesNotMatch(shown[0].line, /heading=/u, lines(ctx))
  spawned.push(Number(/pid=(\d+)/u.exec(shown[0].line)?.[1]))
})

await check('kinds filters the outcomes that notify', async () => {
  const ctx = load({ minDurationMs: 0, sound: false, kinds: ['error'] })
  runTurn(ctx, { reason: { kind: 'completed' } })
  assert.equal(ctx.logs.filter((entry) => entry.line.includes('popup shown')).length, 0, lines(ctx))
  runTurn(ctx, { reason: { kind: 'error', error: { message: 'provider returned 429' } } })
  const shown = ctx.logs.filter((entry) => entry.line.includes('popup shown'))
  assert.equal(shown.length, 1, lines(ctx))
  assert.match(shown[0].line, /kind=error/u)
  spawned.push(Number(/pid=(\d+)/u.exec(shown[0].line)?.[1]))
})

await check('only the user\'s own message becomes the notification text', async () => {
  const text = [{ type: 'text', text: '把弹框通知接进 DSH' }]
  assert.equal(promptOf({ source: { kind: 'user' }, content: text }), '把弹框通知接进 DSH')
  for (const kind of ['runtime-context', 'time-context', 'agent-instructions', 'skill-catalog']) {
    assert.equal(promptOf({ source: { kind, form: 'snapshot' }, content: text }), undefined, `${kind} leaked into the notification`)
  }
  assert.equal(promptOf({ content: text }), undefined, 'a message without a source leaked into the notification')
})

await check('injected context appended after the prompt never wins', async () => {
  const ctx = load({ minDurationMs: 0, sound: false })
  ctx.emit('session/event', SESSION, { type: 'turn/start', data: { turn: 2 } })
  ctx.emit('session/event', SESSION, {
    type: 'user/message',
    surfaceOp: 'append',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '把弹框通知接进 DSH' }] },
  })
  ctx.emit('session/event', SESSION, {
    type: 'user/message',
    surfaceOp: 'append',
    data: { source: { kind: 'time-context', form: 'snapshot' }, content: [{ type: 'text', text: 'Time sampled while preparing turn 2, step 1' }] },
  })
  ctx.emit('session/event', SESSION, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  assert.equal(ctx.logs.filter((entry) => entry.line.includes('popup shown')).length, 1, lines(ctx))
})

await check('enabled: false installs nothing', async () => {
  const ctx = load({ enabled: false })
  runTurn(ctx)
  assert.equal(ctx.logs.filter((entry) => entry.line.includes('popup shown')).length, 0, lines(ctx))
})

await check('a session/event handler that throws never propagates', async () => {
  const ctx = load({ minDurationMs: 0, sound: false })
  ctx.emit('session/event', null, null)
  ctx.emit('session/event', { id: 'x' }, { type: 'turn/end', data: {} })
  assert.equal(ctx.logs.filter((entry) => entry.level === 'warn').length, 0, lines(ctx))
})

await check('a logFile records the load marker and every popup', async () => {
  const { readFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(tmpdir(), `dsh-turn-notify-${String(Date.now())}.jsonl`)
  try {
    const ctx = load({ minDurationMs: 0, sound: false, logFile: file })
    runTurn(ctx)
    const rows = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.ok(rows.some((row) => row.event === 'loaded'), 'no loaded marker')
    const popup = rows.find((row) => row.event === 'popup')
    assert.ok(popup !== undefined, 'no popup row')
    assert.equal(popup.kind, 'completed')
    spawned.push(Number(popup.pid))
  } finally {
    rmSync(file, { force: true })
  }
})

console.log(results.join('\n'))
console.log(`\nspawned popups: ${spawned.join(', ') || 'none'}`)
console.log(process.exitCode === 1 ? 'RESULT: FAILED' : 'RESULT: PASSED')
console.log(`cleanup: Stop-Process -Id ${spawned.join(',')} -Force`)
