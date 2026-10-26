# Coopanion for Android

Brings Coo from the computer to the phone's screen. Coo keeps living on the computer (its mind, voice recognition and figure packs stay there); the app shows the pet page in a floating window over other apps, so Coo walks along the bottom of the phone's screen, talks in bubbles and can be touched as on the desktop. While Coo is on the phone the computer's pet window steps aside; when the phone locks, or Coo is sent back, the window takes Coo again.

## Use

1. On the computer, turn on **Local network access** in the desktop pet World's settings (advanced mode, Worlds) and restart Coopanion. On Windows, allow Coopanion through the firewall on private networks.
2. Install the app, open it, allow **display over other apps**, and the microphone if you want to talk to Coo from the phone.
3. Pair: open the World's **View on a phone** address on the phone (scan it, tap it, share it to the app, or paste it into the app) and press **Pair**. The app remembers the computer; later **Bring Coo over** is enough.

The notification shows whether Coo is on the phone, and hides Coo or sends it back.

## How it works

- `PetOverlay` is a `TYPE_APPLICATION_OVERLAY` window holding a transparent WebView laid out on the whole screen. The page reports through `petHost.place` the part it draws on; the window covers just that part with a margin and moves when it is left, so touches elsewhere reach the apps below.
- `pet-host.js` is injected at document start, only into the paired computer's origin, and defines `window.petHost` with `kind: 'phone'`. It talks to the app over a `WebMessageListener` that is limited to the main frame of that origin; the sandboxed figure frames cannot reach it.
- The page connects with `host=phone`. The server only takes that from a LAN address with the pairing cookie, and ranks it above the computer's window.
- The microphone is recorded natively (16 kHz PCM16, 100 ms chunks) because the page is plain `http://` and gets no `getUserMedia`. The foreground service carries the microphone type once the permission is granted.
- The WebView ignores the phone's proxy and, where it can, binds to Wi-Fi, so a proxy or VPN app does not stand between the phone and the computer.

## Build

JDK 17 and the Android SDK (platform 36). `./gradlew assembleDebug` writes `app/build/outputs/apk/debug/app-debug.apk`.

To try it without the LAN: `adb reverse tcp:17797 tcp:17797`, then pair with `http://coo.localhost:17797/pair?key=…`. WebView resolves `*.localhost` to the phone itself and adb carries it to the computer, while the server still sees a non-loopback Host and checks the pairing.
