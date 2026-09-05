/**
 * Small deterministic hashes for *visuals only* (identicons, Field seeds).
 * Never for anything security-adjacent — that is @noble in core.
 */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** A tiny xorshift PRNG seeded from a hash; returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let s = seed || 0x9e3779b9
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

/** Four floats in [0, 1) that give an account its own Field (master plan §7.6). */
export function fieldSeed(address: string): readonly [number, number, number, number] {
  const rnd = seededRandom(fnv1a32(address.toLowerCase()))
  return [rnd(), rnd(), rnd(), rnd()]
}
