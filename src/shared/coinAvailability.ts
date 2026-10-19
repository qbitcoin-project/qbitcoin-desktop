import type { UtxoView } from './protocol'

export function ordinaryCoinAvailable(coin: UtxoView): boolean {
  return !coin.frozen && !coin.delegated && coin.reservedBy === undefined && !coin.availabilityUnknown
}
