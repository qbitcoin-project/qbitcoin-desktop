import { MAX_BROADCAST_BYTES } from '@qbtc/chain'

// Use the transport's public limit for both preparation and signed wire checks.
export { MAX_BROADCAST_BYTES }

export function assertBroadcastSize(bytes: number, limit = MAX_BROADCAST_BYTES): void {
  if (bytes > Math.min(limit, MAX_BROADCAST_BYTES)) {
    throw new Error('This transaction exceeds the 2 MiB sending limit. Use a smaller amount or review a smaller part.')
  }
}
