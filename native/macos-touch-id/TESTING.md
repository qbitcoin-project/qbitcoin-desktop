# Touch ID prototype for macOS

This build opens a test screen with a random 32-byte Keychain item. Transfers are simulated. Use the isolated test application for the entire run. Its settings live in a dedicated subdirectory of the beta application data directory.

## Build the signed application

Use a Mac matching the architectures in the current beta profile, Xcode or Command Line Tools, the project's Node.js with Node-API headers, pnpm and the existing Developer ID signing and notarization setup. In this project, the prototype takes its bundle identifier from `appId` in `build/brand/touch-id-prototype.json`. Use the downloaded Developer ID provisioning profile for that bundle identifier and your signing certificate.

Set the path to the downloaded file and inspect the rights that Apple granted. Run these commands in the same terminal you use for signing.

```sh
export TOUCH_ID_PROFILE="/absolute/path/to/prototype.provisionprofile"
security cms -D -i "$TOUCH_ID_PROFILE" | plutil -extract Entitlements xml1 -o - -- -
```

For an explicit profile, `com.apple.application-identifier` should be the App ID prefix followed by a dot and the prototype's bundle identifier. Check that `com.apple.developer.team-identifier` matches the signing team. The `keychain-access-groups` array must contain the full application identifier or a wildcard covering it, such as `PREFIX.*`. The build derives the actual prefix from the profile and signs the app with the exact group.

From the project root, run the signed build with your usual notarization credentials. This compiles the native module, signs and notarizes the application, then checks the installed bundle identifier, embedded profile and signed entitlements.

The hardened beta enables library validation and verifies the native module's signing team. Its Electron build disables Node launch and inspection overrides and requires the integrity-checked application ASAR. Reopen the installed app and unlock the existing test key to exercise native loading and Keychain access with those settings.

```sh
TOUCH_ID_PROTOTYPE=1 pnpm dist:mac:beta
```

Open the DMG under `release/beta/<beta-version>/touch-id/`, copy the app to a test installation folder and launch that copy. The ordinary beta and prototype share a filename, so use separate folders to keep both copies. If you enrolled a key in an earlier prototype signed with a different bundle identifier, remove it using that copy before enrolling in the new one. Record the macOS version, CPU architecture and prototype build. The installed app's test screen should appear without wallet onboarding or any network connection.

## Run the checks

For the build with diagnostics, look for **Show test log in Finder**. Quit the older copy with Command-Q before starting this one. Each interactive request has 30 seconds from the action that started it, including enrollment. The separate test-session inactivity timer is five minutes.

1. On first launch select **Later**, quit with Command-Q and reopen. The offer is dismissed and **Enable in test settings** remains available. Enable Touch ID, approve the system prompt and verify the item becomes active with a key match.
2. Select **Try reading without a prompt**. Expect **PASS** and no OS dialog. **FAIL** means the OS returned data. **Inconclusive** means the Keychain call failed for another reason. Follow each silent check with a successful interactive read to rule out a missing item.
3. Unlock, lock the session, repeat the silent check and unlock again immediately. Each interactive read must require a new touch. If the system offers a Mac password or Apple Watch, check whether it can release the key and record the result. Quit and reopen offline. The original item must match after a new touch.
4. Cancel an unlock, then try an unregistered finger. The OS manages individual touches. A final biometric denial or system lockout should offer the password route. **Use password** opens a demonstration screen without collecting a password. Record actual OSStatus values.
5. Start unlocking and press Control-Command-Q while the prompt is visible. Unlock macOS with its password to distinguish the system unlock from the pending application request. Record whether the previous prompt disappears. If it is still visible, touch it in this test app and check the final session state. It must stay locked and require a fresh request. Repeat after closing the lid and waking the Mac. Repeat both cases with **Approve with Touch ID** already pending and record the counter before and after. It must stay unchanged. Closing and reopening the application also starts locked.
6. After unlocking, select **Prepare transfer**, review the sample amount and recipient, and approve. Expect a separate Touch ID prompt and exactly one increment, including after a double click. Repeat and cancel. Then use **Replace draft during prompt**. The revised transfer must remain pending and the counter must stay unchanged, even after a successful touch.
7. Build a second signed copy, keeping the same bundle ID, team and Keychain group. Replace the first installed copy and verify the original test item still matches after a new touch without enrollment.
8. In a test macOS account, add a temporary fingerprint. Try the old item with the original finger. It should fail. Remove the test item, enroll again, then remove the temporary fingerprint and repeat. Changing fingerprints can affect other apps in this account.
9. Remove the test key, quit and reopen. State must be absent and unlock unavailable until a new key is enrolled. If possible, also try an account with no enrolled fingerprints. The password demonstration should be reachable.

Also test the **30-second deadline** before removing the key. With the Mac awake and unlocked, start an unlock and leave the dialog untouched for 35 seconds. Record when it disappears. A late touch must leave the session locked. Repeat during transfer approval. The session can stay open until its five-minute idle timeout, but the approval counter must not change and retrying must open a fresh prompt. Finally, unlock and leave the app idle for over five minutes. It must lock itself.

## Share the diagnostic log

Click **Show test log in Finder** and attach the selected `touch-id-test.log` file. If the dialog blocks access to the button, open the prototype data folder in Finder. The log persists across restarts. At 128 KiB the app keeps one previous file named `touch-id-test.log.previous`.

For an unexpected result, include the time and the exact action (Control-Command-Q, closing the lid, or waiting). The log correlates requests with power events, cancellation attempts, OSStatus or LAError results, and the final session state and approval count. The per-request screen check also cancels a request if it cannot observe the screen for more than three seconds. Keys, enrollment IDs, key fingerprints, user paths and transfer details are excluded from the log.

## Repeat the automated checks

Run controller and log tests with `pnpm exec vitest run tests/unit/touchIdProbe.test.ts tests/unit/touchIdLog.test.ts`. For the prototype window tests, compile the prototype entry points, close any other wallet instance, then run these commands in order:

```sh
TOUCH_ID_PROTOTYPE=1 WALLET_TEST_BUILD=1 pnpm exec electron-vite build
pnpm exec playwright test --config tests/touch-id/playwright.config.ts
```

These tests drive Electron with an isolated data directory and a simulated biometric adapter that can return success after cancellation. The second window test waits 30 real seconds. The signed-app checks above exercise the actual Keychain, sensor and system dialog.
