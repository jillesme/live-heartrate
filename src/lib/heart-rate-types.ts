export type HeartRateState = {
  bpm: number | null
  updatedAt: number | null
  connected: boolean
  viewers: number
}

export type HeartRatePoint = { t: number; bpm: number }

/** Messages sent from the Durable Object to clients */
export type ServerMessage =
  | { type: 'init'; state: HeartRateState; history: HeartRatePoint[] }
  | { type: 'update'; state: HeartRateState }

/** Messages sent from the broadcaster to the Durable Object */
export type BroadcasterMessage = { type: 'hr'; bpm: number } | { type: 'disconnected' }

export const DO_NAME = 'jilles'
