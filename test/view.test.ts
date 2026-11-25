import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadUsage } from '../src/api.ts'
import { readConfig } from '../src/config.ts'
import type { UsageReport } from '../src/types.ts'
import { LOADING, render } from '../src/view.ts'
import { NOW, SAMPLE, fakeHttp, routes } from './helpers.ts'

async function report(table = routes()): Promise<UsageReport> {
  const result = await loadUsage('k', 'month', { http: fakeHttp(table).http, clock: () => NOW })
  assert.equal(result.kind, 'report')
  return (result as { report: UsageReport }).report
}

const config = readConfig({})

describe('render', () => {
  it('shows energy left and spend', async () => {
    const view = render(config, await report(), null, 'settings', NOW)
    assert.equal(view.text, 'Melious 90% · €37.72')
    assert.equal(view.tone, 'neutral')
    for (const line of [/Melious · Basic/, /Energy: 90% left \(230,288 of 256,000, ≈ €23\.03\)/, /19\.3% used/, /renews 12 Dec 2026 \(in 18 d\)/, /Spend: €37\.72 \(today €2\.45\)/, /Top model: glm-5\.3-flash/, /Updated just now/]) {
      assert.match(view.tooltip, line)
    }
  })

  it('respects the display setting and falls back when data is missing', async () => {
    const full = await report()
    assert.equal(render({ ...config, display: 'energy' }, full, null, 'settings', NOW).text, 'Melious 90%')
    assert.equal(render({ ...config, display: 'spend' }, full, null, 'settings', NOW).text, 'Melious €37.72')
    const noTank = await report(routes({ balance: { status: 401 } }))
    assert.equal(render({ ...config, display: 'energy' }, noTank, null, 'settings', NOW).text, 'Melious €37.72')
    assert.match(render(config, noTank, null, 'settings', NOW).tooltip, /Not loaded: balance \(HTTP 401\)/)
  })

  it('colours the item as the tank runs low', async () => {
    const at = async (energy: string, overdrawn = false) =>
      render(config, await report(routes({ balance: { status: 200, body: { ...SAMPLE.balance, energy, is_overcharged: overdrawn } } })), null, 'settings', NOW).tone
    assert.equal(await at('60000'), 'warning')
    assert.equal(await at('20000'), 'danger')
    assert.equal(await at('200000', true), 'danger')
  })

  it('keeps the last report when a refresh fails, else shows offline', async () => {
    const view = render(config, await report(), 'Melious unreachable (timeout).', 'env', NOW)
    assert.equal(view.text, 'Melious 90% · €37.72')
    assert.match(view.tooltip, /key from MELIOUS_API_KEY/)
    assert.match(view.tooltip, /⚠ Melious unreachable/)
    assert.deepEqual(render(config, null, 'boom', 'settings', NOW), { text: 'Melious · offline', tone: 'warning', tooltip: 'boom\nClick to retry.' })
    assert.deepEqual(render(config, null, null, 'settings', NOW), LOADING)
  })
})

describe('readConfig', () => {
  it('applies defaults and bounds', () => {
    assert.deepEqual(readConfig({ apiKey: ' k ', period: 'week', display: 'spend', refreshMinutes: 999 }), { apiKey: 'k', period: 'week', display: 'spend', refreshMinutes: 60 })
    assert.deepEqual(readConfig({ period: 'year', display: 1, refreshMinutes: 'x' }), { apiKey: '', period: 'month', display: 'both', refreshMinutes: 5 })
    assert.deepEqual(readConfig(null), { apiKey: '', period: 'month', display: 'both', refreshMinutes: 5 })
  })
})
