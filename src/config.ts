import type { Config, DisplayMode, Period } from './types.ts'

const PERIODS: readonly Period[] = ['day', 'week', 'month']
const DISPLAYS: readonly DisplayMode[] = ['energy', 'spend', 'both']

export const DEFAULT_CONFIG: Config = { apiKey: '', period: 'month', display: 'both', refreshMinutes: 5 }

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Turns the raw settings object Orca hands over into a complete, bounded Config. */
export function readConfig(raw: Record<string, unknown> | null | undefined): Config {
  const source = raw ?? {}
  const minutes = Number(source.refreshMinutes)
  return {
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
    period: pick(source.period, PERIODS, DEFAULT_CONFIG.period),
    display: pick(source.display, DISPLAYS, DEFAULT_CONFIG.display),
    refreshMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(60, Math.max(1, Math.round(minutes))) : DEFAULT_CONFIG.refreshMinutes
  }
}
