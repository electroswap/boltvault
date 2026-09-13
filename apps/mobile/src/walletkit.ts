/**
 * Reown WalletKit on the phone (master plan §5.3) behind the engine's
 * `WalletKitLike`: every event payload is validated before the engine sees
 * it, Verify's verdict rides along with proposals and requests, and the
 * project id is the wallet's own (never the interface's dApp id). Without a
 * project id WalletConnect is simply off.
 */
import '@walletconnect/react-native-compat'
import {
  SessionProposalSchema,
  SessionRequestSchema,
  type ActiveSession,
  type JsonRpcResponse,
  type SessionProposal,
  type SessionRequest,
  type WalletKitLike,
} from '@boltvault/connect'
import { z } from 'zod'

/** The wallet's own Reown project (a public identifier); an env value overrides it. */
export const WALLETCONNECT_PROJECT_ID =
  process.env['EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? 'f1eaee6b74bd39f43339dfff17927630'

/*
  What a dApp shows as BoltVault's identity in its connect sheet.

  Both values used to name `wallet.electroswap.io`, a host that has never
  existed — so the sheet quoted a site nobody could open and the icon slot fell
  back to a placeholder. `app.electroswap.io` is where the wallet lives as far
  as the outside world is concerned: it is the origin the universal links are
  associated with, and the one Reown's Verify API checks this metadata against.
  The icon is a file that is actually committed and served.
*/
const METADATA = {
  name: 'BoltVault',
  description: 'The Electroneum wallet and ElectroSwap uber-app.',
  url: 'https://app.electroswap.io',
  icons: ['https://electroswap.io/img/store/boltvault-logo-128.png'],
}

/*
  `isScam` is read as well as `validation`. They answer different questions —
  one whether the metadata matches the domain it was registered from, the other
  whether that domain is on Reown's malicious list — and only the first was
  parsed, so a proposal Verify had flagged outright reached the Connect sheet
  as merely "unverified".
*/
const Verify = z
  .object({
    verified: z
      .object({
        validation: z.enum(['VALID', 'INVALID', 'UNKNOWN']).optional(),
        origin: z.string().optional(),
        isScam: z.boolean().optional(),
      })
      .optional(),
  })
  .optional()
const ProposalEvent = z.object({
  id: z.number(),
  params: z.object({
    pairingTopic: z.string().optional(),
    proposer: z.object({
      metadata: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        url: z.string().optional(),
        icons: z.array(z.string()).optional(),
      }),
    }),
    requiredNamespaces: z
      .record(
        z.string(),
        z.object({
          chains: z.array(z.string()).optional(),
          methods: z.array(z.string()).optional(),
          events: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    optionalNamespaces: z
      .record(
        z.string(),
        z.object({
          chains: z.array(z.string()).optional(),
          methods: z.array(z.string()).optional(),
          events: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  }),
  verifyContext: Verify,
})
const RequestEvent = z.object({
  id: z.number(),
  topic: z.string(),
  params: z.object({
    request: z.object({ method: z.string(), params: z.unknown() }),
    chainId: z.string(),
  }),
  verifyContext: Verify,
})
const SessionStruct = z.object({
  topic: z.string(),
  expiry: z.number(),
  peer: z.object({
    metadata: z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      url: z.string().optional(),
      icons: z.array(z.string()).optional(),
    }),
  }),
  namespaces: z.record(
    z.string(),
    z.object({ chains: z.array(z.string()).optional(), accounts: z.array(z.string()) }),
  ),
})

interface KitApi {
  pair(input: { uri: string }): Promise<unknown>
  approveSession(input: { id: number; namespaces: unknown }): Promise<unknown>
  rejectSession(input: { id: number; reason: { code: number; message: string } }): Promise<void>
  respondSessionRequest(input: { topic: string; response: JsonRpcResponse }): Promise<void>
  disconnectSession(input: {
    topic: string
    reason: { code: number; message: string }
  }): Promise<void>
  emitSessionEvent(input: {
    topic: string
    chainId: string
    event: { name: string; data: unknown }
  }): Promise<void>
  getActiveSessions(): Record<string, unknown>
  on(event: string, listener: (payload: unknown) => void): unknown
  off(event: string, listener: (payload: unknown) => void): unknown
}

function toSession(raw: unknown): ActiveSession | null {
  const s = SessionStruct.safeParse(raw)
  if (!s.success) return null
  const eip = s.data.namespaces['eip155']
  return {
    topic: s.data.topic,
    expiry: s.data.expiry,
    peer: {
      name: s.data.peer.metadata.name ?? '',
      description: s.data.peer.metadata.description ?? '',
      url: s.data.peer.metadata.url ?? '',
      icons: s.data.peer.metadata.icons ?? [],
    },
    chains: eip?.chains ?? [],
    accounts: eip?.accounts ?? [],
  }
}

/** Build the adapter; resolves null when no project id is configured. */
/**
 * A key-value store for WalletConnect, backed by the encrypted MMKV instance.
 *
 * The shape is `@walletconnect/keyvaluestorage`'s: everything is JSON, and
 * `getKeys`/`getEntries` are used at startup to restore sessions.
 */
async function wcStorage(): Promise<never> {
  const { secretStore } = await import('./platform')
  const store = await secretStore()
  const key = (k: string): string => `wc:${k}`
  return {
    getKeys: async () => (await store.keys()).filter((k) => k.startsWith('wc:')).map((k) => k.slice(3)),
    getEntries: async () => {
      const out: Array<[string, unknown]> = []
      for (const k of await store.keys()) {
        if (!k.startsWith('wc:')) continue
        const raw = await store.get(k)
        if (raw !== null) out.push([k.slice(3), JSON.parse(raw) as unknown])
      }
      return out
    },
    getItem: async (k: string) => {
      const raw = await store.get(key(k))
      return raw === null ? undefined : (JSON.parse(raw) as unknown)
    },
    setItem: async (k: string, v: unknown) => {
      await store.set(key(k), JSON.stringify(v))
    },
    removeItem: async (k: string) => {
      await store.remove(key(k))
    },
    // The interface is `IKeyValueStorage`; the shape above is all of it.
  } as never
}

export async function createWalletKit(): Promise<WalletKitLike | null> {
  if (!WALLETCONNECT_PROJECT_ID) return null
  const [{ WalletKit }, { Core }] = await Promise.all([
    import('@reown/walletkit'),
    import('@walletconnect/core'),
  ])
  /*
    WalletConnect's own keys go in the encrypted store (ES-BV-042).

    `new Core({ projectId })` with no `storage` falls back to AsyncStorage,
    which on both platforms is a plain file in the app container: the pairing
    symmetric keys and the session keys sat there in the clear. They are
    app-private, so this is not a remote-read exposure — but they are key
    material, the wallet already has an AES-256 MMKV instance for key material,
    and there is no reason for these to be the exception.
  */
  const core = new Core({ projectId: WALLETCONNECT_PROJECT_ID, storage: await wcStorage() })
  const kit = (await WalletKit.init({ core, metadata: METADATA })) as unknown as KitApi
  return {
    pair: async ({ uri }) => {
      await kit.pair({ uri })
    },
    approveSession: async ({ id, namespaces }) => {
      const s = toSession(await kit.approveSession({ id, namespaces }))
      if (!s) throw new Error('WalletConnect returned a session the wallet cannot read.')
      return s
    },
    rejectSession: (input) => kit.rejectSession(input),
    respondSessionRequest: (input) => kit.respondSessionRequest(input),
    disconnectSession: (input) => kit.disconnectSession(input),
    emitSessionEvent: (input) => kit.emitSessionEvent(input),
    getActiveSessions: () =>
      Object.values(kit.getActiveSessions())
        .map(toSession)
        .filter((s): s is ActiveSession => s !== null),
    on: ((
      event: 'session_proposal' | 'session_request' | 'session_delete',
      listener: (arg: never) => void,
    ): (() => void) => {
      const wrapped = (payload: unknown): void => {
        if (event === 'session_proposal') {
          const p = ProposalEvent.safeParse(payload)
          if (!p.success) return
          const proposal: SessionProposal = SessionProposalSchema.parse({
            id: p.data.id,
            pairingTopic: p.data.params.pairingTopic,
            proposer: {
              name: p.data.params.proposer.metadata.name ?? '',
              description: p.data.params.proposer.metadata.description ?? '',
              url: p.data.params.proposer.metadata.url ?? '',
              icons: p.data.params.proposer.metadata.icons ?? [],
            },
            requiredNamespaces: p.data.params.requiredNamespaces ?? {},
            optionalNamespaces: p.data.params.optionalNamespaces ?? {},
            verified: p.data.verifyContext?.verified?.validation ?? 'UNKNOWN',
            verifiedOrigin:
              p.data.verifyContext?.verified?.validation === 'VALID'
                ? (p.data.verifyContext.verified.origin ?? null)
                : null,
            isScam: p.data.verifyContext?.verified?.isScam ?? null,
          })
          ;(listener as (p: SessionProposal) => void)(proposal)
        } else if (event === 'session_request') {
          const r = RequestEvent.safeParse(payload)
          if (!r.success) return
          const request: SessionRequest = SessionRequestSchema.parse({
            id: r.data.id,
            topic: r.data.topic,
            chainId: r.data.params.chainId,
            method: r.data.params.request.method,
            params: r.data.params.request.params,
            verified: r.data.verifyContext?.verified?.validation ?? 'UNKNOWN',
          })
          ;(listener as (r: SessionRequest) => void)(request)
        } else {
          const d = z.object({ topic: z.string() }).safeParse(payload)
          if (d.success) (listener as (i: { topic: string }) => void)(d.data)
        }
      }
      kit.on(event, wrapped)
      return () => {
        kit.off(event, wrapped)
      }
    }) as WalletKitLike['on'],
  }
}
