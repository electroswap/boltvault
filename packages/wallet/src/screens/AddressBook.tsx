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
import { t } from '../i18n'

const ETN = 52014

export function AddressBook({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const [contacts, setContacts] = useState<ContactView[]>([])
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.contacts.list().then(setContacts, () => undefined)
  }, [engine])

  const looksLikeAddress = /^0x[0-9a-fA-F]{40}$/.test(address.trim()) || /\.etn$/i.test(address.trim())

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const c = await engine.contacts.add({ address: address.trim(), label: label.trim(), chainId: ETN })
      setContacts((cs) => [...cs, c])
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
        <Input value={address} onChange={setAddress} placeholder={t({ id: 'book.address.ph', message: '0x… or name.etn' })} autoCapitalize="none" testID="book-address" />
        {error ? <Body tone="burn">{error}</Body> : null}
        <Key label={t({ id: 'save', message: 'Save' })} kind="secondary" disabled={busy || !label.trim() || !looksLikeAddress} onPress={() => void add()} testID="book-save" />
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
