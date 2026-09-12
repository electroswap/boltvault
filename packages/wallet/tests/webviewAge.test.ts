/**
 * An old Android WebView cannot say which frame spoke (ES-BV-043).
 *
 * The Browser screen authenticates a dApp request by comparing the posting
 * frame's origin with the session's. On Android that attribution exists only
 * where the platform supports `WEB_MESSAGE_LISTENER`; below it,
 * `react-native-webview` falls back to the `postMessage` JS interface, which
 * reports the *main frame's* URL whichever frame posted. So on an old WebView
 * an advert iframe embedded in a connected dApp passes the check and speaks in
 * the dApp's name.
 */
import { describe, expect, it } from 'vitest'
import { chromeMajor, frameAttributionOk, MIN_FRAME_ATTRIBUTING_WEBVIEW } from '../src/webviewAge'

const ANDROID = (chrome: number): string =>
  `Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${chrome}.0.0.0 Mobile Safari/537.36`

const IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

describe('reading the WebView’s version', () => {
  it('finds the Chrome major in an Android user agent', () => {
    expect(chromeMajor(ANDROID(120))).toBe(120)
    expect(chromeMajor(ANDROID(87))).toBe(87)
  })

  it('answers null where there is no Chrome token to read', () => {
    expect(chromeMajor(IOS)).toBeNull()
    expect(chromeMajor(null)).toBeNull()
    expect(chromeMajor('')).toBeNull()
  })
})

describe('whether a dApp request can be attributed to a frame', () => {
  it('refuses below the version that reports the posting frame', () => {
    expect(frameAttributionOk(ANDROID(MIN_FRAME_ATTRIBUTING_WEBVIEW - 1), true)).toBe(false)
    expect(frameAttributionOk(ANDROID(60), true)).toBe(false)
  })

  it('allows the version that introduced it, and anything after', () => {
    expect(frameAttributionOk(ANDROID(MIN_FRAME_ATTRIBUTING_WEBVIEW), true)).toBe(true)
    expect(frameAttributionOk(ANDROID(130), true)).toBe(true)
  })

  it('does not refuse iOS, which attributes frames on every supported version', () => {
    expect(frameAttributionOk(IOS, false)).toBe(true)
    expect(frameAttributionOk(ANDROID(60), false)).toBe(true)
  })

  it('treats an unreadable user agent as no evidence rather than as guilt', () => {
    expect(frameAttributionOk(null, true)).toBe(true)
    expect(frameAttributionOk('something else entirely', true)).toBe(true)
  })
})
