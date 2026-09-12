/**
 * The wire protocol between an engine client and an engine host.
 *
 * Three message kinds: request, response, event. Everything is validated with
 * zod on receipt — a host never trusts a page, and a client never trusts a
 * malformed host response.
 */
import { z } from 'zod'
import { EngineEventSchema } from './schema'

export const WIRE_VERSION = 1 as const

export const EngineRequestSchema = z.object({
  v: z.literal(WIRE_VERSION),
  kind: z.literal('request'),
  id: z.string().min(1).max(64),
  ns: z.string().min(1).max(32),
  method: z.string().min(1).max(64),
  arg: z.unknown().optional(),
})
export type EngineRequest = z.infer<typeof EngineRequestSchema>

export const EngineErrorPayloadSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(2048),
  data: z.unknown().optional(),
})
export type EngineErrorPayload = z.infer<typeof EngineErrorPayloadSchema>

export const EngineResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    v: z.literal(WIRE_VERSION),
    kind: z.literal('response'),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown().optional(),
  }),
  z.object({
    v: z.literal(WIRE_VERSION),
    kind: z.literal('response'),
    id: z.string(),
    ok: z.literal(false),
    error: EngineErrorPayloadSchema,
  }),
])
export type EngineResponse = z.infer<typeof EngineResponseSchema>

export const EngineEventMessageSchema = z.object({
  v: z.literal(WIRE_VERSION),
  kind: z.literal('event'),
  event: EngineEventSchema,
})
export type EngineEventMessage = z.infer<typeof EngineEventMessageSchema>

export const EngineMessageSchema = z.union([
  EngineRequestSchema,
  EngineResponseSchema,
  EngineEventMessageSchema,
])
export type EngineMessage = z.infer<typeof EngineMessageSchema>

/** Parse an untrusted inbound message; returns null for anything that is not ours. */
export function parseEngineMessage(raw: unknown): EngineMessage | null {
  const res = EngineMessageSchema.safeParse(raw)
  return res.success ? res.data : null
}

/**
 * The UI channel carries plain data only (master plan §3.3, §12): a
 * `Uint8Array` / `ArrayBuffer` — the shape of a key, a seed or a DEK — is
 * refused before it is posted, whatever produced it. Strings pass: the one
 * designed exception (the seed reveal in the full tab) is text by design.
 */
export function hasRawBytes(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === null || typeof value !== 'object') return false
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true
  if (Array.isArray(value)) return value.some((v) => hasRawBytes(v, depth + 1))
  for (const v of Object.values(value as Record<string, unknown>))
    if (hasRawBytes(v, depth + 1)) return true
  return false
}

export function refusedRawBytes(id: string): EngineResponse {
  return {
    v: WIRE_VERSION,
    kind: 'response',
    id,
    ok: false,
    error: {
      code: 'internal',
      message: 'The engine refused to send raw bytes to the UI (master plan §3.3).',
    },
  }
}
