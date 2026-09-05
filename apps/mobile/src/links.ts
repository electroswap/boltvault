/**
 * Deep and universal links on the phone (master plan §5.3): the URL the app
 * was opened with and every later one, handed to the wallet's parser. The
 * wallet only ever navigates or starts a pairing from a link.
 */
import * as Linking from 'expo-linking'

export const links = {
  initial: (): Promise<string | null> => Linking.getInitialURL(),
  subscribe: (listener: (url: string) => void): (() => void) => {
    const sub = Linking.addEventListener('url', ({ url }) => listener(url))
    return () => sub.remove()
  },
}
