import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { keychainIdentity, verifyTouchIdFuses } from '../../build/touch-id-probe.mjs'

let directory: string | undefined
it('requires a separate access group for the wallet sharing the probe bundle ID', () => {
  const appId = 'org.example.fixture'
  const identifier = 'EXAMPLE.' + appId
  const rights = { 'com.apple.application-identifier': identifier, 'keychain-access-groups': [identifier] }
  expect(keychainIdentity(rights, 'EXAMPLE', appId, false).group).toBe(identifier)
  expect(() => keychainIdentity(rights, 'EXAMPLE', appId, true)).toThrow('vault-unlock')
  expect(keychainIdentity({ ...rights, 'keychain-access-groups': ['EXAMPLE.*'] }, 'EXAMPLE', appId, true).group)
    .toBe(identifier + '.vault-unlock')
})

afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })

it('checks the actual fuse wire and rejects an unhardened framework', async () => {
  const parent = resolve('test-results/unit')
  mkdirSync(parent, { recursive: true })
  directory = mkdtempSync(join(parent, 'touch-id-fuses-'))
  const binary = join(directory, 'electron')
  const header = Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 8])])
  writeFileSync(binary, Buffer.concat([header, Buffer.from('00001101')]))
  await expect(verifyTouchIdFuses(binary)).resolves.toBeUndefined()
  const current = readFileSync(binary)
  current[header.length] = 0x31
  writeFileSync(binary, current)
  await expect(verifyTouchIdFuses(binary)).rejects.toThrow('RunAsNode')
})
