import { describe, expect, it } from 'vitest'
import { DELEGATE_PROFILES, DELEGATION } from '../../src/main/brand/delegation'

describe('delegation configuration', () => {
  it('ships a delegation service only together with delegation prefixes', () => {
    expect(DELEGATION !== null || DELEGATE_PROFILES.length === 0).toBe(true)
  })
})
