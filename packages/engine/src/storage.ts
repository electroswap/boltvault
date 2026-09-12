/**
 * Versioned JSON documents on top of a KeyValueStore.
 *
 * Every document is stored as `{ v, data }`. On read the envelope is parsed,
 * migrated to the current version if older, and validated with zod. Anything
 * unreadable is quarantined (copied under `<key>.quarantine.<ts>`) — never
 * silently overwritten — and the default is returned (master plan §3.5).
 */
import type { KeyValueStore } from '@boltvault/platform'
import type { ZodType, ZodTypeDef } from 'zod'

export interface DocSpec<T> {
  readonly key: string
  readonly version: number
  /**
   * Validates whatever was on disk into a `T`.
   *
   * `ZodType<T, ZodTypeDef, unknown>`, not `ZodType<T>` — the latter also pins
   * the schema's INPUT to `T`, which forbids the one feature a stored document
   * most wants: `.default()`. A schema with a defaulted key accepts input
   * without it (that is the point — documents written before the key existed
   * still parse) and outputs a `T` with it filled in. Reading is the only thing
   * that parses here, and it parses `unknown`, so the input type was never
   * anyone's business.
   */
  readonly schema: ZodType<T, ZodTypeDef, unknown>
  /** Upgrade `data` written at `fromVersion` toward `version`; may return unknown. */
  readonly migrate?: (data: unknown, fromVersion: number) => unknown
  readonly defaultValue: () => T
}

interface Envelope {
  v: number
  data: unknown
}

function parseEnvelope(raw: string): Envelope | null {
  try {
    const obj: unknown = JSON.parse(raw)
    if (typeof obj !== 'object' || obj === null) return null
    const rec = obj as Record<string, unknown>
    if (typeof rec['v'] !== 'number') return null
    return { v: rec['v'], data: rec['data'] }
  } catch {
    return null
  }
}

export interface ReadDocResult<T> {
  readonly value: T
  /** True when the stored document was unreadable and has been quarantined. */
  readonly quarantined: boolean
  /** True when a migration ran (the caller should write the doc back). */
  readonly migrated: boolean
}

export async function readDoc<T>(
  store: KeyValueStore,
  spec: DocSpec<T>,
  now: () => number = Date.now,
): Promise<ReadDocResult<T>> {
  const raw = await store.get(spec.key)
  if (raw === null) return { value: spec.defaultValue(), quarantined: false, migrated: false }
  const env = parseEnvelope(raw)
  const quarantine = async (): Promise<ReadDocResult<T>> => {
    await store.set(`${spec.key}.quarantine.${now()}`, raw)
    await store.remove(spec.key)
    return { value: spec.defaultValue(), quarantined: true, migrated: false }
  }
  if (!env || env.v > spec.version) return quarantine()
  let data = env.data
  let migrated = false
  if (env.v < spec.version) {
    if (!spec.migrate) return quarantine()
    data = spec.migrate(data, env.v)
    migrated = true
  }
  const parsed = spec.schema.safeParse(data)
  if (!parsed.success) return quarantine()
  return { value: parsed.data, quarantined: false, migrated }
}

export async function writeDoc<T>(store: KeyValueStore, spec: DocSpec<T>, value: T): Promise<void> {
  const env: Envelope = { v: spec.version, data: value }
  await store.set(spec.key, JSON.stringify(env))
}
