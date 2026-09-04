import { defineBackground } from '#imports'
import {
  VaultService,
  WrongPasswordError,
  type CreatedVault,
  type VaultStores,
} from '../src/vault-service'
import { localStore, sessionStore } from '../src/storage'

/**
 * MV3 service worker (T3.1 skeleton + T3.3 vault lifecycle).
 *
 * Single SW entry. T3.3 layers the vault on top of the ping liveness probe:
 *   bv:vault:create  { password, bits? }      -> CreatedVault (mnemonic to reveal)
 *   bv:vault:import  { mnemonic, password }   -> CreatedVault
 *   bv:vault:unlock  { password }             -> accounts[]
 *   bv:vault:lock    {}                       -> { ok }
 *   bv:vault:reveal  { password }             -> mnemonic
 *   bv:vault:state   {}                       -> { hasVault, unlocked }
 *
 * T3.5 replaces the ad-hoc onMessage switch with the rpcFlow router + per-origin
 * sessions. Keep this file the single SW entry.
 */

// In the SW WXT exposes the chrome/browser API as `browser`.
export default defineBackground(() => {
  const stores: VaultStores = { secret: localStore, session: sessionStore }
  const vault = VaultService.connect(stores, '5min')

  browser.runtime.onInstalled.addListener((details) => {
    console.log('[BoltVault] installed', details.reason)
  })

  browser.runtime.onMessage.addListener(
    (message: any, _sender: any, sendResponse: (resp: unknown) => void) => {
      void (async () => {
        try {
          switch (message?.type) {
            case 'bv:ping':
              return { ok: true, pong: true, ts: Date.now() }
            case 'bv:vault:create':
              return (await vault.createVault(message.password, { bits: message.bits })) as unknown as object
            case 'bv:vault:import':
              return (await vault.importVault(message.mnemonic, message.password)) as unknown as object
            case 'bv:vault:unlock':
              return { accounts: await vault.unlock(message.password) }
            case 'bv:vault:lock':
              await vault.lock()
              return { ok: true }
            case 'bv:vault:reveal':
              return { mnemonic: await vault.revealMnemonic(message.password) }
            case 'bv:vault:state':
              return { hasVault: await vault.hasVault(), unlocked: await vault.isUnlocked() }
            default:
              return { ok: false, error: 'unknown method' }
          }
        } catch (e) {
          const isWrongPw = e instanceof WrongPasswordError
          return { ok: false, error: isWrongPw ? 'wrong-password' : (e as Error).message }
        }
      })().then(sendResponse)
      return true // async response
    },
  )
})

export type { CreatedVault }
