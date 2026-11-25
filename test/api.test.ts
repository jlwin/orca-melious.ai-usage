import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadUsage, readPlan, readTank, readTotals } from '../src/api.ts'
import { NOW, SAMPLE, fakeHttp, routes } from './helpers.ts'

describe('parsers', () => {
  it('reads the energy tank from decimal strings', () => {
    const { tank, creditsEur } = readTank(SAMPLE.balance)
    assert.equal(Math.round(tank!.points), 230288)
    assert.equal(tank!.capacity, 256000)
    assert.equal(tank!.overdrawn, false)
    assert.ok(Math.abs(creditsEur! - 0.0191) < 0.001)
    assert.deepEqual(readTank(null), { tank: null, creditsEur: null })
  })

  it('combines subscription and estimate into a plan', () => {
    const plan = readPlan(SAMPLE.subscription, SAMPLE.estimate)!
    assert.equal(plan.name, 'Basic')
    assert.equal(plan.usedPct, 19.3)
    assert.equal(plan.renewsAt, '2026-12-12T19:05:09+00:00')
    assert.equal(readPlan(null, null), null)
    assert.equal(readPlan({}, { used_percent: 140 })!.usedPct, 100)
  })

  it('reads totals, the top model and today’s spend', () => {
    const t = readTotals(SAMPLE.usage, 'month', NOW)!
    assert.equal(t.spentEur, 37.72392719)
    assert.equal(t.todayEur, 2.45)
    assert.equal(t.favouriteModel, 'glm-5.3-flash')
    assert.equal(readTotals({ total_energy: 25_000 }, 'day', NOW)!.spentEur, 2.5)
  })
})

describe('loadUsage', () => {
  it('asks all four endpoints with a bearer key', async () => {
    const { http, seen } = fakeHttp(routes())
    const result = await loadUsage('sk-mel-abc', 'month', { http, clock: () => NOW })
    assert.equal(result.kind, 'report')
    assert.equal(seen.length, 4)
    assert.ok(seen.every((s) => s.auth === 'Bearer sk-mel-abc'))
    if (result.kind === 'report') assert.deepEqual(result.report.missing, [])
  })

  it('returns what it has when one section fails', async () => {
    const { http } = fakeHttp(routes({ balance: { status: 401 } }))
    const result = await loadUsage('k', 'month', { http, clock: () => NOW })
    assert.equal(result.kind, 'report')
    if (result.kind === 'report') {
      assert.equal(result.report.tank, null)
      assert.deepEqual(result.report.missing, ['balance (HTTP 401)'])
    }
  })

  it('reports a rejected key when every section is 401', async () => {
    const all401 = Object.fromEntries(Object.keys(routes()).map((p) => [p, { status: 401 }]))
    const result = await loadUsage('bad', 'month', { http: fakeHttp(all401).http })
    assert.deepEqual(result, { kind: 'failure', message: 'API key rejected. Check it in the plugin settings.', retryInMs: null })
  })

  it('honours Retry-After on 429', async () => {
    const limited = Object.fromEntries(Object.keys(routes()).map((p) => [p, { status: 429, headers: { 'retry-after': '90' } }]))
    const result = await loadUsage('k', 'month', { http: fakeHttp(limited).http })
    assert.equal(result.kind === 'failure' && result.retryInMs, 90_000)
  })

  it('turns network errors into a message without the key', async () => {
    const result = await loadUsage('sk-mel-secret', 'month', {
      http: async () => {
        throw new Error('getaddrinfo ENOTFOUND api.melious.ai')
      }
    })
    assert.equal(result.kind, 'failure')
    if (result.kind === 'failure') {
      assert.match(result.message, /ENOTFOUND/)
      assert.ok(!result.message.includes('sk-mel-secret'))
    }
  })
})
