import type { Clipboard } from 'electron'

// Best effort for the current clipboard only. History, cloud copies and Linux
// PRIMARY are outside this operation. Reading and clearing are not atomic, so
// clear synchronously as soon as the asynchronous read confirms a match.
export async function clearImportedKeyClipboard(clipboard: Pick<Clipboard, 'readText' | 'clear'>, wif: string): Promise<void> {
  const key = wif.trim()
  if (key === '') return
  try {
    if ((await clipboard.readText()).trim() === key) clipboard.clear()
  } catch { /* Clipboard availability must not turn a successful import into an error. */ }
}
