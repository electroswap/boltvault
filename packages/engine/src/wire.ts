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

export const EngineMessageSchema = z.union([EngineRequestSchema, EngineResponseSchema, EngineEventMessageSchema])
export type EngineMessage = z.infer<typeof EngineMessageSchema>

/** Parse an untrusted inbound message; returns null for anything that is not ours. */
export function parseEngineMessage(raw: unknown): EngineMessage | null {
  const res = EngineMessageSchema.safeParse(raw)
  return res.success ? res.data : null
}
