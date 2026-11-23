# Touch ID in the macOS release

The stable wallet supports fingerprint unlock on compatible Macs. The wallet password also opens it. Each network keeps its own enrollment in the existing wallet data directory.

## Build the signed DMG

From the desktop project root, use the Developer ID Application certificate and notarization credentials used for stable releases. Set `WALLET_TOUCH_ID_PROFILE` to the downloaded Developer ID provisioning profile for the stable application's bundle ID. Its entitlements must authorize the application's identifier and the Keychain group `<AppIdentifierPrefix>.<BundleID>.vault-unlock`. The beta uses a separate profile and data directory.

```sh
export WALLET_TOUCH_ID_PROFILE="/absolute/path/to/production.provisionprofile"
pnpm install --frozen-lockfile
pnpm dist:mac --publish never
```

The macOS packaging hooks compile the native module for arm64 and x86_64, apply Electron fuses, and check the signed app's identifier, entitlements, embedded profile and native module signature. Use the DMG and update artifacts under `release/`. The stable update feed and minimum macOS version are set in the distribution config.

## Check before publishing

1. Use a separate macOS account with Touch ID and a disposable mainnet wallet. Install the previous stable version, open it with its password and record the receive address. Quit and install the signed candidate over the same app.
2. Open the candidate using the original password. Choose **Later** and check the address. In Settings enable Touch ID with the wallet password and a fingerprint. Lock and unlock with Touch ID, compare the address, then quit and reopen to repeat. Also test **Use password**.
3. Cancel an unlock prompt and allow another to expire after 30 seconds. Lock the Mac during a request and, separately, close the lid during a request. On wake the wallet must remain locked. A fresh request must succeed.
4. Check the system lockout and the password fallback, fingerprint changes, turning Touch ID off, changing the wallet password, switching networks and restoring a disposable wallet. Verify that prior enrollment cannot open a replacement wallet. On a Mac without an enrolled fingerprint, check the ordinary password flow.
5. Check the installed bundle with `codesign --verify --deep --strict`, `spctl --assess --type execute` and `xcrun stapler validate`. Check the DMG and the ZIP-based updater using the release candidate before updating the public feed.
