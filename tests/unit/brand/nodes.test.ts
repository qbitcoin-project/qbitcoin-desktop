import { describe, expect, it } from 'vitest'
import { DEFAULT_NODES, defaultNodesFor } from '../../../src/main/brand/nodes'

// BRAND TEST: pins this brand's bundled nodes; the shape invariants hold for
// every brand.
describe('bundled nodes', () => {
  it("ships the project's public node for both networks", () => {
    expect(defaultNodesFor('mainnet').map((n) => n.url)).toEqual(['https://api.qbitcoin.net'])
    expect(defaultNodesFor('testnet').map((n) => n.url)).toEqual(['https://api-testnet.qbitcoin.net'])
    for (const n of DEFAULT_NODES) expect(n.operator).toBe('QBitcoin Project')
  })

  it('lists well-formed HTTPS endpoints, priority-sorted per network', () => {
    for (const n of DEFAULT_NODES) {
      // HTTPS only, no trailing slash.
      expect(n.url).toMatch(/^https:\/\/\S+[^/]$/)
      expect(n.name.length).toBeGreaterThan(0)
      expect(n.operator.length).toBeGreaterThan(0)
    }
    for (const network of ['mainnet', 'testnet'] as const) {
      const list = defaultNodesFor(network)
      expect(list.every((n) => n.network === network)).toBe(true)
      const priorities = list.map((n) => n.priority)
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b))
    }
  })
})
