import { describe, expect, it } from 'vitest'
import { classifySender } from '../src/sender'

const ID = 'ggmabmmmdnkckkpolkbbblbeoaoonpgf'
const ORIGIN = `chrome-extension://${ID}/`

describe('classifySender', () => {
  it('extension pages are ui; content scripts are content; everything else is refused', () => {
    expect(classifySender({ id: ID, url: `${ORIGIN}popup.html` }, ID, ORIGIN)).toBe('ui')
    expect(classifySender({ id: ID, url: `${ORIGIN}tab.html`, tab: { id: 4 }, frameId: 0 }, ID, ORIGIN)).toBe('ui')
    expect(classifySender({ id: ID, url: 'https://app.electroswap.io/swap', tab: { id: 4 }, frameId: 0 }, ID, ORIGIN)).toBe('content')
    expect(classifySender({ id: 'other', url: `${ORIGIN}popup.html` }, ID, ORIGIN)).toBeNull()
    expect(classifySender({ id: ID, url: 'https://evil.example/' }, ID, ORIGIN)).toBeNull()
    expect(classifySender({ id: ID, url: 'chrome-extension://evil/popup.html' }, ID, ORIGIN)).toBeNull()
    expect(classifySender(undefined, ID, ORIGIN)).toBeNull()
  })
})
