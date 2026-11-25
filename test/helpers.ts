import type { Http } from '../src/api.ts'

/** 25 Nov 2026, 16:00 in Berlin. */
export const NOW = Date.parse('2026-11-25T15:00:00Z')

/** Response shapes as returned by the Melious account endpoints (sample values). */
export const SAMPLE = {
  balance: {
    energy: '230287.6102',
    credits: '0.0191133200',
    energy_max: '256000.0000',
    energy_regen_rate: '2000.0000',
    last_energy_regen_at: '2026-11-25T15:20:10.952468+00:00',
    is_overcharged: false
  },
  subscription: {
    plan_name: 'Basic',
    status: 'active',
    current_period_end: '2026-12-12T19:05:09+00:00',
    plan_category: 'energy'
  },
  estimate: {
    estimated_tokens: 195189110,
    used_percent: 19.3,
    period_end: '2026-12-12T19:05:09+00:00'
  },
  usage: {
    period: 'month',
    total_requests: 9267,
    total_input_tokens: 901059375,
    total_output_tokens: 6060841,
    total_energy: 377239.2719,
    total_credits: 37.72392719,
    total_carbon_g: 7361.2103,
    total_energy_kwh: 37.263565,
    total_cached_tokens: 856625600,
    top_models: { 'deepseek-v4.1-flash-1017': 3529, 'glm-5.3-flash': 5071 },
    daily_aggregates: [
      { date: '2026-11-24', credits_total: 3.1 },
      { date: '2026-11-25', credits_total: 2.45 }
    ]
  }
}

export interface Reply {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export function routes(overrides: Partial<Record<'balance' | 'subscription' | 'estimate' | 'usage', Reply>> = {}): Record<string, Reply> {
  return {
    '/v1/billing/balance': overrides.balance ?? { status: 200, body: SAMPLE.balance },
    '/v1/billing/subscription': overrides.subscription ?? { status: 200, body: SAMPLE.subscription },
    '/v1/billing/subscription/token-estimate': overrides.estimate ?? { status: 200, body: SAMPLE.estimate },
    '/v1/account/usage?period=month': overrides.usage ?? { status: 200, body: SAMPLE.usage }
  }
}

export function fakeHttp(table: Record<string, Reply>): { http: Http; seen: Array<{ path: string; auth?: string }> } {
  const seen: Array<{ path: string; auth?: string }> = []
  const http: Http = async (url, init) => {
    const path = url.replace('https://api.melious.ai', '')
    seen.push({ path, auth: init.headers.Authorization })
    const reply = table[path] ?? { status: 404, body: {} }
    return {
      ok: reply.status < 300,
      status: reply.status,
      headers: { get: (h) => reply.headers?.[h.toLowerCase()] ?? null },
      json: async () => reply.body
    }
  }
  return { http, seen }
}
