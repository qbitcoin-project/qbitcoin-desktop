import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { brand } from '../../src/renderer/brand'

// The release and brand checks only see names listed in the release aliases, and a
// whole-word match cannot find a ticker inside its own testnet form ("tCOIN").
const config = JSON.parse(readFileSync('release.config.json', 'utf8')) as { aliases: string[] }
const aliases = config.aliases.map((alias) => alias.toLowerCase())

describe('release aliases', () => {
  it('list both tickers of the brand', () => {
    expect(aliases).toContain(brand.assetLabel.mainnet.toLowerCase())
    expect(aliases).toContain(brand.assetLabel.testnet.toLowerCase())
  })

  it('list the explorer domain', () => {
    if (brand.explorerTxUrl) expect(aliases).toContain(new URL(brand.explorerTxUrl).hostname.toLowerCase())
  })
})
