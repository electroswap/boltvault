/**
 * EIP-712 as the Ethereum app wants to *read* it, not as two hashes
 * (ES-BV-006).
 *
 * The app has a second protocol for typed data: you describe every struct in
 * `types` with the struct-definition instruction (`0x1a`), then walk the
 * domain and the message value by value with the struct-implementation
 * instruction (`0x1c`), and only then ask for the signature (`0x0c` with
 * `P2 = 0x01`). The device rebuilds the EIP-712 hash from what it was told and
 * shows the fields — so a host that lies about the spender, the amount or the
 * deadline is lying on the device's screen too, where the user can see it.
 * That is the entire point of owning a Ledger.
 *
 * Everything here is pure: `eip712Plan` turns a typed-data object into the
 * exact APDU payloads, in order, and `eth.ts` does nothing but send them.
 * The protocol is public (LedgerHQ/app-ethereum, `doc/ethapp.adoc`).
 */
import { concatBytes } from './apdu'

export interface Eip712Field {
  readonly name: string
  readonly type: string
}

export interface Eip712TypedData {
  readonly types: Readonly<Record<string, readonly Eip712Field[]>>
  readonly primaryType: string
  readonly domain: Readonly<Record<string, unknown>>
  readonly message: Readonly<Record<string, unknown>>
}

/** P2 of the struct-definition instruction. */
export const DEF = { NAME: 0x00, FIELD: 0xff } as const
/** P2 of the struct-implementation instruction. */
export const IMPL = { ROOT: 0x00, ARRAY: 0x0f, FIELD: 0xff } as const

/**
 * The app's type table. `CUSTOM` is a struct named in `types`; the rest are
 * the Solidity leaves EIP-712 allows.
 */
const TYPE = {
  CUSTOM: 0,
  INT: 1,
  UINT: 2,
  ADDRESS: 3,
  BOOL: 4,
  STRING: 5,
  BYTES_FIX: 6,
  BYTES_DYN: 7,
} as const

/** Bits of the type-descriptor byte above the low four that hold the type. */
const HAS_SIZE = 0x40
const IS_ARRAY = 0x80

/** Array levels: a length the app is told, or one it reads off the message. */
const ARRAY_DYNAMIC = 0x00
const ARRAY_FIXED = 0x01

/**
 * This typed data cannot be shown field by field, so the caller should fall
 * back to the hashed instruction and say so on the sheet.
 *
 * It is never a reason to refuse a signature — only a reason to stop
 * pretending the device is doing the checking.
 */
export class Eip712Unsupported extends Error {
  override readonly name = 'Eip712Unsupported'
}

/** One APDU's payload; the header is the caller's business, and so is chunking. */
export interface Eip712Step {
  /** `'def'` → instruction 0x1a, `'impl'` → 0x1c. */
  readonly kind: 'def' | 'impl'
  readonly p2: number
  readonly data: Uint8Array
  /** Only field values are long enough to need splitting across APDUs. */
  readonly chunk: boolean
}

export interface ParsedType {
  /** The type with every `[]` stripped: `uint256`, `bytes32`, `Person`. */
  readonly base: string
  /** One entry per array level, left to right: a fixed length, or null. */
  readonly arrays: readonly (number | null)[]
}

const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c > 0x7f) throw new Eip712Unsupported(`the app only names types in ASCII: "${s}"`)
    out[i] = c
  }
  return out
}

const withLength = (bytes: Uint8Array): Uint8Array => {
  if (bytes.length > 0xff) throw new Eip712Unsupported('a name over 255 bytes')
  return concatBytes(new Uint8Array([bytes.length]), bytes)
}

export function parseType(type: string): ParsedType {
  const m = /^([A-Za-z_$][A-Za-z0-9_$]*)((?:\[\d*\])*)$/.exec(type)
  if (!m) throw new Eip712Unsupported(`unrecognised type "${type}"`)
  const arrays = ((m[2] ?? '').match(/\[\d*\]/g) ?? []).map((level) => {
    const inner = level.slice(1, -1)
    return inner === '' ? null : Number(inner)
  })
  return { base: m[1] as string, arrays }
}

/** The app's enum and size byte for a leaf type, or null when it is a struct. */
export function leafType(base: string): { readonly key: number; readonly size: number | null } | null {
  if (base === 'address') return { key: TYPE.ADDRESS, size: null }
  if (base === 'bool') return { key: TYPE.BOOL, size: null }
  if (base === 'string') return { key: TYPE.STRING, size: null }
  if (base === 'bytes') return { key: TYPE.BYTES_DYN, size: null }
  const fixed = /^bytes(\d+)$/.exec(base)
  if (fixed) {
    const n = Number(fixed[1])
    if (n < 1 || n > 32) throw new Eip712Unsupported(`"${base}" is not a Solidity type`)
    return { key: TYPE.BYTES_FIX, size: n }
  }
  const numeric = /^(u?)int(\d*)$/.exec(base)
  if (numeric) {
    const bits = numeric[2] ? Number(numeric[2]) : 256
    if (bits < 8 || bits > 256 || bits % 8 !== 0) throw new Eip712Unsupported(`"${base}" is not a Solidity type`)
    // The size byte counts bytes for numbers, as it does for `bytesN`.
    return { key: numeric[1] ? TYPE.UINT : TYPE.INT, size: bits / 8 }
  }
  return null
}

/**
 * One field of a struct definition:
 *
 *   type descriptor · [struct name] · [size] · [array levels] · key name
 */
export function definitionField(field: Eip712Field): Uint8Array {
  const { base, arrays } = parseType(field.type)
  /*
    One array level, and no more.

    A definition lists levels left to right (`uint8[2][4]` is "two, then
    four") while the implementation walks them outermost first, and the app's
    own bound on nesting is lower than EIP-712's. Rather than guess at the
    order for a shape no real permit or order uses, anything deeper falls back
    to the hashed instruction, where the sheet says the device is showing
    hashes. The audit anticipates exactly this residual.
  */
  if (arrays.length > 1) throw new Eip712Unsupported(`nested arrays are not shown on the device: "${field.type}"`)
  const leaf = leafType(base)
  let desc: number = leaf ? leaf.key : TYPE.CUSTOM
  if (leaf?.size != null) desc |= HAS_SIZE
  if (arrays.length > 0) desc |= IS_ARRAY
  const parts: Uint8Array[] = [new Uint8Array([desc])]
  if (!leaf) parts.push(withLength(ascii(base)))
  if (leaf?.size != null) parts.push(new Uint8Array([leaf.size]))
  if (arrays.length > 0) {
    parts.push(new Uint8Array([arrays.length]))
    for (const level of arrays) {
      parts.push(level === null ? new Uint8Array([ARRAY_DYNAMIC]) : new Uint8Array([ARRAY_FIXED, level]))
    }
  }
  parts.push(withLength(ascii(field.name)))
  return concatBytes(...parts)
}

const hexBytes = (value: string, what: string): Uint8Array => {
  const body = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (!/^[0-9a-fA-F]*$/.test(body)) throw new Eip712Unsupported(`${what} is not hex`)
  const even = body.length % 2 === 0 ? body : `0${body}`
  const out = new Uint8Array(even.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(even.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Big-endian, no leading zero byte, never empty — how the app reads a number. */
const numberBytes = (n: bigint): Uint8Array => {
  const hex = n.toString(16)
  return hexBytes(hex.length % 2 === 0 ? hex : `0${hex}`, 'a number')
}

const asBigInt = (value: unknown, what: string): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Eip712Unsupported(`${what} is not a whole number`)
    return BigInt(value)
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return BigInt(value.trim())
    } catch {
      throw new Eip712Unsupported(`${what} is not a number`)
    }
  }
  throw new Eip712Unsupported(`${what} is not a number`)
}

/** The bytes the app expects for one leaf value. */
export function encodeLeaf(base: string, value: unknown): Uint8Array {
  const leaf = leafType(base)
  if (!leaf) throw new Eip712Unsupported(`"${base}" is not a leaf type`)
  switch (leaf.key) {
    case TYPE.ADDRESS: {
      if (typeof value !== 'string') throw new Eip712Unsupported('an address must be a string')
      const bytes = hexBytes(value, 'an address')
      if (bytes.length !== 20) throw new Eip712Unsupported('an address must be 20 bytes')
      return bytes
    }
    case TYPE.BOOL:
      return new Uint8Array([value ? 1 : 0])
    case TYPE.STRING: {
      if (typeof value !== 'string') throw new Eip712Unsupported('a string field must be a string')
      return new TextEncoder().encode(value)
    }
    case TYPE.BYTES_DYN: {
      if (typeof value !== 'string') throw new Eip712Unsupported('a bytes field must be hex')
      return hexBytes(value, 'a bytes field')
    }
    case TYPE.BYTES_FIX: {
      if (typeof value !== 'string') throw new Eip712Unsupported('a bytes field must be hex')
      const bytes = hexBytes(value, 'a bytes field')
      if (bytes.length !== leaf.size) throw new Eip712Unsupported(`"${base}" wants ${String(leaf.size)} bytes`)
      return bytes
    }
    case TYPE.UINT: {
      const n = asBigInt(value, `a ${base}`)
      if (n < 0n) throw new Eip712Unsupported(`a ${base} cannot be negative`)
      return numberBytes(n)
    }
    default: {
      // Signed: two's complement at the declared width, as the app reads it.
      const n = asBigInt(value, `a ${base}`)
      const bits = BigInt((leaf.size ?? 32) * 8)
      return numberBytes(n < 0n ? n + (1n << bits) : n)
    }
  }
}

const defStep = (p2: number, data: Uint8Array): Eip712Step => ({ kind: 'def', p2, data, chunk: false })

const implRoot = (name: string): Eip712Step => ({ kind: 'impl', p2: IMPL.ROOT, data: ascii(name), chunk: false })

const implArray = (length: number): Eip712Step => {
  if (length > 0xff) throw new Eip712Unsupported('an array the device cannot count')
  return { kind: 'impl', p2: IMPL.ARRAY, data: new Uint8Array([length]), chunk: false }
}

const implField = (bytes: Uint8Array): Eip712Step => {
  if (bytes.length > 0xffff) throw new Eip712Unsupported('a field the device cannot receive')
  const header = new Uint8Array([(bytes.length >> 8) & 0xff, bytes.length & 0xff])
  return { kind: 'impl', p2: IMPL.FIELD, data: concatBytes(header, bytes), chunk: true }
}

/**
 * Walk one value against its type, appending the implementation APDUs the app
 * expects. A struct's fields are sent inline — the app already has the schema
 * and descends by itself; only the domain and the message get a root APDU.
 */
function walk(type: string, value: unknown, types: Eip712TypedData['types'], out: Eip712Step[], depth: number): void {
  if (depth > 8) throw new Eip712Unsupported('typed data nested too deeply for the device')
  const { base, arrays } = parseType(type)
  if (arrays.length > 1) throw new Eip712Unsupported(`nested arrays are not shown on the device: "${type}"`)
  if (arrays.length === 1) {
    if (!Array.isArray(value)) throw new Eip712Unsupported(`"${type}" wants an array`)
    const fixed = arrays[0]
    if (fixed != null && value.length !== fixed) throw new Eip712Unsupported(`"${type}" wants ${String(fixed)} entries`)
    out.push(implArray(value.length))
    for (const item of value) walk(base, item, types, out, depth + 1)
    return
  }
  const leaf = leafType(base)
  if (leaf) {
    out.push(implField(encodeLeaf(base, value)))
    return
  }
  const fields = types[base]
  if (!fields) throw new Eip712Unsupported(`"${base}" has no definition in this message`)
  if (typeof value !== 'object' || value === null) throw new Eip712Unsupported(`"${base}" wants an object`)
  const record = value as Record<string, unknown>
  for (const field of fields) walk(field.type, record[field.name], types, out, depth + 1)
}

/**
 * Every APDU payload, in order, that tells the device what it is signing.
 *
 * Definitions first — all of them, so a struct may refer to one declared
 * later — then the domain, then the message. Throws `Eip712Unsupported` for
 * anything the app cannot be told, which is the caller's signal to fall back
 * to the hashed instruction rather than to refuse.
 */
export function eip712Plan(td: Eip712TypedData): Eip712Step[] {
  const names = Object.keys(td.types)
  if (!names.includes('EIP712Domain')) throw new Eip712Unsupported('no EIP712Domain in types')
  if (!td.types[td.primaryType]) throw new Eip712Unsupported(`no definition for "${td.primaryType}"`)
  const out: Eip712Step[] = []
  for (const name of names) {
    out.push(defStep(DEF.NAME, ascii(name)))
    for (const field of td.types[name] ?? []) out.push(defStep(DEF.FIELD, definitionField(field)))
  }
  out.push(implRoot('EIP712Domain'))
  for (const field of td.types.EIP712Domain ?? []) walk(field.type, td.domain[field.name], td.types, out, 0)
  out.push(implRoot(td.primaryType))
  for (const field of td.types[td.primaryType] ?? []) walk(field.type, td.message[field.name], td.types, out, 0)
  return out
}
