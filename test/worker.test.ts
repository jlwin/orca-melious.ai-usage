import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { OrcaWorkerApi } from 'orca/worker'
import activate, { deactivate } from '../src/main.ts'
import { findKey, keyFromCli } from '../src/credentials.ts'
import { Poller } from '../src/poller.ts'
import { fakeHttp, routes } from './helpers.ts'

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2))
}

function fakeOrca(settings: Record<string, unknown> = {}) {
  const state = {
    settings: { apiKey: '', period: 'month', display: 'both', refreshMinutes: 5, ...settings } as Record<string, unknown>,
    secrets: new Map<string, string>(),
    storage: new Map<string, unknown>(),
    shown: [] as Array<{ id: string; text: string; tone: string; tooltip: string }>,
    commands: new Map<string, () => void>(),
    listeners: [] as Array<(e: { key: string }) => void>,
    logs: [] as string[]
  }
  const orca = {
    settings: {
      get: async () => ({ ...state.settings }),
      set: async (key: string, value: unknown) => {
        state.settings[key] = value
        state.listeners.forEach((l) => l({ key }))
      },
      onDidChange: (l: (e: { key: string }) => void) => (state.listeners.push(l), { dispose() {} })
    },
    secrets: {
      get: async (k: string) => state.secrets.get(k) ?? null,
      set: async (k: string, v: string) => void state.secrets.set(k, v),
      delete: async (k: string) => void state.secrets.delete(k)
    },
    storage: {
      get: async (k: string) => state.storage.get(k) ?? null,
      set: async (k: string, v: unknown) => void state.storage.set(k, v),
      delete: async (k: string) => void state.storage.delete(k)
    },
    commands: { register: (id: string, fn: () => void) => (state.commands.set(id, fn), { dispose() {} }) },
    host: { call: async (_method: string, view: (typeof state.shown)[number]) => void state.shown.push(view) },
    log: (m: string) => void state.logs.push(m)
  }
  return { orca: orca as unknown as OrcaWorkerApi, state }
}

describe('worker', () => {
  let home: string | undefined
  beforeEach(() => {
    home = process.env.HOME
    process.env.HOME = '/nonexistent'
    delete process.env.MELIOUS_API_KEY
  })
  afterEach(async () => {
    await deactivate()
    process.env.HOME = home
  })

  it('moves a typed key into the secret store and shows usage', async (t) => {
    t.mock.method(globalThis, 'fetch', fakeHttp(routes()).http)
    const { orca, state } = fakeOrca({ apiKey: 'sk-mel-typed-1234' })
    await activate(orca)
    await settle()
    assert.equal(state.secrets.get('apiKey'), 'sk-mel-typed-1234')
    assert.equal(state.settings.apiKey, '')
    assert.match(state.shown.at(-1)!.text, /^Melious 90% · €37\.72$/)
    assert.ok(state.storage.has('lastReport'))
    assert.ok(!JSON.stringify([state.shown, state.logs, [...state.storage.values()]]).includes('sk-mel-typed-1234'))
  })

  it('asks for a key when none is available and makes no request', async (t) => {
    const { http, seen } = fakeHttp(routes())
    t.mock.method(globalThis, 'fetch', http)
    const { orca, state } = fakeOrca()
    await activate(orca)
    await settle()
    assert.equal(seen.length, 0)
    assert.equal(state.shown.at(-1)!.text, 'Melious · no key')
  })

  it('forgets the key on command', async (t) => {
    t.mock.method(globalThis, 'fetch', fakeHttp(routes()).http)
    const { orca, state } = fakeOrca()
    state.secrets.set('apiKey', 'sk-mel-stored-999')
    await activate(orca)
    await settle()
    state.commands.get('melious.forgetKey')!()
    await settle()
    assert.equal(state.secrets.size, 0)
    assert.equal(state.storage.size, 0)
    assert.equal(state.shown.at(-1)!.text, 'Melious · no key')
  })
})

describe('credentials', () => {
  const store = () => {
    const secrets = new Map<string, string>()
    return {
      secrets,
      api: {
        secrets: { get: async (k: string) => secrets.get(k) ?? null, set: async (k: string, v: string) => void secrets.set(k, v), delete: async (k: string) => void secrets.delete(k) },
        settings: { set: async () => undefined },
        log: () => undefined
      }
    }
  }

  it('prefers stored secret, then env, then the CLI file', async () => {
    const s = store()
    s.secrets.set('apiKey', 'stored')
    assert.deepEqual(await findKey(s.api, '', { env: { MELIOUS_API_KEY: 'env' } }), { key: 'stored', origin: 'settings' })
    const empty = store()
    assert.deepEqual(await findKey(empty.api, '', { env: { MELIOUS_API_KEY: ' env ' } }), { key: 'env', origin: 'env' })
    assert.deepEqual(await findKey(empty.api, '', { env: {}, readCli: async () => '{"key":"sk-mel-cli_abcdef12"}' }), { key: 'sk-mel-cli_abcdef12', origin: 'cli' })
    assert.equal(await findKey(empty.api, '', { env: {}, readCli: async () => '{}' }), null)
    assert.equal(await keyFromCli(async () => { throw new Error('ENOENT') }), null)
  })
})

describe('Poller', () => {
  it('backs off on failures and honours a server wait', () => {
    const p = new Poller(async () => ({ ok: true }), () => 60_000, () => 0.5)
    assert.equal(p.delayAfter({ ok: true }), 60_000)
    assert.equal(p.delayAfter({ ok: false, waitMs: 5_000 }), 5_000)
    ;(p as unknown as { strikes: number }).strikes = 3
    assert.equal(p.delayAfter({ ok: false }), 240_000)
    ;(p as unknown as { strikes: number }).strikes = 10
    assert.equal(p.delayAfter({ ok: false }), 30 * 60_000)
  })
})
