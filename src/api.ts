import type { EnergyTank, LoadResult, Period, PeriodTotals, PlanInfo, UsageReport } from './types.ts'

export const API_BASE = 'https://api.melious.ai'
export const POINTS_PER_EURO = 10_000

/**
 * The account endpoints behind melious.ai/account/usage. They are not part of
 * the public API reference, so every field is read defensively.
 */
export const PATHS = {
  balance: '/v1/billing/balance',
  subscription: '/v1/billing/subscription',
  estimate: '/v1/billing/subscription/token-estimate',
  usage: (period: Period) => `/v1/account/usage?period=${period}`
}

export interface HttpResponse {
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  json(): Promise<unknown>
}
export type Http = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<HttpResponse>

type Json = Record<string, unknown>
type Section = { data: Json } | { status: number | null; reason: string; retryAfter: string | null }

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)

export function readTank(balance: Json | null): { tank: EnergyTank | null; creditsEur: number | null } {
  const points = num(balance?.energy)
  const capacity = num(balance?.energy_max)
  return {
    tank:
      points === null
        ? null
        : { points, capacity: capacity && capacity > 0 ? capacity : null, regenRate: num(balance?.energy_regen_rate), overdrawn: balance?.is_overcharged === true },
    creditsEur: num(balance?.credits)
  }
}

export function readPlan(subscription: Json | null, estimate: Json | null): PlanInfo | null {
  if (!subscription && !estimate) return null
  const used = num(estimate?.used_percent)
  return {
    name: str(subscription?.plan_name),
    status: str(subscription?.status),
    usedPct: used === null ? null : Math.min(100, Math.max(0, used)),
    tokensLeftEstimate: num(estimate?.estimated_tokens),
    renewsAt: str(estimate?.period_end) ?? str(subscription?.current_period_end)
  }
}

/** Calendar day in Berlin as YYYY-MM-DD, the format of `daily_aggregates[].date`. */
export function berlinDay(at: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(at)
}

export function readTotals(usage: Json | null, period: Period, at: number): PeriodTotals | null {
  if (!usage) return null
  const fromPoints = (p: number | null) => (p === null ? null : p / POINTS_PER_EURO)

  const models = Object.entries(obj(usage.top_models) ?? {})
    .map(([id, count]) => [id, num(count) ?? 0] as const)
    .sort((a, b) => b[1] - a[1])

  let todayEur: number | null = null
  if (Array.isArray(usage.daily_aggregates)) {
    const today = usage.daily_aggregates.map(obj).find((d) => d?.date === berlinDay(at))
    todayEur = today ? (num(today.credits_total) ?? fromPoints(num(today.energy_total)) ?? 0) : 0
  }

  return {
    period,
    spentEur: num(usage.total_credits) ?? fromPoints(num(usage.total_energy)),
    todayEur,
    requests: num(usage.total_requests),
    tokensIn: num(usage.total_input_tokens),
    tokensOut: num(usage.total_output_tokens),
    tokensCached: num(usage.total_cached_tokens),
    kwh: num(usage.total_energy_kwh),
    co2Grams: num(usage.total_carbon_g),
    favouriteModel: models[0]?.[0] ?? null
  }
}

async function getSection(http: Http, key: string, path: string, signal: AbortSignal): Promise<Section> {
  try {
    const res = await http(API_BASE + path, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal })
    if (!res.ok) return { status: res.status, reason: `HTTP ${res.status}`, retryAfter: res.headers?.get('retry-after') ?? null }
    const data = obj(await res.json())
    return data ? { data } : { status: res.status, reason: 'unexpected response', retryAfter: null }
  } catch (err) {
    const timedOut = signal.aborted || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
    const reason = timedOut ? 'timeout' : err instanceof Error && err.message ? err.message : 'network error'
    return { status: null, reason, retryAfter: null }
  }
}

function retryDelay(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

/**
 * Reads the whole account in one go. Each section stands on its own: a report
 * is returned as soon as any of them answered. Never throws, never echoes the key.
 */
export async function loadUsage(
  key: string,
  period: Period,
  opts: { http?: Http; timeoutMs?: number; clock?: () => number } = {}
): Promise<LoadResult> {
  const http = opts.http ?? (fetch as unknown as Http)
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000)
  const names = ['balance', 'subscription', 'estimate', 'usage'] as const
  const paths = [PATHS.balance, PATHS.subscription, PATHS.estimate, PATHS.usage(period)]
  const sections = await Promise.all(paths.map((p) => getSection(http, key, p, signal)))
  const at = (opts.clock ?? Date.now)()

  const data = (i: number): Json | null => {
    const s = sections[i]
    return s && 'data' in s ? s.data : null
  }
  const { tank, creditsEur } = readTank(data(0))
  const plan = readPlan(data(1), data(2))
  const totals = readTotals(data(3), period, at)

  const failed = sections.flatMap((s, i) => ('data' in s ? [] : [{ name: names[i], ...s }]))

  if (tank || creditsEur !== null || plan || totals) {
    return { kind: 'report', report: { takenAt: at, tank, creditsEur, plan, totals, missing: failed.map((f) => `${f.name} (${f.reason})`) } }
  }

  const statuses = failed.map((f) => f.status)
  const rateLimited = failed.find((f) => f.status === 429)
  const message = statuses.length > 0 && statuses.every((s) => s === 401 || s === 403)
    ? 'API key rejected. Check it in the plugin settings.'
    : rateLimited
      ? 'Rate limited by Melious (429).'
      : `Melious unreachable (${failed[0]?.reason ?? 'no data'}).`
  return { kind: 'failure', message, retryInMs: rateLimited ? retryDelay(rateLimited.retryAfter) : null }
}
