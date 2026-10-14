import { encodeBase58Check, falcon512KeygenFromSeed, type Algorithm, type Network } from '@qbtc/crypto'
import { DELEGATION } from '../../src/main/brand/delegation'

// Synthetic, publicly reproducible keys only. Never use these keys for funds.
export async function delegatedKeyFixture(algo: Algorithm = 'falcon512', hashLength: 20 | 32 = 32, network: Network = 'mainnet') {
  const pair = algo === 'falcon512' ? await falcon512KeygenFromSeed(new Uint8Array(48).fill(7)) : undefined
  const payload = pair === undefined ? new Uint8Array(32).fill(1) : new Uint8Array([...pair.privateKey, ...pair.publicKey])
  const delegate = Uint8Array.from({ length: hashLength }, (_, i) => 128 + i)
  const version = hashLength === 32 ? DELEGATION[network].wifHash256 : DELEGATION[network].wifHash160
  const envelope = new Uint8Array([...payload, ...delegate])
  const wif = encodeBase58Check(Uint8Array.of(version), envelope)
  payload.fill(0); envelope.fill(0); pair?.privateKey.fill(0)
  return { wif, delegate, algo, network }
}
