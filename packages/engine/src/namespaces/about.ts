/**
 * About — what this build is: the API origin it talks to and the optional
 * surfaces it carries. Build constants, never runtime-settable: a wallet whose
 * API could be redirected from a settings screen is a phishing target.
 */
import type { NamespaceSpec } from '../host'
import type { AboutView } from '../schema'

export function aboutNamespace(view: AboutView): NamespaceSpec {
  return { get: { handler: async () => view } }
}
