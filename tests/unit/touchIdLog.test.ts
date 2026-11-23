import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ProbeLogFile } from '../../src/main/touchId/log'

const dirs: string[] = []
function path(): string {
  const base = resolve('test-results/unit')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'probe-log-'))
  dirs.push(root)
  return join(root, 'touch-id-test.log')
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

it('persists diagnostic events across launches and bounds the previous log', () => {
  const file = path()
  new ProbeLogFile(file).write('start', { format: 1 })
  const log = new ProbeLogFile(file)
  log.write('native-cancel', { request: 2 })
  const events = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  expect(events).toMatchObject([{ time: expect.any(String), event: 'start', format: 1 }, { event: 'native-cancel', request: 2 }])
  if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  writeFileSync(file, 'x'.repeat(128 * 1024))
  log.write('start', { format: 1 })
  expect(log.available).toBe(true)
  expect(statSync(file + '.previous').size).toBe(128 * 1024)
  expect(JSON.parse(readFileSync(file, 'utf8')).event).toBe('start')
})

it('reports unavailable diagnostics without throwing into authentication', () => {
  const log = new ProbeLogFile(join(path(), 'missing', 'log'))
  expect(() => log.write('start')).not.toThrow()
  expect(log.available).toBe(false)
})
