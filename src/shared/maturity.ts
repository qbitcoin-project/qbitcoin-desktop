export interface MaturityInfo {
  readonly maturesAt?: number
  readonly maturityUnknown?: boolean
}

/** Missing fields mean an ordinary output, not an unverified staking output. */
export function isMature(coin: MaturityInfo, now = Date.now() / 1000): boolean {
  return coin.maturityUnknown !== true && (coin.maturesAt === undefined || coin.maturesAt <= now)
}
