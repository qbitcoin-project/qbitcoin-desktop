import { describe, expect, it } from 'vitest'
import { ContactService } from '../../src/main/wallet/ContactService'

function harness() {
  let blob: string | null = null
  const store = { read: async () => blob, write: async (b: string) => { blob = b } }
  const sealer = { sealData: async (p: string) => p, openData: async (b: string) => b }
  const svc = new ContactService(store, sealer, (address) => address.startsWith('bq'))
  return { svc, readBlob: () => blob }
}

describe('ContactService', () => {
  it('adds, lists sorted by name, and removes', async () => {
    const { svc } = harness()
    await svc.add('Zoe', 'bqzoe')
    await svc.add('Amy', 'bqamy')
    expect((await svc.list()).map((c) => c.name)).toEqual(['Amy', 'Zoe'])
    await svc.remove('bqzoe')
    expect((await svc.list()).map((c) => c.name)).toEqual(['Amy'])
  })

  it('renames when the same address is added again', async () => {
    const { svc } = harness()
    await svc.add('Old', 'bqone')
    await svc.add('New', 'bqone')
    const list = await svc.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({ name: 'New', address: 'bqone' })
  })

  it('rejects an invalid address', async () => {
    const { svc } = harness()
    await expect(svc.add('Bad', 'nope')).rejects.toThrow(/valid address/)
  })

  it('rejects an empty name', async () => {
    const { svc } = harness()
    await expect(svc.add('   ', 'bqok')).rejects.toThrow(/name is required/)
  })
})
