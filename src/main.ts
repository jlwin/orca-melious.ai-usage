import type { OrcaWorkerApi } from 'orca/worker'
import { loadUsage } from './api.ts'
import { readConfig } from './config.ts'
import { SECRET_NAME, findKey, type Found } from './credentials.ts'
import { Poller } from './poller.ts'
import type { Config, StatusView, UsageReport } from './types.ts'
import { NO_KEY, render } from './view.ts'

const ITEM_ID = 'melious'
const CACHE_KEY = 'lastReport'

/** Everything the worker keeps between refreshes. */
class Plugin {
  private config: Config = readConfig({})
  private found: Found | null = null
  private last: UsageReport | null = null
  private ignoreEcho = 0
  private readonly poller = new Poller(() => this.refresh(), () => this.config.refreshMinutes * 60_000)
  private readonly cleanup: Array<{ dispose(): void }> = []
  private readonly orca: OrcaWorkerApi

  constructor(orca: OrcaWorkerApi) {
    this.orca = orca
  }

  async start(): Promise<void> {
    await this.reload()
    try {
      const cached = await this.orca.storage.get(CACHE_KEY)
      if (cached && typeof cached === 'object' && 'takenAt' in cached) this.last = cached as unknown as UsageReport
    } catch {
      // no cache yet
    }
    this.cleanup.push(
      this.orca.commands.register('melious.refresh', () => this.poller.trigger()),
      this.orca.commands.register('melious.forgetKey', () => void this.forget()),
      this.orca.settings.onDidChange(() => {
        if (this.ignoreEcho === 0) void this.onSettingsChanged()
      })
    )
    await this.show(this.found ? (this.last ? render(this.config, this.last, null, this.found.origin) : render(this.config, null, null, 'settings')) : NO_KEY)
    this.poller.start()
  }

  stop(): void {
    this.poller.stop()
    for (const item of this.cleanup.splice(0)) item.dispose()
  }

  private async reload(): Promise<void> {
    try {
      this.config = readConfig((await this.orca.settings.get()) as Record<string, unknown>)
    } catch (err) {
      this.orca.log(`melious-usage: settings unreadable: ${String(err)}`)
    }
    this.found = await findKey(this.orca as never, this.config.apiKey, {
      onMove: async (move) => {
        this.ignoreEcho++
        try {
          await move()
        } finally {
          this.ignoreEcho--
        }
      }
    })
  }

  private async refresh(): Promise<{ ok: true } | { ok: false; waitMs?: number | null }> {
    await this.reload()
    if (!this.found) {
      await this.show(NO_KEY)
      return { ok: true }
    }
    const result = await loadUsage(this.found.key, this.config.period)
    if (result.kind === 'report') {
      this.last = result.report
      await this.orca.storage.set(CACHE_KEY, result.report as never).catch(() => undefined)
      await this.show(render(this.config, this.last, null, this.found.origin))
      return { ok: true }
    }
    this.orca.log(`melious-usage: ${result.message}`)
    await this.show(render(this.config, this.last, result.message, this.found.origin))
    return { ok: false, waitMs: result.retryInMs }
  }

  private async onSettingsChanged(): Promise<void> {
    const before = { key: this.found?.key, period: this.config.period }
    await this.reload()
    if (!this.found) return this.show(NO_KEY)
    if (this.found.key !== before.key || this.config.period !== before.period) return this.poller.trigger()
    if (this.last) await this.show(render(this.config, this.last, null, this.found.origin))
  }

  private async forget(): Promise<void> {
    await this.orca.secrets.delete(SECRET_NAME).catch(() => undefined)
    if (this.config.apiKey) {
      this.ignoreEcho++
      await this.orca.settings.set('apiKey', '').catch(() => undefined)
      this.ignoreEcho--
    }
    await this.orca.storage.delete(CACHE_KEY).catch(() => undefined)
    this.last = null
    this.poller.trigger()
  }

  private async show(view: StatusView): Promise<void> {
    try {
      await this.orca.host.call('statusBar.update', { id: ITEM_ID, ...view })
    } catch (err) {
      this.orca.log(`melious-usage: status bar update failed: ${String(err)}`)
    }
  }
}

let current: Plugin | null = null

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  current?.stop()
  current = new Plugin(orca)
  await current.start()
}

export async function deactivate(): Promise<void> {
  current?.stop()
  current = null
}
