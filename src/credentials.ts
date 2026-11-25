import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { KeyOrigin } from './types.ts'

export const SECRET_NAME = 'apiKey'

/** The slice of Orca's worker API this module needs. */
export interface KeyStore {
  secrets: { get(name: string): Promise<unknown>; set(name: string, value: string): Promise<unknown>; delete(name: string): Promise<unknown> }
  settings: { set(key: string, value: unknown): Promise<unknown> }
  log(message: string): void
}

export interface Found {
  key: string
  origin: KeyOrigin
}

const CLI_KEY = /sk-mel-[\w-]{8,}/

export async function keyFromCli(read: () => Promise<string> = () => readFile(join(homedir(), '.melious', 'credentials.json'), 'utf8')): Promise<string | null> {
  try {
    return CLI_KEY.exec(await read())?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Finds the key to use, in this order:
 * 1. a value just typed into the settings field — moved into the encrypted
 *    secret store and the field cleared (`onMove` lets the caller ignore the
 *    resulting settings echo);
 * 2. the stored secret;
 * 3. MELIOUS_API_KEY;
 * 4. the credentials file written by `melious auth login`.
 */
export async function findKey(
  store: KeyStore,
  typed: string,
  opts: { env?: NodeJS.ProcessEnv; readCli?: () => Promise<string>; onMove?: (move: () => Promise<void>) => Promise<void> } = {}
): Promise<Found | null> {
  let saved = ''
  try {
    const value = await store.secrets.get(SECRET_NAME)
    if (typeof value === 'string') saved = value
  } catch {
    // secret store unavailable; fall through
  }

  if (typed && typed !== saved) {
    const move = async () => {
      await store.secrets.set(SECRET_NAME, typed)
      await store.settings.set('apiKey', '')
    }
    try {
      await (opts.onMove ? opts.onMove(move) : move())
    } catch (err) {
      store.log(`melious-usage: secret store unavailable, key stays in settings (${err instanceof Error ? err.message : String(err)})`)
    }
    return { key: typed, origin: 'settings' }
  }
  if (saved) return { key: saved, origin: 'settings' }

  const env = (opts.env ?? process.env).MELIOUS_API_KEY?.trim()
  if (env) return { key: env, origin: 'env' }

  const cli = await keyFromCli(opts.readCli)
  return cli ? { key: cli, origin: 'cli' } : null
}
