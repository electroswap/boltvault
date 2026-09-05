import { Buffer } from 'buffer';
import { registerRootComponent } from 'expo';

// The UR registry (Keystone) and Ledger's BLE transport expect Node's Buffer (§2.7 S2).
if (!('Buffer' in globalThis)) (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
