# NetPulse Inspector

On-device API traffic logger, token inspector, and cURL generator for selected
Android apps. Built with **Expo SDK 57**, **TypeScript**, and **Expo Router**.

> ⚠️ **Scope & ethics.** This tool inspects traffic on *your own device* for
> development and authorized security testing. Intercepting another app's HTTPS
> requires installing and trusting a local CA certificate and will not work
> against apps that use certificate pinning. Only use it on devices and apps you
> are authorized to test.

---

## What works today (no native build required)

Run in Expo Go / web and the whole UI is exercised by **Simulation Mode**:

- **Live Feed** with Start/Stop capture, a one-shot mock injector (⚡), search,
  and filter chips (method / status / app / "Has Auth Token").
- **Target selector** — choose which packages are intercepted.
- **4-tab Inspector**: Overview & Tokens (auto-extracted Bearer / API-key /
  Cookie / JWT with a dependency-free JWT decoder), Request, Response (with
  in-body highlight search), and a **cURL generator**.
- **Export**: HAR 1.2, Postman Collection v2.1, and a runnable cURL `.sh` bundle,
  via copy or the native share sheet.

## Project structure

```
netpulse-inspector/
├── app/
│   ├── _layout.tsx                 # Root stack + native bridge wiring
│   ├── (tabs)/
│   │   ├── _layout.tsx             # Tab navigator
│   │   ├── index.tsx               # Live Traffic Feed
│   │   ├── apps.tsx                # Target App Selector
│   │   └── export.tsx              # HAR / Postman / cURL export
│   └── request/[id].tsx            # 4-tab Request/Response/cURL inspector
├── components/                     # Badges, CodeBlock, KeyValueTable, buttons
├── hooks/useNativeInterceptor.ts   # Native → store event bridge
├── store/useTrafficStore.ts        # Zustand store + mock timer + selectors
├── theme/colors.ts                 # Dark "cyber dev" palette
├── utils/
│   ├── types.ts                    # Shared domain model
│   ├── curlGenerator.ts            # Request → cURL
│   ├── tokenExtractor.ts           # Secret scan + JWT decoder
│   ├── exporters.ts                # HAR / Postman / cURL bundle
│   ├── mockData.ts                 # Realistic mock traffic presets
│   └── format.ts                   # bytes / duration / JSON helpers
└── modules/vpn-interceptor/        # Local Expo native module (Android)
    ├── expo-module.config.json
    ├── index.ts                    # requireNativeModule + Expo Go shim
    ├── src/VpnInterceptor.types.ts
    └── android/
        ├── build.gradle
        └── src/main/
            ├── AndroidManifest.xml
            └── java/expo/modules/vpninterceptor/
                ├── VpnInterceptorModule.kt   # Expo bridge
                └── NetPulseVpnService.kt      # VpnService + per-app routing
```

## Getting started

> Requires **Node ≥ 22.13** (Expo SDK 57). Check with `node -v`.

```bash
npm install
npx expo start
```

Press `w` for web, or open in Expo Go. Tap **Start Capture** (or ⚡) on the Live
Feed to generate traffic.

Type-check:

```bash
npm run typecheck
```

## Moving to real device interception

The native module (`modules/vpn-interceptor`) is a **working skeleton**: the
VpnService lifecycle, per-app routing via `Builder.addAllowedApplication()`, the
tun `ParcelFileDescriptor`, the consent dialog, the foreground service, and the
JS event bridge are all wired. The packet pump is stubbed with TODOs.

Build the dev client (not Expo Go):

```bash
npx expo prebuild
npx expo run:android
```

Then complete the interceptor by routing the tun fd through a userspace TCP/IP
stack + local MITM proxy. A good follow-up prompt:

> "Expand `NetPulseVpnService.kt` to route the VpnService file descriptor
> through a local embedded proxy (tun2socks + local MITM proxy), parse the HTTP
> request/response, and call `emitTransaction(...)` for each captured call."

Pieces you'll add:
1. A local SOCKS/HTTP proxy bound to `127.0.0.1`.
2. A tun2socks bridge (hev-socks5-tunnel or badvpn) from the tun fd to the proxy.
   `protect()` the proxy's upstream sockets so they bypass the VPN.
3. TLS termination with a user-installed CA for HTTPS visibility.
4. `emitTransaction(...)` → `onTransaction` event → `ingest()` in the store.
