#!/usr/bin/env bash
# Does the built app actually start on a real device?
#
# This exists because a build can be green in every way that CI measures and
# still die on launch. It happened: a version pin missed in the SDK 57 upgrade
# left two copies of expo-file-system in the tree, both autolinked, and the app
# installed cleanly and then threw NoClassDefFoundError before painting a
# frame. Nothing in the repo would have caught it — the Playwright suite runs
# the web body, and Maestro needs Maestro installed.
#
# Deliberately narrow: install, launch, and prove the process is still alive
# with no fatal exception. Anything about what is on screen belongs in the
# Maestro flows next door.
#
# Usage: scripts/device-smoke.sh [path/to.apk] [serial]
set -euo pipefail

APK="${1:-android/app/build/outputs/apk/release/app-release.apk}"
SERIAL="${2:-}"
PKG=io.electroswap.boltvault
ACTIVITY="$PKG/.MainActivity"
SETTLE=12

adb() { command adb ${SERIAL:+-s "$SERIAL"} "$@"; }

[ -f "$APK" ] || { echo "no apk at $APK" >&2; exit 1; }
if [ -z "$(command adb ${SERIAL:+-s "$SERIAL"} get-state 2>/dev/null || true)" ]; then
  echo "no device attached (adb devices)" >&2
  exit 1
fi

echo "installing $(du -h "$APK" | cut -f1) …"
adb install -r "$APK" >/dev/null

# A locked or dozing screen screenshots and renders as solid black, which has
# already cost one false reading. Wake it before judging anything.
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true

adb logcat -c
adb shell am start -n "$ACTIVITY" >/dev/null
sleep "$SETTLE"

PID="$(adb shell pidof "$PKG" | tr -d '\r' || true)"
LOG="$(adb logcat -d 2>/dev/null || true)"
FATAL="$(printf '%s' "$LOG" | grep -A15 'FATAL EXCEPTION' || true)"

if [ -z "$PID" ]; then
  echo "FAIL: $PKG is not running ${SETTLE}s after launch" >&2
  [ -n "$FATAL" ] && printf '%s\n' "$FATAL" >&2
  exit 1
fi
if [ -n "$FATAL" ]; then
  echo "FAIL: $PKG is running but logged a fatal exception" >&2
  printf '%s\n' "$FATAL" >&2
  exit 1
fi

echo "OK: $PKG alive (pid $PID) after ${SETTLE}s, no fatal exception"
