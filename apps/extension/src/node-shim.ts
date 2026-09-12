/**
 * The one Node shim in the worker (master plan §2.7 S2): the Keystone UR
 * registry and Trezor Connect were built for Node/webpack and read `Buffer`
 * and `process` at module init. WXT inlines the worker's dynamic imports, so
 * those modules initialise at boot — this file is the worker's first import
 * and runs before any of them. Nothing here reaches the pages.
 */
import { Buffer } from 'buffer'

const g = globalThis as unknown as {
  Buffer?: typeof Buffer
  process?: {
    env: Record<string, string | undefined>
    browser: boolean
    nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => void
    pid: number
    noDeprecation: boolean
    throwDeprecation: boolean
    traceDeprecation: boolean
  }
}
if (!g.Buffer) g.Buffer = Buffer
if (!g.process) {
  g.process = {
    env: {},
    browser: true,
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
    pid: 1,
    noDeprecation: true,
    throwDeprecation: false,
    traceDeprecation: false,
  }
}
