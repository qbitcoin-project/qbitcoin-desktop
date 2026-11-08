import { describe, expect, it, vi } from 'vitest'
import { clearImportedKeyClipboard } from '../../src/main/privacy/clipboard'

describe('imported key clipboard cleanup', () => {
  it('clears only the still-matching current clipboard', async () => {
    const clipboard = { readText: vi.fn().mockResolvedValue(' public-test-key\n'), clear: vi.fn() }
    await clearImportedKeyClipboard(clipboard, 'public-test-key')
    expect(clipboard.clear).toHaveBeenCalledOnce()
    clipboard.clear.mockClear()
    clipboard.readText.mockResolvedValue('new-public-copy')
    await clearImportedKeyClipboard(clipboard, 'public-test-key')
    expect(clipboard.clear).not.toHaveBeenCalled()
  })

  it('waits for the read and preserves a different copy returned while waiting', async () => {
    let finishRead!: (value: string) => void
    const clipboard = {
      readText: vi.fn(() => new Promise<string>((resolve) => { finishRead = resolve })),
      clear: vi.fn(),
    }
    const cleanup = clearImportedKeyClipboard(clipboard, 'public-test-key')
    expect(clipboard.clear).not.toHaveBeenCalled()
    finishRead('new-public-copy')
    await cleanup
    expect(clipboard.clear).not.toHaveBeenCalled()
  })

  it('does not access the clipboard for an empty key', async () => {
    const clipboard = { readText: vi.fn(), clear: vi.fn() }
    await clearImportedKeyClipboard(clipboard, ' \n')
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(clipboard.clear).not.toHaveBeenCalled()
  })

  it('a rejected read does not fail the import', async () => {
    const clipboard = { readText: vi.fn().mockRejectedValue(new Error('Unavailable')), clear: vi.fn() }
    await expect(clearImportedKeyClipboard(clipboard, 'key')).resolves.toBeUndefined()
    expect(clipboard.clear).not.toHaveBeenCalled()
  })

  it('a synchronous clipboard failure does not fail the import', async () => {
    const clipboard = { readText: () => { throw new Error('Unavailable') }, clear: vi.fn() }
    await expect(clearImportedKeyClipboard(clipboard, 'key')).resolves.toBeUndefined()
    expect(clipboard.clear).not.toHaveBeenCalled()
  })

  it('a clear failure does not fail the import', async () => {
    const clipboard = {
      readText: vi.fn().mockResolvedValue('key'),
      clear: vi.fn(() => { throw new Error('Unavailable') }),
    }
    await expect(clearImportedKeyClipboard(clipboard, 'key')).resolves.toBeUndefined()
  })
})
