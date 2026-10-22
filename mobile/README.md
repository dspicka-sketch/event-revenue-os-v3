# RevOS mobile

An organizer app for venue owners, promoters and talent buyers: show cards with tickets sold, gross sales, 14-day sales pace, targets and items needing attention, plus a manual Refresh.

It uses the **same** RevOS server, accounts and calculations as the desktop app. Revenue, pace, target and attention logic is imported from `../src/domain` and is never re-implemented here. Detailed reconciliation, target editing and integration management stay on desktop.

## Run

```bash
cd mobile
npm ci
npx expo start            # press i / a for a simulator, or scan the QR code with Expo Go
```

1. Start the RevOS server so your phone can reach it: from the repo root, `HOST=0.0.0.0 npm start`.
2. In the app's sign-in screen, set **RevOS server** to `http://<your computer's LAN IP>:8787` and sign in with your RevOS account.
3. The session token is kept in the iOS Keychain / Android Keystore (`expo-secure-store`).

Plain `http://` is only for a trusted local network. A hosted server must use `https://`.

You can set the default server address at build time with `EXPO_PUBLIC_API_URL=https://revos.example.com`.

## Checks

```bash
npm run typecheck         # includes the shared ../src/domain and ../src/shared modules
npm test                  # API client and display helpers
npx expo export --platform ios     # proves the native JS bundle compiles (no Xcode needed)
npx expo export --platform web     # browser preview build in dist/
```

The web preview calls the API cross-origin, so start the server with `REVOS_CORS_ORIGINS=http://localhost:8081`. Native apps don't need this.

## How shared code is wired

- `metro.config.js` maps `@revos/domain/*` and `@revos/shared/*` to `../src/domain` and `../src/shared`, and maps their `.js` import specifiers to the `.ts` sources.
- `tsconfig.json` has matching `paths`, so `tsc` typechecks the shared modules with the app.
- Shared modules must stay dependency-free and must not use Node-only APIs.

## Not done yet

- On-device testing on a physical iPhone or Android phone (only web and iOS bundle exports were verified in the build environment)
- Push notifications for attention items (needs a hosted server and store builds)
- App icons and splash screen are the Expo template defaults
- App Store / Play Store distribution (needs Daniel's accounts and confirmation)
