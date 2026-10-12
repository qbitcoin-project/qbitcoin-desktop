import { formatToken, parseToken } from './format'

/** Validate the amount before requesting a transaction or a fee estimate. All
 * comparisons use atomic integers, including balances above Number's range. */
export function validateAmount(value: string, {
  decimals = 8,
  available = null,
  minimum = null,
}: { decimals?: number; available?: bigint | null; minimum?: bigint | null } = {}): { atomic: bigint | null; error: string | null } {
  if (value.trim() === '') return { atomic: null, error: null }
  let atomic: bigint
  try {
    atomic = parseToken(value, decimals)
  } catch {
    return { atomic: null, error: decimals === 0 ? 'Enter a whole number.' : `Enter a valid amount with up to ${String(decimals)} decimal places.` }
  }
  if (atomic <= 0n) return { atomic, error: 'Amount must be greater than zero.' }
  if (minimum !== null && atomic < minimum) return { atomic, error: `Below the minimum of ${formatToken(minimum.toString(), decimals)}.` }
  if (available !== null && atomic > available) return { atomic, error: `Amount exceeds the available balance of ${formatToken(available.toString(), decimals)}.` }
  return { atomic, error: null }
}
