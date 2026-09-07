/**
 * How much of the screen the software keyboard is covering.
 *
 * Owner: "trying to rename a wallet, when the name field is focused, the
 * keyboard covers it so you can't see what's being typed."
 *
 * A sheet is `position: absolute; bottom: 0`, so it sits exactly where the
 * keyboard opens. Nothing in the app listened for it — there was no
 * KeyboardAvoidingView anywhere — and on an edge-to-edge Android window the
 * usual `adjustResize` cannot be relied on to shrink the view either. Reading
 * the height directly works whatever the window's soft-input mode is.
 *
 * `keyboardWillShow` fires ahead of the animation on iOS; Android only has
 * `keyboardDidShow`. Both are subscribed, and the last one to speak wins.
 *
 * On the web these events never fire and this stays 0.
 */
import { useEffect, useState } from 'react'
import { Keyboard } from 'react-native'

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height))
    const willShow = Keyboard.addListener('keyboardWillShow', (e) => setHeight(e.endCoordinates.height))
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0))
    const willHide = Keyboard.addListener('keyboardWillHide', () => setHeight(0))
    return () => {
      shown.remove()
      willShow.remove()
      hidden.remove()
      willHide.remove()
    }
  }, [])
  return height
}
