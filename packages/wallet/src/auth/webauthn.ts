/**
 * Passkeys on the web (extension pages): WebAuthn with the `prf` extension
 * (master plan §3.2). The PRF output, evaluated over a fixed salt, is the
 * secret that unwraps the vault DEK — the credential never sees the DEK.
 *
 * Availability is detected, never assumed: some browsers lack `prf`, and a
 * credential created without it cannot be upgraded. In that case the UI
 * offers "Passkey + password" instead (§8.1).
 */
import type { PasskeyProvider, PasskeyResult } from '../host'

const PRF_SALT = new TextEncoder().encode('boltvault/vault-unlock/v1')

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
}

export function createWebAuthnPasskeys(): PasskeyProvider {
  return {
    async supported() {
      if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) return false
      try {
        const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        if (!platform) return false
        const caps = (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities
        if (caps) {
          const c = await caps()
          return c['extension:prf'] !== false
        }
        return true
      } catch {
        return false
      }
    },

    async create({ userName, userIdHex, rpName }): Promise<PasskeyResult> {
      const cred = (await navigator.credentials.create({
        publicKey: {
          rp: { name: rpName },
          user: { id: Uint8Array.from(userIdHex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []), name: userName, displayName: userName },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [
            { type: 'public-key', alg: -8 },
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
          extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null
      if (!cred) throw new Error('no credential was created')
      const ext = cred.getClientExtensionResults() as PrfResults
      const first = ext.prf?.results?.first
      if (!first) {
        // Created without PRF support: the credential is usable only as "passkey + password" — refuse so the UI can explain.
        throw new Error('prf-unsupported')
      }
      return { credentialId: b64url(new Uint8Array(cred.rawId)), prfSecretHex: hex(new Uint8Array(first)) }
    },

    async get(credentialIds): Promise<PasskeyResult> {
      const cred = (await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: credentialIds.map((id) => ({ type: 'public-key' as const, id: fromB64url(id) as BufferSource })),
          userVerification: 'required',
          extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null
      if (!cred) throw new Error('no credential was returned')
      const ext = cred.getClientExtensionResults() as PrfResults
      const first = ext.prf?.results?.first
      if (!first) throw new Error('prf-unsupported')
      return { credentialId: b64url(new Uint8Array(cred.rawId)), prfSecretHex: hex(new Uint8Array(first)) }
    },
  }
}
