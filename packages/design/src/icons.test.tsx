import { describe, expect, it } from 'vitest'
import { allIcons } from './icons'

describe('icons', () => {
  it('exports the full icon set (functions)', () => {
    const names = Object.keys(allIcons)
    expect(names.length).toBeGreaterThanOrEqual(30)
    for (const [name, Icon] of Object.entries(allIcons)) {
      expect(typeof Icon, name).toBe('function')
    }
  })
  it('the core surface icons are present', () => {
    for (const n of [
      'IconHome', 'IconSwap', 'IconActivity', 'IconSettings',
      'IconSend', 'IconReceive', 'IconBolt', 'IconLayers', 'IconFlask',
      'IconRocket', 'IconCable', 'IconShield', 'IconClock', 'IconChevronDown',
    ]) {
      expect(allIcons[n as keyof typeof allIcons], n).toBeTruthy()
    }
  })
})
