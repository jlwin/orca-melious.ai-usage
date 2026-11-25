import { POINTS_PER_EURO } from './api.ts'
import type { Config, KeyOrigin, StatusView, Tone, UsageReport } from './types.ts'

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const one = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const PERIOD_TITLE = { day: 'Today', week: 'Last 7 days', month: 'Last 30 days' } as const

export const NO_KEY: StatusView = {
  text: 'Melious · no key',
  tone: 'neutral',
  tooltip: 'Add a Melious API key in Settings → Plugins → Melious Usage (create one at melious.ai/account/api/keys), or set MELIOUS_API_KEY, or run `melious auth login`.'
}

export const LOADING: StatusView = { text: 'Melious …', tone: 'neutral', tooltip: 'Loading Melious usage…' }

/** Energy left in the tank as 0–100, when the capacity is known. */
export function tankLeftPct(report: UsageReport): number | null {
  const t = report.tank
  return t && t.capacity ? Math.min(100, Math.max(0, (t.points / t.capacity) * 100)) : null
}

function tone(report: UsageReport): Tone {
  if (report.tank?.overdrawn) return 'danger'
  const left = tankLeftPct(report)
  return left === null ? 'neutral' : left <= 10 ? 'danger' : left <= 25 ? 'warning' : 'neutral'
}

export function headline(config: Config, report: UsageReport): string {
  const left = tankLeftPct(report)
  const spent = report.totals?.spentEur ?? null
  const energyPart = left === null ? null : `${Math.round(left)}%`
  const spendPart = spent === null ? null : eur.format(spent)
  const wanted =
    config.display === 'energy' ? [energyPart] : config.display === 'spend' ? [spendPart] : [energyPart, spendPart]
  let parts = wanted.filter((p): p is string => p !== null)
  if (parts.length === 0) {
    const fallback = energyPart ?? spendPart ?? (report.plan?.usedPct != null ? `plan ${Math.round(report.plan.usedPct)}%` : null)
    parts = fallback ? [fallback] : []
  }
  return ['Melious', parts.join(' · ')].filter(Boolean).join(' ')
}

function age(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

function renewal(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const date = new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin' })
  const days = Math.ceil((at - now) / 86_400_000)
  return days > 0 ? `renews ${date} (in ${days} d)` : `renewed ${date}`
}

export function details(report: UsageReport, origin: KeyOrigin, now: number): string {
  const out: string[] = []
  const { tank, plan, totals } = report

  out.push(['Melious', plan?.name, plan?.status && plan.status !== 'active' ? `(${plan.status})` : null].filter(Boolean).join(' · ').replace(' · (', ' ('))

  if (tank) {
    const left = tankLeftPct(report)
    const worth = eur.format(tank.points / POINTS_PER_EURO)
    out.push(
      tank.capacity && left !== null
        ? `Energy: ${Math.round(left)}% left (${int.format(tank.points)} of ${int.format(tank.capacity)}, ≈ ${worth})`
        : `Energy: ${int.format(tank.points)} (≈ ${worth})`
    )
    if (tank.overdrawn) out.push('⚠ Energy overdrawn')
  }
  if (report.creditsEur !== null) out.push(`Credits: ${eur.format(report.creditsEur)}`)

  if (plan && (plan.usedPct !== null || plan.renewsAt)) {
    const bits = [
      plan.usedPct !== null ? `${one.format(plan.usedPct)}% used` : null,
      plan.tokensLeftEstimate !== null ? `≈ ${compact.format(plan.tokensLeftEstimate)} tokens left` : null,
      plan.renewsAt ? renewal(plan.renewsAt, now) : null
    ].filter(Boolean)
    out.push(`Billing period: ${bits.join(' · ')}`)
  }

  if (totals) {
    out.push('', `${PERIOD_TITLE[totals.period]}:`)
    if (totals.spentEur !== null) {
      const today = totals.period !== 'day' && totals.todayEur !== null ? ` (today ${eur.format(totals.todayEur)})` : ''
      out.push(`  Spend: ${eur.format(totals.spentEur)}${today}`)
    }
    if (totals.requests !== null) out.push(`  Requests: ${int.format(totals.requests)}`)
    if (totals.tokensIn !== null || totals.tokensOut !== null) {
      const cached = totals.tokensCached ? ` (${compact.format(totals.tokensCached)} cached)` : ''
      out.push(`  Tokens: ${compact.format(totals.tokensIn ?? 0)} in${cached} · ${compact.format(totals.tokensOut ?? 0)} out`)
    }
    const footprint = [
      totals.kwh !== null ? `${one.format(totals.kwh)} kWh` : null,
      totals.co2Grams !== null ? (totals.co2Grams >= 1000 ? `${one.format(totals.co2Grams / 1000)} kg CO₂e` : `${int.format(totals.co2Grams)} g CO₂e`) : null
    ].filter(Boolean)
    if (footprint.length) out.push(`  Footprint: ${footprint.join(' · ')}`)
    if (totals.favouriteModel) out.push(`  Top model: ${totals.favouriteModel}`)
  }

  out.push('')
  if (report.missing.length) out.push(`⚠ Not loaded: ${report.missing.join(', ')}`)
  const via = origin === 'env' ? ' · key from MELIOUS_API_KEY' : origin === 'cli' ? ' · key from melious CLI' : ''
  out.push(`Updated ${age(now - report.takenAt)}${via} · click to refresh`)
  return out.join('\n')
}

/** What the status bar item shows: the newest report, or the last good one plus the error. */
export function render(config: Config, report: UsageReport | null, error: string | null, origin: KeyOrigin, now = Date.now()): StatusView {
  if (!report) {
    return error ? { text: 'Melious · offline', tone: 'warning', tooltip: `${error}\nClick to retry.` } : LOADING
  }
  const tooltip = details(report, origin, now)
  return { text: headline(config, report), tone: tone(report), tooltip: error ? `${tooltip}\n⚠ ${error}` : tooltip }
}
