// Names survive the existing IPC error envelope and are safe to branch on.
export class SendNeedsReviewError extends Error {
  override readonly name = 'SendNeedsReviewError'
}
export class SendUncertainError extends Error {
  override readonly name = 'SendUncertainError'
}
export function sendRecovery(error: unknown): 'review' | 'retry' {
  return error instanceof Error && error.name === 'SendNeedsReviewError' ? 'review' : 'retry'
}
