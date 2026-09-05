/**
 * Lingui from M1 (master plan §7.14). Source strings are the copy voice of
 * §7.10; `en` is the source locale, other catalogs are extracted with
 * `pnpm lingui extract` (lingui.config.ts at the root).
 */
import { i18n, type MessageDescriptor } from '@lingui/core'

export const SOURCE_LOCALE = 'en'

let activated = false

export function setupI18n(locale: string = SOURCE_LOCALE, messages: Record<string, string> = {}): void {
  i18n.load(locale, messages)
  i18n.activate(locale)
  activated = true
}

/**
 * `t({ id: 'home.receive', message: 'Receive' })` — id is stable, message is
 * the source copy. Simple `{name}` placeholders are filled here too: without
 * a compiled catalog Lingui returns the source message verbatim in production,
 * and the source locale must still read right. Plurals and rich ICU belong to
 * compiled catalogs.
 */
export function t(descriptor: MessageDescriptor): string {
  if (!activated) setupI18n()
  let out = i18n._(descriptor)
  const values = descriptor.values as Record<string, unknown> | undefined
  if (values) for (const [k, v] of Object.entries(values)) out = out.split(`{${k}}`).join(String(v))
  return out
}

export { i18n }
