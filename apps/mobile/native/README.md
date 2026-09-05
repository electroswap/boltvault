# Native targets (master plan §7.13, §5)

These sources ship with the app but are compiled only by a native build (EAS `pnpm --filter @boltvault/mobile exec eas build`); they cannot be built or run in the JS toolchain and are a manual gate on a device.

| Target | Source | Wiring |
|---|---|---|
| iOS home-screen widget + Live Activity (bridge in flight) | `ios/BoltVaultWidget/BoltVaultWidget.swift` | `@bacons/apple-targets` reads `apps/mobile/targets/widget/expo-target.config.js` (type `widget`, App Group `group.io.electroswap.boltvault`, `NSSupportsLiveActivities`); the app writes `widget/widget-snapshot.json` (see `src/widget.ts`) — move the file into the App Group container once the target exists (`FileSystem` → `containerURL(forSecurityApplicationGroupIdentifier:)`). |
| Android home-screen widget (Glance) | `android/widget/BoltVaultWidget.kt`, `boltvault_widget_info.xml` | `plugins/withWidgets.js` copies the sources, registers the receiver and adds the Glance dependency at `expo prebuild`. |
| Live Activities on Android | ongoing notification (expo-notifications) — no separate target. |

What the widget ever sees: the account's Field seed (its address), a label, the holder tier, the total and 24 h change the user opted into. Never a seed, a key, or the address book.

## Universal links

`well-known/apple-app-site-association` and `well-known/assetlinks.json` go to `https://wallet.electroswap.io/.well-known/` (ops, §9.8) with the Team ID and the upload-key fingerprint filled in.

## Store checklist

- EAS project id, App Store Connect id, Play service account (`eas.json` placeholders).
- `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` — the wallet's own Reown project id (never the interface's dApp id).
- `EXPO_PUBLIC_BOLTVAULT_KEY` — the wallet API key once backend B0 lands; without it push registration stays local.
- Crypto export questionnaire, privacy nutrition labels (no third-party data; only ElectroSwap's API and chain RPCs see an address, §3.8).
