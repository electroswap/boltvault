/**
 * Camera QR scanning in tab.html (master plan §2.7 S7 — Keystone on the
 * extension): `getUserMedia` into a `<video>`, frames decoded by jsQR. The
 * caller collects UR parts until the decoder is happy; an animated QR keeps
 * delivering distinct parts through `onPart`. Nothing leaves the page.
 */
import jsQR from 'jsqr'

export interface ScanSession {
  /** Resolves with the first (or, with `onPart`, the last) decoded text; rejects on cancel or no camera. */
  readonly result: Promise<string>
  cancel(): void
}

export function scanQr(container: HTMLElement, onPart?: (text: string) => boolean): ScanSession {
  const video = document.createElement('video')
  video.setAttribute('playsinline', 'true')
  video.style.width = '100%'
  video.style.borderRadius = '16px'
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let stream: MediaStream | null = null
  let stopped = false
  let raf = 0
  const stop = (): void => {
    stopped = true
    cancelAnimationFrame(raf)
    stream?.getTracks().forEach((t) => t.stop())
    video.remove()
  }
  const result = new Promise<string>((resolve, reject) => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        video.srcObject = s
        container.appendChild(video)
        void video.play()
        const seen = new Set<string>()
        const tick = (): void => {
          if (stopped) return
          if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.drawImage(video, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            if (code?.data && !seen.has(code.data)) {
              seen.add(code.data)
              const done = onPart ? onPart(code.data) : true
              if (done) {
                stop()
                resolve(code.data)
                return
              }
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch((err: unknown) => {
        stop()
        reject(err instanceof Error ? err : new Error('The camera is not available here.'))
      })
  })
  return {
    result,
    cancel() {
      stop()
    },
  }
}
