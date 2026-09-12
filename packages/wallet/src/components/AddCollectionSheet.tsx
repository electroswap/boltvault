/**
 * Add a collection by address (plan A3, owner items G7 and N1): the chain
 * says what it is — name, symbol, ERC-721 or ERC-1155 — and once added its
 * pieces join the Rack, read from the contract itself.
 */
import { Body, Column, Input, Key, Plate, Sheet } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'

const ETN = 52014
type Preview = { address: string; name: string; symbol: string; standard: 'ERC721' | 'ERC1155'; enumerable: boolean }

export function AddCollectionSheet({ open, onClose, onAdded, initialAddress, reducedMotion = false }: { open: boolean; onClose: () => void; onAdded?: (address: string) => void; initialAddress?: string; reducedMotion?: boolean }) {
  const engine = useEngine()
  const [address, setAddress] = useState(initialAddress ?? '')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [looking, setLooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setAddress(initialAddress ?? '')
    setPreview(null)
    setError(null)
  }, [open, initialAddress])
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address.trim())
  useEffect(() => {
    if (!open || !valid) {
      setPreview(null)
      return
    }
    let alive = true
    setLooking(true)
    setError(null)
    engine.nft.previewCollection({ chainId: ETN, address: address.trim() }).then(
      (p) => {
        if (!alive) return
        setPreview(p)
        setLooking(false)
      },
      (err: unknown) => {
        if (!alive) return
        setLooking(false)
        setPreview(null)
        setError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      alive = false
    }
  }, [engine, open, valid, address])
  const add = async (): Promise<void> => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      await engine.nft.addCollection({ chainId: ETN, address: address.trim() })
      onAdded?.(address.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t({ id: 'collection.add.title', message: 'Add a collection' })} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'collection.add.key', message: 'Add collection' })} size="compact" disabled={busy || looking || !preview} onPress={() => void add()} testID="add-collection-submit" />} testID="add-collection">
      <Column gap="$3">
        <Body tone="mute" size="caption">
          {t({ id: 'collection.add.body', message: 'Paste the contract address of an NFT collection on Electroneum. BoltVault reads its pieces and their images from the contract itself.' })}
        </Body>
        <Input value={address} onChange={setAddress} placeholder={t({ id: 'token.add.ph', message: 'Contract address 0x…' })} autoFocus={!initialAddress} testID="add-collection-address" />
        {looking ? (
          <Body tone="mute" size="caption">
            {t({ id: 'token.add.looking', message: 'Reading the contract…' })}
          </Body>
        ) : null}
        {preview ? (
          <Plate role="raised" gap={2} testID="add-collection-preview">
            <Body size="title">{preview.name}</Body>
            <Body tone="mute" size="caption">
              {[preview.symbol || null, preview.standard === 'ERC1155' ? 'ERC-1155' : 'ERC-721', preview.enumerable ? t({ id: 'collection.add.enumerable', message: 'lists its pieces' }) : t({ id: 'collection.add.scan', message: 'pieces found from transfers' })].filter(Boolean).join(' · ')}
            </Body>
          </Plate>
        ) : null}
        {error ? <Body tone="burn">{error}</Body> : null}
      </Column>
    </Sheet>
  )
}
