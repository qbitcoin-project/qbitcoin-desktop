import { EsploraClient, MAX_BROADCAST_BYTES as SDK_MAX_BROADCAST_BYTES } from '@qbtc/chain'
import { describe, expect, it, vi } from 'vitest'
import { assertBroadcastSize, MAX_BROADCAST_BYTES } from '../../src/main/wallet/transactionLimits'
import { validateDelegationJournal } from '../../src/main/wallet/delegationStore'
import { stakingFixture } from '../fixtures/staking'

describe('wallet and installed SDK broadcast limit', () => {
  it.each([100_001, 2 * 1024 * 1024 - 1, 2 * 1024 * 1024])('accepts %i serialized bytes and preserves the complete HTTP body', async (bytes) => {
    expect(MAX_BROADCAST_BYTES).toBe(2_097_152)
    expect(MAX_BROADCAST_BYTES).toBe(SDK_MAX_BROADCAST_BYTES)
    expect(() => assertBroadcastSize(bytes)).not.toThrow()
    const txid = 'ab'.repeat(32), hex = 'cd'.repeat(bytes)
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(txid, { status: 200 }))
    const client = new EsploraClient({ name: 'Test', url: 'https://node.example', network: 'testnet', protocol: 'esplora', operator: 'Test', priority: 1 }, { fetchImpl, maxRetries: 0 })
    await expect(client.broadcastTransaction(hex)).resolves.toBe(txid)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = String(fetchImpl.mock.calls[0]![1]!.body)
    expect(body.length).toBe(bytes * 2 + 10)
    expect(JSON.parse(body).hex).toBe(hex)
  })

  it('rejects one byte above the cap in both wallet and installed SDK before HTTP', async () => {
    const bytes = MAX_BROADCAST_BYTES + 1
    expect(() => assertBroadcastSize(bytes)).toThrow(/2 MiB/)
    // A caller-specific bound may lower, but never raise, the transport limit.
    expect(() => assertBroadcastSize(bytes, bytes + 1)).toThrow(/2 MiB/)
    const fetchImpl = vi.fn<typeof fetch>()
    const client = new EsploraClient({ name: 'Test', url: 'https://node.example', network: 'testnet', protocol: 'esplora', operator: 'Test', priority: 1 }, { fetchImpl })
    await expect(client.broadcastTransaction('00'.repeat(bytes))).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('validates a journal at the size boundary without regex stack exhaustion and rejects malformed or larger hex', async () => {
    const f = stakingFixture(), draft = await f.service.buildFunding({ algo: 'ecdsa', amountAtomic: '10000000' })
    await f.service.confirm(draft.draftId)
    const journal = structuredClone(f.data()), op = journal.operations[0]!
    const withRaw = (rawHex: string) => ({ ...journal, operations: [{ ...op, rawHex }] })
    const max = 'ab'.repeat(MAX_BROADCAST_BYTES)
    expect(validateDelegationJournal(withRaw(max), 'wallet', 'testnet').operations[0]!.rawHex).toBe(max)
    for (const raw of [max + 'ab', max.slice(1), max.slice(0, -1) + 'g', '']) {
      expect(() => validateDelegationJournal(withRaw(raw), 'wallet', 'testnet')).toThrow()
    }
  })
})
