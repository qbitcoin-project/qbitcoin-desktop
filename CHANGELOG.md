# Changelog

## 1.5.0 — 2026-10-14

### Added

- Import delegated-staking private keys, receive and send from their delegated address, and back up the complete key. Key previews identify the delegate and explain staking maturity.

### Changed

- Keep the wallet list responsive by reading saved delegate details without decoding imported private keys again.
- The sidebar now has a dedicated Lock wallet action at the bottom, with network and Falcon badges removed. Theme controls remain at the top, and release notes are available from Help → What’s new.
- Reduce delays when checking, importing or sending from a private key by decoding its WIF only once per operation.

### Fixed

- Transaction labels are now described as local notes with clear keyboard hints. Escape cancels an edit without saving or closing the transaction drawer, and saved notes appear immediately.
- Convert to BTC excludes maturing coins and coins with unverified maturity from the displayed available balance, so excessive amounts are rejected before review.
- BTC conversion can now start as soon as a deposit appears in the mempool, without waiting for its first confirmation. The conversion balance includes pending deposits.
- Delegate identifiers use the same monospace font as wallet addresses.
- Transaction details display readable operation names for delegated staking scripts.
- Token transfers now exclude frozen token outputs as well as frozen coins used to pay the network fee.
- Completed conversions now show the amount received, destination address and credit time, with an explorer link to the receiving coinbase transaction. Pending conversions retain a clearly labelled source-chain link.
- Settings no longer shows a single address for recovery-phrase wallets, which can contain multiple addresses. Use Receive to view their addresses.
- The Falcon address shortcut now opens Receive with Falcon-512 selected. Wallets containing only a classical key no longer offer this shortcut.
- Imported wallets show the owner's signature algorithm separately from delegated staking, so a long address no longer incorrectly implies Falcon protection.
- Calculate network fees from transaction sizes, accounting for Falcon signatures, destination addresses, token data and conversion reclaim scripts.
- Send, private-key sweeps and coin control show maturing staking funds and their availability time. Automatic selection, including Max without a manual selection, excludes maturing or unverified coins. Manually selected maturing coins show a confirmation delay warning.
- Token transfers correctly fund the network fee when paying it requires several small coin outputs.
- Rejected sends refresh the available coins and require a new review. When submission status is uncertain, checking again looks up or resends the same signed transaction without creating a new transaction ID.
- Send and Convert now reject invalid amounts and amounts above the available balance before review, with clear messages beside the amount field.

### Security

- Clear imported private keys when a wallet session ends, including keys loaded by operations that finish after locking or switching wallets.

### Removed

- Removed the unavailable Electrum server option and its reference from connection settings.

## 1.4.0 — 2026-10-08

### Added

- Read release notes inside the wallet, even offline or before unlocking, from What’s new in the sidebar or Help menu.
- Open transaction details on qbtcscan.org using the Explorer button.

### Fixed

- Transaction history and details now load for wallets receiving staking rewards. Staking rewards are shown separately from transaction fees.

## 1.3.0 — 2026-09-29

Safer backups, more control over sensitive information, and a smoother wallet setup.

### Check your imported wallets

**Save a separate backup for each imported wallet.** Settings → Wallet backup
now shows the backup for the wallet you have selected. Earlier versions always
showed the Main wallet's recovery phrase. That phrase does not restore your
imported wallets: select each one and save its own recovery phrase or private key.

### Backup and privacy

- **The right backup for every wallet.** Imported seed wallets show their own
  recovery phrase and exact BIP39 passphrase; imported keys show their private
  key, signature algorithm, address and network. Watch-only wallets export
  public data for following the same wallet on another device.
- **Secrets appear only when you ask.** Recovery phrases and private keys hide
  after two minutes, when you switch windows, or when you choose Hide now.
  Revealing a backup from Settings always asks for your password.
- **Screen capture protection.** On Windows, the wallet window is excluded from
  screenshots and recordings while a secret is visible. On macOS and Linux,
  a reminder asks you to pause screen sharing and recording first.
- **Fewer clipboard copies.** Recovery phrases and displayed private keys cannot
  be copied or dragged out of the wallet. A pasted private key is cleared from
  the clipboard after import.
- **Automatic locking.** Sleep, screen lock, switching users and closing the
  window lock the wallet. If the window stops responding, it is hidden and
  locked; after a crash, the wallet reopens locked.
- **Password protection.** After three incorrect passwords, further attempts
  have a growing delay of up to 30 seconds. Unlocking, revealing backups and
  changing the password share this limit.
- **Safer password recovery.** Restoring from a recovery phrase replaces the
  existing wallet only after its replacement is complete, then asks you to
  unlock with your new password.

### Improvements

- **A calmer backup check.** Confirming a recovery phrase has no countdown,
  preserves the words you enter while you consult your notes, and checks each
  word after you leave its field.
- **Clearer forms.** Field hints and errors work with screen readers; keyboard
  focus stays visible in Windows High Contrast mode. Long phrases and keys
  expand their fields, and validation waits until you leave a field.
- **Cleaner release menus.** Developer tools, page reload and the macOS
  Services menu are removed from release builds.

### Fixes

- Tall dialogs fit inside the window and scroll, keeping their actions reachable.
- The Max button in Send from a key is aligned with the amount field.
- Coin and transaction labels are saved correctly when using an input method editor.
- An imported wallet's BIP39 passphrase is preserved even when it contains only spaces.
- The Return BTC amount field and its Max button are aligned.

### Existing wallets

Wallets, passwords, contacts and settings carry over without a data migration.
