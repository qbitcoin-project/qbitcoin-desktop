import { describe, expect, it } from 'vitest'
import { DEFAULT_NODES, defaultNodesFor } from '../../../src/main/brand/nodes'

// BRAND TEST: no public nodes are bundled yet; a brand that ships some replaces
// the emptiness assertions with "at least one endpoint per network" in their
// brand tests. The shape invariants hold for every brand.
describe('bundled nodes', () => {
  it('ships no public nodes yet', () => {
    expect(DEFAULT_NODES).toEqual([])
    expect(defaultNodesFor('mainnet')).toEqual([])
    expect(defaultNodesFor('testnet')).toEqual([])
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
