export const PROBE_COMMAND = 'touch-id-probe:command'
export const PROBE_STATE = 'touch-id-probe:state'

export type Availability = 'available' | 'notEnrolled' | 'lockout' | 'unavailable'
export interface ProbeState {
  revision: number
  availability: Availability
  binding: 'absent' | 'creating' | 'active' | 'removing'
  deferred: boolean
  unlocked: boolean
  passwordScreen: boolean
  busy: boolean
  draft: { id: number; amount: string; recipient: string } | null
  approvals: number
  message: string
}

export type Command =
  | 'status' | 'later' | 'enroll' | 'reset' | 'unlock' | 'lock' | 'cancel'
  | 'password' | 'back' | 'silent' | 'prepare'
  | { action: 'approve' | 'replaceDuringApproval'; draftId: number }

export interface ProbeBridge {
  run(command: Command | 'showLog'): Promise<ProbeState>
  subscribe(listener: (state: ProbeState) => void): () => void
}
