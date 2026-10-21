import { ChainError, type AddressInfo, type ChainTx, type Outspend, type Utxo } from '@qbtc/chain'
import { deserialize, fromHex, getPublicKey, toHex, txid } from '@qbtc/crypto'
import { vi } from 'vitest'
import { addressFromPubkey, decodeAddress } from '../../src/main/crypto'
import type { DelegateProfile } from '../../src/main/wallet/delegationTypes'
import { encodeDelegatePubkeyhash } from '../../src/main/wallet/delegation'
import { DelegationService, type StakingReader, type StakingWallet } from '../../src/main/wallet/DelegationService'
import { emptyDelegationJournal, type DelegationJournal, type DelegationStore } from '../../src/main/wallet/delegationStore'
import { signUnsignedTxWithKey } from '../../src/main/wallet/keyWallet'
import type { GatheredUtxo } from '../../src/main/wallet/spendable'
import { SpendCoordinator } from '../../src/main/wallet/SpendCoordinator'

export const ZERO_STATS = { fundedTxCount: 0, fundedSum: 0n, spentTxCount: 0, spentSum: 0n }
export const stakingProfile: DelegateProfile = {
  id: 'test-service', label: 'Test service', network: 'testnet', status: 'active',
  minimumAtomic: '10000000', minimumVerified: true, commission: '5%', fundingEnabled: true,
  hashes: { ecdsa: encodeDelegatePubkeyhash(new Uint8Array(20).fill(10), 'testnet'), falcon512: encodeDelegatePubkeyhash(new Uint8Array(32).fill(11), 'testnet') },
}
export const missingTx = (): ChainError => new ChainError('http_4xx', 'Not found', { status: 404 })
export function chainTx(id: string, patch: Partial<ChainTx> = {}): ChainTx {
  return { txid: id, version: 1, vin: [], vout: [], fee: 0n, size: 200, status: { confirmed: true, blockTime: 1700000000 }, ...patch }
}

/** Public synthetic key and an in-memory chain; never reads real wallet data. */
export function stakingFixture(options: { profiles?: readonly DelegateProfile[]; maxTxBytes?: number } = {}) {
  const privateKey = new Uint8Array(32).fill(1)
  const publicKey = getPublicKey(privateKey)
  const address = addressFromPubkey(publicKey, 'ecdsa', 'testnet')
  const key = { privateKey, publicKey, address, algo: 'ecdsa' as const }
  const transactions = new Map<string, ChainTx>()
  const unspent = new Map<string, Utxo[]>()
  const history = new Map<string, ChainTx[]>()
  const spent = new Map<string, Outspend>()
  const ordinary: GatheredUtxo[] = [{ txid: '11'.repeat(32), vout: 0, value: 200000000n, confirmed: true, address, algo: 'ecdsa', chain: 0, index: 0 }]
  transactions.set(ordinary[0]!.txid, chainTx(ordinary[0]!.txid, { vout: [{ value: ordinary[0]!.value,
    address, scripthash: toHex(decodeAddress(address).scripthash) }] }))
  let journal = emptyDelegationJournal('wallet', 'testnet')
  const events: string[] = []
  const store: DelegationStore = {
    load: vi.fn(async () => structuredClone(journal)),
    save: vi.fn(async (next) => { events.push(`save:${next.operations.at(-1)?.state ?? 'records'}`); journal = structuredClone(next) }),
  }
  const reader: StakingReader = {
    getAddressInfo: vi.fn(async (addr): Promise<AddressInfo> => ({ address: addr, chain: { ...ZERO_STATS,
      fundedTxCount: (unspent.get(addr)?.length ?? 0) > 0 ? 1 : 0,
      fundedSum: (unspent.get(addr) ?? []).filter((u) => u.status.confirmed).reduce((s, u) => s + u.value, 0n) }, mempool: ZERO_STATS, tokens: {} })),
    listUnspent: vi.fn(async (addr) => unspent.get(addr) ?? []),
    getAddressTransactions: vi.fn(async (addr, cursor) => cursor === undefined ? history.get(addr) ?? [] : []),
    getTransaction: vi.fn(async (id) => { const found = transactions.get(id); if (!found) throw missingTx(); return found }),
    getOutspend: vi.fn(async (id, vout) => spent.get(`${id}:${vout}`) ?? { spent: false }),
    broadcastTransaction: vi.fn(async (raw) => {
      events.push('broadcast')
      const signed = deserialize(fromHex(raw)), id = toHex(txid(signed))
      transactions.set(id, chainTx(id, { status: { confirmed: false } }))
      return { txid: id }
    }),
  }
  const wallet: StakingWallet = {
    owners: vi.fn(async () => [{ kind: 'key', algo: 'ecdsa' }] as const),
    publicKey: vi.fn(async () => publicKey.slice()),
    keypair: vi.fn(async () => ({ privateKey: privateKey.slice(), publicKey: publicKey.slice() })),
    fundingPool: vi.fn(async () => ordinary),
    ordinaryInputAddress: vi.fn(async () => address),
    changeAddress: vi.fn(async () => address),
    consumeChange: vi.fn(async () => { events.push('change') }),
    feeRate: vi.fn(async () => 1),
    signFunding: vi.fn(async (unsigned) => { events.push('sign'); return signUnsignedTxWithKey(unsigned, key, 'testnet') }),
    changed: vi.fn(),
  }
  const coordinator = new SpendCoordinator()
  const make = (gate = coordinator) => new DelegationService({ network: 'testnet', profiles: options.profiles ?? [stakingProfile],
    reader, store, wallet, coordinator: gate, maxTxBytes: options.maxTxBytes })
  const service = make()
  return { service, make, reader, wallet, store, coordinator, events, ordinary, transactions, unspent, history, spent, key,
    data: () => journal, setData: (next: DelegationJournal) => { journal = next } }
}
