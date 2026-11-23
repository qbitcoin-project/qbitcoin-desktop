# macOS testnet wallet with Touch ID

This build uses the normal wallet screens and an isolated test profile. Start with a new testnet recovery phrase. Keep the existing Developer ID provisioning profile and notarization environment. The prototype and test wallet use the same application identifier and separate data directories. The wallet signs with a dedicated Keychain access group ending in `.vault-unlock` and explicitly selects it for every Keychain operation. Quit the prototype before opening the wallet.

## Build and open

From the desktop project root, install the dependencies pinned in the lockfile. The Touch ID wallet uses the published crypto and vault packages.

```sh
pnpm install --frozen-lockfile
export TOUCH_ID_PROFILE="/absolute/path/to/your.provisionprofile"
TOUCH_ID_PROTOTYPE=0 TOUCH_ID_WALLET=1 node build/build-mac-beta.mjs --distribute
```

The builder verifies the embedded profile, Keychain group, native module signature, hardened application entitlements and Electron fuses. Open the DMG in `release/beta/<beta-version>/touch-id-wallet/`. Drag the application into a separate test folder, eject the DMG and open the copied application. Expect wallet onboarding and a Testnet indicator.

## Check the wallet

1. Create a new testnet wallet and finish confirming its recovery phrase, or sign in to an existing wallet with a pending Touch ID offer. Before the dashboard appears, choose **Enable Touch ID** and touch the sensor. This step has no password field. To check the optional path on a fresh profile, choose **Later**. Open **Settings → Security → Set up Touch ID**, verify that a wrong password is rejected, then enter the correct wallet password and touch the sensor.
2. Lock the wallet, choose **Unlock with Touch ID** and touch the sensor. The same account and receive address should reopen. Quit, reopen the installed app and repeat. Choose **Use password** on a subsequent login and check the same address.
3. Cancel an unlock, then leave another prompt open for 35 seconds. The wallet should stay locked and offer a fresh request. Lock the Mac while a request is pending and check that a late touch cannot open the wallet. Try an unregistered finger. macOS manages retries within its dialog. When macOS reports a final denial or lockout, the wallet should focus the password field.
4. In Settings, request the recovery phrase. The wallet should still ask for the wallet password. Choose **Turn off Touch ID** and cancel the system prompt. Verify Touch ID is still enabled. Repeat and approve with a fingerprint, then restart and check password login. To test the fallback, try disabling while Touch ID is unavailable. A wrong wallet password must leave Touch ID enabled, and the correct password must turn it off. Enable it again, change the wallet password, lock and restart. The old enrollment should no longer offer quick unlock.
5. Trigger a Touch ID lockout in a dedicated macOS test account. Enter the wallet password and open **Settings → Security**. Look for the instruction to unlock your Mac with its account password. Lock the Mac and unlock it with the Mac password. The next wallet unlock should offer Touch ID. Return to Settings and verify that the instruction has disappeared.
6. Successfully unlock the wallet with Touch ID once in this build, then add a fingerprint in the dedicated test account. On returning to **Settings → Security**, choose **Set up Touch ID again**. Try an incorrect wallet password, then the correct password. Cancel the system prompt and verify you can retry. Approve a fresh request, lock the wallet and test Touch ID again. If you removed every fingerprint, first add one in **System Settings → Touch ID & Password**.
7. To check update compatibility, install a second signed copy with the same ID and team over the first, without changing the fingerprints or the vault. The original enrollment should still open that wallet.

Earlier beta enrollments acquire a fingerprint-set reference on their first successful Touch ID unlock in this build. The wallet also refreshes that reference after a successful protected read on a new major macOS version. Apple documents how the [biometric state hash](https://developer.apple.com/documentation/localauthentication/ladomainstatebiometry/statehash) changes and when the [Keychain access constraint](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset) invalidates an item.

## Automated wallet window check

Build the isolated test fixture and run the window test with other wallet instances closed:

```sh
TOUCH_ID_WALLET=1 WALLET_TEST_BUILD=1 pnpm exec electron-vite build --config tests/wallet-touch-id/electron.config.mjs
pnpm exec playwright test --config tests/wallet-touch-id/playwright.config.ts
```

The fixture replaces the native Keychain adapter at build time, keeps test keys in memory and uses the normal wallet UI, IPC and vault. The signed beta uses the macOS adapter.
