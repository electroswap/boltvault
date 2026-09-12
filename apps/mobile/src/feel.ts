/**
 * Haptics and sound on the phone (master plan §7.8): three impacts and three
 * short samples, all behind Settings › Appearance & feel (the wallet gates
 * them; this file only plays).
 */
import * as Haptics from 'expo-haptics'

const STYLE = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const

export function haptic(kind: 'light' | 'medium' | 'heavy'): void {
  void Haptics.impactAsync(STYLE[kind]).catch(() => undefined)
}

const SOUNDS = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro resolves assets by require()
  confirm: require('../assets/sounds/confirm.wav') as number,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  receive: require('../assets/sounds/receive.wav') as number,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  error: require('../assets/sounds/error.wav') as number,
}

interface Player {
  play(): void
  seekTo(seconds: number): Promise<void>
}

const players = new Map<keyof typeof SOUNDS, Promise<Player>>()

async function player(kind: keyof typeof SOUNDS): Promise<Player> {
  let p = players.get(kind)
  if (!p) {
    p = import('expo-audio').then((m) => m.createAudioPlayer(SOUNDS[kind]) as unknown as Player)
    players.set(kind, p)
  }
  return p
}

export function sound(kind: 'confirm' | 'receive' | 'error'): void {
  void player(kind)
    .then(async (p) => {
      await p.seekTo(0)
      p.play()
    })
    .catch(() => undefined)
}
