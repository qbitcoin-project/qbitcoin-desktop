import { describe, expect, it } from 'vitest'
import { validateAmount } from '../../src/renderer/lib/amountValidation'

describe('amount validation before transaction review', () => {
  it.each(['text', '1e5', '-1', 'NaN', 'Infinity', '1,000', '1.000000001'])('rejects %s without turning it into zero', (input) => {
    expect(validateAmount(input)).toEqual({ atomic: null, error: expect.stringContaining('valid amount') })
  })

  it('keeps an empty field neutral but rejects zero', () => {
    expect(validateAmount(' ')).toEqual({ atomic: null, error: null })
    expect(validateAmount('0.00000000').error).toMatch(/greater than zero/)
  })

  it('distinguishes minimum and balance errors from fee errors', () => {
    expect(validateAmount('0.00001', { minimum: 10_000n }).error).toMatch(/minimum of 0.0001/)
    expect(validateAmount('2', { available: 100_000_000n }).error).toMatch(/exceeds the available balance of 1/)
    expect(validateAmount('1', { available: 100_000_000n }).error).toBeNull() // Fee is checked separately.
  })

  it('preserves atomic precision for very large amounts', () => {
    const available = 90_071_992_547_409_301n
    expect(validateAmount('900719925.47409301', { available })).toEqual({ atomic: available, error: null })
    expect(validateAmount('900719925.47409302', { available }).error).toMatch(/balance/)
  })

  it('uses token precision and accepts spending the full token balance', () => {
    expect(validateAmount('1.1234567', { decimals: 6 }).error).toMatch(/6 decimal places/)
    expect(validateAmount('5', { decimals: 0, available: 5n })).toEqual({ atomic: 5n, error: null })
    expect(validateAmount('5.1', { decimals: 0 }).error).toBe('Enter a whole number.')
    expect(validateAmount('6', { decimals: 0, available: 5n }).error).toMatch(/balance/)
  })
})
