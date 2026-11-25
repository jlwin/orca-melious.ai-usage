export type Period = 'day' | 'week' | 'month'
export type DisplayMode = 'energy' | 'spend' | 'both'
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
export type KeyOrigin = 'settings' | 'env' | 'cli'

export interface Config {
  apiKey: string
  period: Period
  display: DisplayMode
  refreshMinutes: number
}

/** Energy points: 10,000 points are worth 1 €. */
export interface EnergyTank {
  points: number
  capacity: number | null
  regenRate: number | null
  overdrawn: boolean
}

export interface PlanInfo {
  name: string | null
  status: string | null
  /** Share of the current billing period's allowance already used, 0–100. */
  usedPct: number | null
  tokensLeftEstimate: number | null
  renewsAt: string | null
}

export interface PeriodTotals {
  period: Period
  spentEur: number | null
  todayEur: number | null
  requests: number | null
  tokensIn: number | null
  tokensOut: number | null
  tokensCached: number | null
  kwh: number | null
  co2Grams: number | null
  favouriteModel: string | null
}

/** One complete read of the account. Plain JSON so it can be cached in plugin storage. */
export interface UsageReport {
  takenAt: number
  tank: EnergyTank | null
  creditsEur: number | null
  plan: PlanInfo | null
  totals: PeriodTotals | null
  /** Sections that could not be loaded while others could, e.g. "balance (401)". */
  missing: string[]
}

export type LoadResult =
  | { kind: 'report'; report: UsageReport }
  | { kind: 'failure'; message: string; retryInMs: number | null }

export interface StatusView {
  text: string
  tone: Tone
  tooltip: string
}
