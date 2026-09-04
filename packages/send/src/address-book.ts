/**
 * Address book + poison check (T4.4).
 *
 * Address poisoning: a scammer sends you one tx, then an identical-looking
 * address that differs in a middle char. Rule (design line 974): if a recipient
 * shares the **4 first + 4 last hex chars** with a known address (history or
 * book) but is NOT that address, flag it as a lookalike → block with copy.
 *
 * `AddressBook` is a tiny in-memory store; persistence (encrypted, per the
 * history/vault pattern) is the caller's job. `checkPoison` is pure.
 */
import { isAddress } from 'viem'

export interface BookContact {
  readonly address: string
  readonly label: string
  readonly chainId?: number
}

export class AddressBook {
  private readonly contacts = new Map<string, BookContact>()

  constructor(initial: readonly BookContact[] = []) {
    for (const c of initial) this.upsert(c)
  }

  /** Key by lowercase address; returns the stored (checksummed) form. */
  private key(addr: string): string {
    return addr.toLowerCase()
  }

  add(contact: BookContact): void {
    this.contacts.set(this.key(contact.address), contact)
  }

  upsert(contact: BookContact): void {
    this.add(contact)
  }

  remove(address: string): boolean {
    return this.contacts.delete(this.key(address))
  }

  get(address: string): BookContact | undefined {
    return this.contacts.get(this.key(address))
  }

  all(): BookContact[] {
    return [...this.contacts.values()]
  }

  /** All known addresses (checksummed) — the poison comparison set. */
  knownAddresses(): string[] {
    return this.all().map((c) => c.address)
  }
}

export interface PoisonResult {
  readonly poisoned: boolean
  /** The known address it looks like, if poisoned. */
  readonly looksLike?: string
  readonly label?: string
  readonly reason?: string
}

function hex4(addr: string): { first: string; last: string } {
  const h = addr.toLowerCase().replace(/^0x/, '')
  return { first: h.slice(0, 4), last: h.slice(-4) }
}

/**
 * Poison 4+4 check. `candidate` is the recipient; `known` is the set of
 * addresses the user has dealt with (history + book). Returns `poisoned: true`
 * when a known address shares the first-4 + last-4 hex chars but is a
 * different address (a lookalike).
 */
export function checkPoison(
  candidate: string,
  known: readonly string[],
  labels: Map<string, string> = new Map(),
): PoisonResult {
  const c = candidate.toLowerCase()
  if (!isAddress(c)) return { poisoned: false }
  const cc = hex4(c)
  for (const knownAddr of known) {
    const k = knownAddr.toLowerCase()
    if (k === c) continue // exact match is fine (not a lookalike)
    const kk = hex4(knownAddr)
    if (cc.first === kk.first && cc.last === kk.last) {
      return {
        poisoned: true,
        looksLike: knownAddr,
        label: labels.get(k) ?? labels.get(knownAddr.toLowerCase()),
        reason: 'Shares the first 4 + last 4 hex chars of a known address but is not it.',
      }
    }
  }
  return { poisoned: false }
}

/**
 * Build the known-address set from a history-like list + address book, with
 * labels so the poison copy can name the contact.
 */
export function poisonSet(
  historyAddresses: readonly string[],
  book: AddressBook,
): { set: string[]; labels: Map<string, string> } {
  const set = new Set<string>()
  const labels = new Map<string, string>()
  for (const a of historyAddresses) set.add(a.toLowerCase())
  for (const c of book.all()) {
    set.add(c.address.toLowerCase())
    labels.set(c.address.toLowerCase(), c.label)
  }
  return { set: [...set], labels }
}
