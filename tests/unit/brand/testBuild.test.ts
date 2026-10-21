// BRAND FILE: pins this brand's macOS test build configuration.
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadBetaProfile } from '../../../build/mac-beta.mjs'
import pkg from '../../../package.json'

describe('macOS beta packaging of this brand', () => {
  it('uses consistent isolated metadata and builds only Apple Silicon without publishing', () => {
    const beta = loadBetaProfile(resolve('.'))
    const config = beta.config as {
      extends: unknown; publish: unknown; files: string[]; forceCodeSigning: boolean
      extraMetadata: { version: string; main: string; name: string }
      mac: { target: Array<{ target: string; arch: string[] }>; hardenedRuntime: boolean; notarize: boolean }
    }
    expect(beta.version).toMatch(/^\d+\.\d+\.\d+-beta\.\d+$/)
    expect(beta.version).not.toBe(pkg.version)
    expect(beta.notes.version).toBe(beta.version)
    expect(beta.notes.blocks.length).toBeGreaterThan(0)
    expect(config.extraMetadata.name).toBe(`${pkg.name}-test`)
    expect(beta.identity.dataDirName).toBe(config.extraMetadata.name)
    expect(config.extraMetadata.version).toBe(beta.version)
    expect(config.extraMetadata.main).toBe('./dist/beta-app/main/index.js')
    expect(config.files).toEqual(['dist/beta-app/**/*', 'package.json'])
    expect(config.extends).toBeNull()
    expect(config.publish).toBeNull()
    expect(config.forceCodeSigning).toBe(true)
    expect(config.mac.hardenedRuntime).toBe(true)
    expect(config.mac.notarize).toBe(true)
    expect(config.mac.target).toEqual([
      { target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] },
    ])
  })
})
