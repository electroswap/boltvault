# Native targets (master plan §7.13, §5)

These sources ship with the app but are compiled only by a native build (EAS `pnpm --filter @boltvault/mobile exec eas build`); they cannot be built or run in the JS toolchain and are a manual gate on a device.

| Target | Source | Wiring |
|---|---|---|
| iOS home-screen widget + Live Activity (bridge in flight) | `../targets/widget/BoltVaultWidget.swift` | `@bacons/apple-targets` reads `../targets/widget/expo-target.config.js` (type `widget`, App Group `group.io.electroswap.boltvault`, `NSSupportsLiveActivities`) and compiles every file in that directory into the target. **Not registered yet — see below.** |
| Android home-screen widget (Glance) | `android/widget/BoltVaultWidget.kt`, `boltvault_widget_info.xml` | `plugins/withWidgets.js` copies the sources, registers the receiver and adds the Glance dependency at `expo prebuild`. |
| Live Activities on Android | ongoing notification (expo-notifications) — no separate target. |

The snapshot itself is written by `src/widget.ts`, to the place each platform's
widget actually reads: the App Group container on iOS (a WidgetKit extension is
a separate process and cannot see the app's document directory), the document
directory on Android (which is the Glance widget's `context.filesDir`).

## The iOS widget target is not built yet

`expo prebuild -p ios` produces no widget target today, so nothing compiles
`BoltVaultWidget.swift` and no widget appears on a device. Two steps remain, and
both are deliberately left out rather than half-done, because each changes the
root `pnpm-lock.yaml` or the iOS build graph:

1. `pnpm --filter @boltvault/mobile add @bacons/apple-targets` (commit the
   lockfile change with it).
2. Add `"@bacons/apple-targets"` to `expo.plugins` in `apps/mobile/app.json`.
   Adding it *before* step 1 breaks `expo export`, and so the CI mobile job,
   with "plugin not found" — the two go in one commit.

Also set `expo.ios.appleTeamId` in `app.json`: the generated extension needs a
team to sign against, and the same Team ID belongs in
`well-known/apple-app-site-association`.

CI (`.github/workflows/ci.yml`, mobile job) warns on every run while those are
outstanding and fails outright on a release ref, so an iOS build cannot ship
claiming a widget it never built.

What the widget ever sees: the account's Field seed (its address), a label, the holder tier, the total and 24 h change the user opted into. Never a seed, a key, or the address book.

## Universal links

`well-known/apple-app-site-association` and `well-known/assetlinks.json` go to `https://wallet.electroswap.io/.well-known/` (ops, §9.8) with the Team ID and the upload-key fingerprint filled in.

## Store checklist

- EAS project id, App Store Connect id, Play service account (`eas.json` placeholders).
- `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` — the wallet's own Reown project id (never the interface's dApp id).
- `EXPO_PUBLIC_BOLTVAULT_KEY` — the wallet API key once backend B0 lands; without it push registration stays local.
- Crypto export questionnaire, privacy nutrition labels (no third-party data; only ElectroSwap's API and chain RPCs see an address, §3.8).
