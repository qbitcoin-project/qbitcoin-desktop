// BRAND FILE: pins the identifiers that this brand's installs store.
import { describe, expect, it } from 'vitest'
import { WATCH_DESCRIPTOR_KIND } from '../../../src/main/brand/identifiers'
import { ADVANCED_MODE_KEY, NODE_TIP_KEY } from '../../../src/renderer/brand/storageKeys'

describe('persisted brand identifiers', () => {
  it('keeps the identifiers stored by existing installs', () => {
    expect(WATCH_DESCRIPTOR_KIND).toBe('qbt-watch')
    expect(ADVANCED_MODE_KEY).toBe('wallet.advancedMode')
    expect(NODE_TIP_KEY).toBe('wallet.tipHeight')
  })
})
