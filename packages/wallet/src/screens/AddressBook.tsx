/**
 * Settings › Address book — the saved names for addresses.
 *
 * Owner: "I was caught off guard by the prompt to provide a name for the
 * transaction. I want to remove the concept of doing that completely from the
 * wallet" — and then, on where the concept should live instead: keep contacts,
 * move naming into an address book in settings.
 *
 * That is the right split. Naming something is a thing you come here to do,
 * with time to think; it is not a thing to be asked at the moment you are
 * signing, which is where it used to appear. Send offers what is saved here as
 * chips, plus the addresses you used recently, and never asks for a word.
 */
import { Body, Column, Icon, IconButton, Input, Key, Plate, Row, ScrollView, metrics, paint, shortAddress } from '@boltvault/ui'
import type { ContactView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useEngine } from '../engine/EngineProvider'
import { useNames } from '../hooks/useNames'
import { t } from '../i18n'
import { bookEntryKind } from './addressBookRules'

const ETN = 52014

export function AddressBook({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const [contacts, setContacts] = useState<ContactView[]>([])
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  /*
    The other direction. Entries are stored as addresses — a name is a claim
    that can be re-pointed, an address is what the user meant — so the book
    printed six nibbles and four for every row and recognised nothing. These
    are forward-verified reverse records, resolved once per page, and they are
    shown beside the address rather than instead of it: the address is what the
    entry actually is.
  */
  const names = useNames(contacts.map((c) => c.address))

  useEffect(() => {
    engine.contacts.list().then(setContacts, () => undefined)
  }, [engine])

  const typed = address.trim()
  /*
    `.etn` resolves on Electroneum through its UniversalResolver and `.eth` on
    Ethereum; `names.chainFor` picks the chain from the suffix, so one call
    covers both whichever chain the book is filed under.
  */
  const kind = bookEntryKind(address)
  const isHex = kind === 'address'
  const isName = kind === 'name'
  const usable = kind !== 'unusable'

  /**
   * Save a name by saving what it points at.
   *
   * The book never resolved anything. The field accepted `name.etn` — the
   * placeholder advertised it — and then handed the literal string to
   * `contacts.add`, which opens with `isAddress()` and throws "not an address".
   * So the one input the screen invited was the one input it could not take,
   * and the error said nothing about why. A tester put it plainly: "At address
   * book the wallet does not recognize by ENS name." `.eth` did not even get
   * that far: the gate below rejected the suffix outright and left Save
   * disabled with no explanation at all.
   *
   * Resolution happens here, where Send and the watch-address step already do
   * it, and what gets stored is the address. That is the right thing to store
   * for a book whose entries are also the firewall's lookalike reference set —
   * a name is a claim that can be re-pointed later, an address is the thing the
   * user meant.
   */
  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      let resolved = typed
      if (!isHex) {
        const hit = await engine.names.resolve({ chainId: ETN, name: typed })
        if (!hit.address) {
          setError(t({ id: 'book.noname', message: 'That name does not resolve to an address.' }))
          return
        }
        resolved = hit.address
      }
      const c = await engine.contacts.add({ address: resolved, label: label.trim(), chainId: ETN })
      setContacts((cs) => [...cs.filter((x) => x.id !== c.id), c])
      setLabel('')
      setAddress('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await engine.contacts.remove({ id })
      setContacts((cs) => cs.filter((c) => c.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="address-book">
      <PageHeader title={t({ id: 'book.title', message: 'Address book' })} />

      <Plate gap="$3" testID="book-add">
        <Body size="title">{t({ id: 'book.add', message: 'Save an address' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'book.add.hint', message: 'A name you will recognise later. Saved addresses appear as chips on the Send screen.' })}
        </Body>
        <Input value={label} onChange={setLabel} placeholder={t({ id: 'book.name.ph', message: 'Name' })} testID="book-name" />
        <Input value={address} onChange={setAddress} placeholder={t({ id: 'book.address.ph', message: '0x…, name.etn or name.eth' })} autoCapitalize="none" testID="book-address" />
        {/* A name is looked up when Save is pressed; saying so beats a Save key that looks inert. */}
        {isName ? (
          <Body tone="mute" size="caption" testID="book-name-note">
            {t({ id: 'book.name.note', message: 'Saving looks this name up on chain and keeps the address it points at today.' })}
          </Body>
        ) : null}
        {error ? <Body tone="burn">{error}</Body> : null}
        <Key label={t({ id: 'save', message: 'Save' })} kind="secondary" disabled={busy || !label.trim() || !usable} onPress={() => void add()} testID="book-save" />
      </Plate>

      {contacts.length === 0 ? (
        <Plate gap="$2" testID="book-empty">
          <Body tone="mute">{t({ id: 'book.none', message: 'Nothing saved yet. Send still offers the addresses you used recently.' })}</Body>
        </Plate>
      ) : (
        <Plate gap="$3" testID="book-list">
          <Body size="title">{t({ id: 'book.saved', message: 'Saved' })}</Body>
          {contacts.map((c) => (
            <Row key={c.id} justifyContent="space-between" alignItems="center" gap="$2">
              <Column flex={1} minWidth={0} alignItems="flex-start">
                <Body numberOfLines={1}>{c.label}</Body>
                <Row gap={4} alignItems="center">
                  <Body tone="mute" size="caption" fontVariant={['tabular-nums']} numberOfLines={1}>
                    {shortAddress(c.address)}
                  </Body>
                  {names.get(c.address.toLowerCase()) ? (
                    <Body tone="mute" size="caption" numberOfLines={1} testID={`book-name-${c.id}`}>
                      {`· ${names.get(c.address.toLowerCase()) ?? ''}`}
                    </Body>
                  ) : null}
                  {c.confirmed ? <Icon name="check" size={12} color={paint.surge} /> : null}
                </Row>
              </Column>
              <IconButton icon="trash" label={t({ id: 'book.remove', message: 'Remove {n}', values: { n: c.label } })} onPress={() => void remove(c.id)} testID={`book-remove-${c.id}`} />
            </Row>
          ))}
        </Plate>
      )}
    </ScrollView>
  )
}
