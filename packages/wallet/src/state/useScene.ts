/**
 * Which background to draw, from Settings › Appearance & feel.
 *
 * Owner: "I don't like the animated background. I want you to keep it, and
 * make it an option in the 'Appearance & feel' settings, but I want you to
 * come up with a different animation for the home page."
 *
 * So the Circuit board is the default and the Grid is a choice, alongside off.
 * The value is read once and shared, for the same reason the wallet snapshot
 * is: every screen that draws a background asks, and a Port round trip per
 * screen would flash the wrong one on the way in.
 */
import type { SceneChoice } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine, useEngineEvent } from '../engine/EngineProvider'

let shared: SceneChoice = 'circuit'

export function useScene(): SceneChoice {
  const engine = useEngine()
  const [scene, setScene] = useState<SceneChoice>(shared)

  useEffect(() => {
    let on = true
    engine.settings.get().then(
      (s) => {
        if (!on) return
        shared = s.scene
        setScene(s.scene)
      },
      () => undefined,
    )
    return () => {
      on = false
    }
  }, [engine])

  useEngineEvent('settings.changed', (e: { settings: { scene: SceneChoice } }) => {
    shared = e.settings.scene
    setScene(e.settings.scene)
  })

  return scene
}
