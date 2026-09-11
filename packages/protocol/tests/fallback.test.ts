import { describe, expect, it } from 'vitest'
import { hasOpaqueOrigin, mintNonce, startBridge, type BridgePort, type BridgeWindow } from '../src/bridge'
import { injectPageProvider, mainWorldDeclared, pageProviderWebAccessible, PAGE_PROVIDER_FILE, type InjectableDocument, type InjectableScript } from '../src/fallback'
import { installFromChannel, type MainWorldWindow } from '../src/main-world'

/** A window whose postMessage loops back to its own listeners, like the real one. */
function fakeWindow(origin = 'https://dapp.example') {
  const listeners = new Map<string, Array<(ev: unknown) => void>>()
  const win = {
    location: { origin },
    document: {
      hidden: false,
      addEventListener: () => undefined,
    },
    addEventListener: (type: string, l: (ev: unknown) => void) => {
      const arr = listeners.get(type) ?? []
      arr.push(l)
      listeners.set(type, arr)
    },
    dispatchEvent: (ev: unknown) => {
      const e = ev as { type: string }
      for (const l of [...(listeners.get(e.type) ?? [])]) l(ev)
      return true
    },
    postMessage: (data: unknown) => {
      queueMicrotask(() => {
        for (const l of listeners.get('message') ?? []) l({ source: win, origin, data })
      })
    },
    CustomEvent: class {
      readonly type: string
      readonly detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    },
    Event: class {
      readonly type: string
      constructor(type: string) {
        this.type = type
      }
    },
    ethereum: undefined as unknown,
  }
  return win
}

const IDENTITY = { uuid: 'uuid-1', icon: 'data:image/svg+xml;base64,AA==', name: 'BoltVault', rdns: 'io.electroswap.boltvault' }

/** A `<html>` with no children yet, as the parser leaves it at document_start. */
function fakeDocument() {
  const children: InjectableScript[] = []
  const created: Array<InjectableScript & { inserted: boolean }> = []
  const doc: InjectableDocument & { readonly created: typeof created; readonly children: typeof children } = {
    documentElement: {
      get firstChild() {
        return children[0] ?? null
      },
      insertBefore(node: InjectableScript, ref: unknown) {
        const at = ref === null ? children.length : children.indexOf(ref as InjectableScript)
        children.splice(at < 0 ? children.length : at, 0, node)
        return node
      },
    },
    createElement() {
      const el: InjectableScript & { inserted: boolean } = {
        src: '',
        async: true,
        inserted: false,
        remove() {
          const i = children.indexOf(el)
          if (i >= 0) children.splice(i, 1)
        },
      }
      created.push(el)
      return el
    },
    created,
    children,
  }
  return doc
}

describe('mainWorldDeclared', () => {
  it('sees the Chrome/Firefox-128 manifest, where the MAIN-world entry survives normalisation', () => {
    expect(
      mainWorldDeclared({
        content_scripts: [{ js: ['content-scripts/content-isolated.js'] }, { js: ['content-scripts/content-main.js'], world: 'MAIN' }],
      }),
    ).toBe(true)
  })

  it('reports no MAIN world when the browser stripped the key it does not understand', () => {
    // What `runtime.getManifest()` answers on a Gecko without `world` support.
    expect(mainWorldDeclared({ content_scripts: [{ js: ['content-scripts/content-isolated.js'] }, { js: ['content-scripts/content-main.js'] }] })).toBe(false)
  })

  it('reports no MAIN world when the entry was removed from the build altogether', () => {
    expect(mainWorldDeclared({ content_scripts: [{ js: ['content-scripts/content-isolated.js'] }] })).toBe(false)
    expect(mainWorldDeclared({})).toBe(false)
  })

  it('does not mistake an explicitly isolated entry for the MAIN world', () => {
    expect(mainWorldDeclared({ content_scripts: [{ js: ['content-scripts/content-main.js'], world: 'ISOLATED' }] })).toBe(false)
  })
})

describe('pageProviderWebAccessible', () => {
  it('is true only where the build published the script — the Firefox manifest', () => {
    expect(pageProviderWebAccessible({ web_accessible_resources: [{ resources: ['page-provider.js'] }] }, PAGE_PROVIDER_FILE)).toBe(true)
  })

  it('is false on a build that keeps §3.5’s empty web_accessible_resources', () => {
    expect(pageProviderWebAccessible({}, PAGE_PROVIDER_FILE)).toBe(false)
    expect(pageProviderWebAccessible({ web_accessible_resources: [{ resources: ['harness.html'] }] }, PAGE_PROVIDER_FILE)).toBe(false)
  })
})

describe('injectPageProvider', () => {
  it('inserts the provider as the first child of documentElement and takes the element straight back out', () => {
    const doc = fakeDocument()
    expect(injectPageProvider(doc, `moz-extension://abc/${PAGE_PROVIDER_FILE}`)).toBe(true)
    expect(doc.created).toHaveLength(1)
    expect(doc.created[0]?.src).toBe('moz-extension://abc/page-provider.js')
    // Not `async`: in order, so nothing the page inserts later can jump ahead.
    expect(doc.created[0]?.async).toBe(false)
    // Nothing of ours is left for a page script to read — which is why the
    // nonce does not travel on this element.
    expect(doc.children).toHaveLength(0)
  })

  it('inserts before whatever the parser already produced, never after', () => {
    const doc = fakeDocument()
    const head = doc.createElement('script')
    doc.documentElement?.insertBefore(head, null)
    injectPageProvider(doc, 'moz-extension://abc/page-provider.js')
    expect(doc.children).toEqual([head])
  })

  it('does nothing without a documentElement', () => {
    const doc = { ...fakeDocument(), documentElement: null }
    expect(injectPageProvider(doc, 'moz-extension://abc/page-provider.js')).toBe(false)
  })

  it('reports failure rather than throwing into a content script', () => {
    const doc: InjectableDocument = {
      ...fakeDocument(),
      documentElement: {
        firstChild: null,
        insertBefore: () => {
          throw new Error('nope')
        },
      },
    }
    expect(injectPageProvider(doc, 'moz-extension://abc/page-provider.js')).toBe(false)
  })
})

describe('installFromChannel', () => {
  it('installs the provider once the bridge announces the nonce', () => {
    const win = fakeWindow()
    const nonce = mintNonce((b) => b.fill(7))
    startBridge({ win: win as unknown as BridgeWindow, nonce, connect: () => ({ postMessage: () => undefined, onMessage: () => undefined, onDisconnect: () => undefined, disconnect: () => undefined }) as BridgePort })
    expect(installFromChannel({ win: win as unknown as MainWorldWindow, ...IDENTITY })).toBe(true)
    expect((win.ethereum as { isBoltVault?: boolean }).isBoltVault).toBe(true)
  })

  it('gives the realm to whoever claims it first, so the fallback and the manifest script cannot both install', () => {
    const win = fakeWindow()
    const nonce = mintNonce((b) => b.fill(9))
    startBridge({ win: win as unknown as BridgeWindow, nonce, connect: () => ({ postMessage: () => undefined, onMessage: () => undefined, onDisconnect: () => undefined, disconnect: () => undefined }) as BridgePort })
    expect(installFromChannel({ win: win as unknown as MainWorldWindow, ...IDENTITY })).toBe(true)
    const first = win.ethereum
    // The late arrival — a MAIN-world script the browser injected after the
    // fallback had already been fetched and run.
    expect(installFromChannel({ win: win as unknown as MainWorldWindow, ...IDENTITY })).toBe(false)
    expect(win.ethereum).toBe(first)
  })

  it('refuses an opaque origin, so a sandboxed iframe gets no provider by either path', () => {
    const win = fakeWindow('null')
    expect(hasOpaqueOrigin(win)).toBe(true)
    expect(installFromChannel({ win: win as unknown as MainWorldWindow, ...IDENTITY })).toBe(false)
    expect(win.ethereum).toBeUndefined()
  })

  it('installs when the fallback lands after the bridge, by asking for the nonce it missed', () => {
    const win = fakeWindow()
    const nonce = mintNonce((b) => b.fill(3))
    startBridge({ win: win as unknown as BridgeWindow, nonce, connect: () => ({ postMessage: () => undefined, onMessage: () => undefined, onDisconnect: () => undefined, disconnect: () => undefined }) as BridgePort })
    // The bridge's unprompted announcement has already gone out with nobody
    // listening: the injected script only exists now, one fetch later.
    expect(installFromChannel({ win: win as unknown as MainWorldWindow, ...IDENTITY })).toBe(true)
    expect((win.ethereum as { isBoltVault?: boolean }).isBoltVault).toBe(true)
  })
})
