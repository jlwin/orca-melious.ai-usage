/**
 * Runs a task now and then again and again. After a success it waits the
 * normal interval; after a failure it waits longer each time (1×, 2×, 4× …
 * the interval, at most 30 min), or exactly as long as the server asked.
 * A trigger while the task is running is remembered and runs right after.
 */
export type Outcome = { ok: true } | { ok: false; waitMs?: number | null }

export const MAX_WAIT_MS = 30 * 60_000

export class Poller {
  private handle: ReturnType<typeof setTimeout> | null = null
  private running = false
  private again = false
  private stopped = true
  private strikes = 0
  private readonly task: () => Promise<Outcome>
  private readonly intervalMs: () => number
  private readonly random: () => number

  constructor(task: () => Promise<Outcome>, intervalMs: () => number, random: () => number = Math.random) {
    this.task = task
    this.intervalMs = intervalMs
    this.random = random
  }

  start(): void {
    this.stopped = false
    this.trigger()
  }

  stop(): void {
    this.stopped = true
    if (this.handle) clearTimeout(this.handle)
    this.handle = null
  }

  /** Run as soon as possible; resets the failure streak. */
  trigger(): void {
    this.strikes = 0
    this.wait(0)
  }

  /** The delay after an outcome, ±10 % spread so many clients don't align. */
  delayAfter(outcome: Outcome): number {
    if (!outcome.ok && outcome.waitMs && outcome.waitMs > 0) return Math.min(outcome.waitMs, MAX_WAIT_MS)
    const factor = outcome.ok ? 1 : 2 ** Math.min(this.strikes - 1, 5)
    const base = Math.min(this.intervalMs() * factor, MAX_WAIT_MS)
    return Math.round(base * (0.9 + 0.2 * this.random()))
  }

  private wait(ms: number): void {
    if (this.stopped) return
    if (this.running) {
      if (ms === 0) this.again = true
      return
    }
    if (this.handle) clearTimeout(this.handle)
    this.handle = setTimeout(() => void this.run(), ms)
  }

  private async run(): Promise<void> {
    this.handle = null
    this.running = true
    let outcome: Outcome
    try {
      outcome = await this.task()
    } catch {
      outcome = { ok: false }
    }
    this.strikes = outcome.ok ? 0 : this.strikes + 1
    this.running = false
    if (this.again) {
      this.again = false
      this.wait(0)
    } else {
      this.wait(this.delayAfter(outcome))
    }
  }
}
