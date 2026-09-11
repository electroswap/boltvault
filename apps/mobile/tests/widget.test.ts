/**
 * Where the widget snapshot lands, per platform.
 *
 * This is the whole of the bug that shipped: the file was written to the app's
 * document directory, which on iOS is a container the WidgetKit extension
 * cannot open, so `BoltVaultWidget.swift` read nothing and the widget showed
 * "Open BoltVault" forever. Android was right by accident — a Glance widget
 * reads `context.filesDir`, which is where the document directory lands.
 *
 * `expo-file-system` and `react-native` are both native modules, so the test
 * stands in for them and asserts the one thing that matters: the URI written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android',
  /** App Group id -> container path, exactly as the iOS module reports it. */
  containers: {} as Record<string, string>,
  created: [] as string[],
  written: [] as Array<{ uri: string; body: string }>,
}))

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return state.os
    },
  },
}))

vi.mock('expo-file-system', () => {
  class Directory {
    readonly uri: string
    constructor(...parts: Array<Directory | string>) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/')
    }
    get exists(): boolean {
      return state.created.includes(this.uri)
    }
    create(): void {
      state.created.push(this.uri)
    }
  }
  class File {
    readonly uri: string
    constructor(dir: Directory, name: string) {
      this.uri = `${dir.uri}/${name}`
    }
    write(body: string): void {
      state.written.push({ uri: this.uri, body })
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get document(): Directory {
        return new Directory('file:///app/Documents')
      },
      get appleSharedContainers(): Record<string, Directory> {
        return Object.fromEntries(Object.entries(state.containers).map(([id, path]) => [id, new Directory(path)]))
      },
    },
  }
})

const SNAPSHOT = { address: '0xD6Cf49CbCF84B2cd2472a376B5f791689A0769d0', label: 'Main', tier: 2, total: 1234.5, change24h: 0.031, currency: 'USD' as const, at: 1_700_000_000_000 }

const GROUP = 'group.io.electroswap.boltvault'
const CONTAINER = 'file:///private/Shared/AppGroup/boltvault'

describe('publishWidgetSnapshot', () => {
  beforeEach(() => {
    state.os = 'ios'
    state.containers = {}
    state.created = []
    state.written = []
    vi.restoreAllMocks()
  })

  it('writes into the App Group container on iOS, where the WidgetKit extension reads', async () => {
    state.containers = { [GROUP]: CONTAINER }
    const { publishWidgetSnapshot, APP_GROUP } = await import('../src/widget')
    expect(APP_GROUP).toBe(GROUP)
    await publishWidgetSnapshot(SNAPSHOT)
    expect(state.written).toHaveLength(1)
    // The exact path BoltVaultWidget.swift opens under containerURL(forSecurityApplicationGroupIdentifier:).
    expect(state.written[0]?.uri).toBe(`${CONTAINER}/widget/widget-snapshot.json`)
    expect(JSON.parse(state.written[0]?.body ?? 'null')).toEqual(SNAPSHOT)
  })

  it('keeps writing the document directory on Android, which is the Glance widget filesDir', async () => {
    state.os = 'android'
    // Present or not, an App Group is meaningless here and must not be consulted.
    state.containers = { [GROUP]: CONTAINER }
    const { publishWidgetSnapshot } = await import('../src/widget')
    await publishWidgetSnapshot(SNAPSHOT)
    expect(state.written[0]?.uri).toBe('file:///app/Documents/widget/widget-snapshot.json')
  })

  it('warns rather than throwing when the iOS entitlement is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { publishWidgetSnapshot } = await import('../src/widget')
    await expect(publishWidgetSnapshot(SNAPSHOT)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain(GROUP)
  })

  it('creates the widget directory once, and only when it is missing', async () => {
    state.containers = { [GROUP]: CONTAINER }
    const { publishWidgetSnapshot } = await import('../src/widget')
    await publishWidgetSnapshot(SNAPSHOT)
    await publishWidgetSnapshot(SNAPSHOT)
    expect(state.created).toEqual([`${CONTAINER}/widget`])
  })
})
