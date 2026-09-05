/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  emptyIdentity,
  firstAccount,
  currentAccount,
  seatFirst,
  switchAccount,
  addAccount,
  type VaultAccount,
} from '../src/identity'

const A: VaultAccount = { id: 'acct-0', label: 'main', address: '0x1', kind: 'hd' }
const B: VaultAccount = { id: 'acct-1', label: 'Account 2', address: '0x2', kind: 'watch' }

describe('identity (pure)', () => {
  it('emptyIdentity has no current account', () => {
    const s = emptyIdentity()
    expect(s.accounts).toHaveLength(0)
    expect(currentAccount(s)).toBeNull()
  })

  it('addAccount seats the new account', () => {
    const s = addAccount(emptyIdentity(), A)
    expect(s.currentAccountId).toBe('acct-0')
    expect(currentAccount(s)?.address).toBe('0x1')
  })

  it('firstAccount returns the first', () => {
    const s = addAccount(emptyIdentity(), A)
    expect(firstAccount(s)?.id).toBe('acct-0')
  })

  it('switchAccount is a no-op for an unknown id (pure)', () => {
    const s = addAccount(emptyIdentity(), A)
    const s2 = switchAccount(s, 'nope')
    expect(s2).toBe(s)
  })

  it('switchAccount returns a NEW state with the new current', () => {
    let s = addAccount(emptyIdentity(), A)
    s = addAccount(s, B)
    const s2 = switchAccount(s, 'acct-1')
    expect(s2).not.toBe(s)
    expect(s2.currentAccountId).toBe('acct-1')
    expect(currentAccount(s2)?.address).toBe('0x2')
  })

  it('seatFirst seats the first account idempotently', () => {
    const s0 = emptyIdentity()
    const s1 = addAccount(s0, A)
    const seated = seatFirst({ ...s1, currentAccountId: null })
    expect(seated.currentAccountId).toBe('acct-0')
    const again = seatFirst(seated)
    expect(again).toBe(seated)
  })
})

describe('Onboarding (happy-dom)', () => {
  it('renders the create/import choice', async () => {
    const { Onboarding } = await import('../src/Onboarding')
    const svc = {
      createVault: async () => ({ file: {} as any, accounts: [], mnemonic: 'a b c d e f g h i j k l m n o p', seedHex: '0x' }) as any,
      importVault: async () => ({ file: {} as any, accounts: [], mnemonic: '', seedHex: '0x' }) as any,
      quizWords: () => ({ words: ['a', 'b', 'c'], positions: [0] }),
    }
    render(<Onboarding service={svc} onDone={() => {}} />)
    expect(screen.getByTestId('onboarding-create')).toBeTruthy()
    expect(screen.getByTestId('onboarding-import')).toBeTruthy()
  })

  it('quiz gates the password step (Continue disabled until answered)', async () => {
    const { Onboarding } = await import('../src/Onboarding')
    const svc = {
      createVault: async () => ({ file: {} as any, accounts: [], mnemonic: 'a b c d e f g h i j k l m n o p', seedHex: '0x' }) as any,
      importVault: async () => ({ file: {} as any, accounts: [], mnemonic: '', seedHex: '0x' }) as any,
      quizWords: (m: string) => {
        const all = m.split(/\s+/)
        return { words: [all[0] ?? '', all[1] ?? '', all[2] ?? ''], positions: [0] }
      },
    }
    const { container } = render(<Onboarding service={svc} onDone={() => {}} />)
    // Start create.
    const createBtn = screen.getByTestId('onboarding-create') as HTMLButtonElement
    await new Promise((r) => setTimeout(r, 0))
    createBtn.click()
    await new Promise((r) => setTimeout(r, 20))
    // The quiz + Continue should now be present.
    expect(screen.getByTestId('onboarding-quiz')).toBeTruthy()
    const continueBtn = screen.getByTestId('onboarding-quiz-next') as HTMLButtonElement
    expect(continueBtn.disabled).toBe(true)
  })
})
