import { DurableObject } from 'cloudflare:workers'
import type {
  BroadcasterMessage,
  HeartRatePoint,
  HeartRateState,
  ServerMessage,
} from '#/lib/heart-rate-types'

/** Mark the monitor as disconnected if no reading arrives within this window. */
const STALE_AFTER_MS = 10_000
/** ~5 minutes of history at the typical 1 reading/sec. */
const HISTORY_LIMIT = 300

type Role = 'broadcaster' | 'viewer'

/**
 * One instance ("jilles") holds the live heart rate.
 * - The broadcaster (Mac + Web Bluetooth) pushes readings over a WebSocket.
 * - Viewers connect over hibernatable WebSockets and receive every update.
 */
export class HeartRate extends DurableObject<Env> {
  private bpm: number | null
  private updatedAt: number | null
  private connected: boolean
  private history: HeartRatePoint[]

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const kv = ctx.storage.kv
    this.bpm = kv.get<number>('bpm') ?? null
    this.updatedAt = kv.get<number>('updatedAt') ?? null
    this.connected = kv.get<boolean>('connected') ?? false
    this.history = kv.get<HeartRatePoint[]>('history') ?? []
    // Answer keepalive pings without waking the object from hibernation
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  /** RPC used for server-side rendering of the initial view. */
  getState(): HeartRateState {
    return {
      bpm: this.bpm,
      updatedAt: this.updatedAt,
      connected: this.isLive(),
      viewers: this.viewerSockets().length,
    }
  }

  getHistory(): HeartRatePoint[] {
    return this.history
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    // The Worker authenticates broadcasters and sets this header
    const role: Role = request.headers.get('X-HR-Role') === 'broadcaster' ? 'broadcaster' : 'viewer'

    const { 0: client, 1: server } = new WebSocketPair()

    if (role === 'broadcaster') {
      // Only one broadcaster at a time — newest wins
      for (const ws of this.ctx.getWebSockets('broadcaster')) {
        ws.close(4000, 'Replaced by a new broadcaster')
      }
    }

    this.ctx.acceptWebSocket(server, [role])

    if (role === 'viewer') {
      const init: ServerMessage = { type: 'init', state: this.getState(), history: this.history }
      server.send(JSON.stringify(init))
      this.broadcast() // viewer count changed
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (!this.ctx.getTags(ws).includes('broadcaster') || typeof message !== 'string') return

    let msg: BroadcasterMessage
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }

    if (msg.type === 'hr') {
      const bpm = Math.round(Number(msg.bpm))
      if (!Number.isFinite(bpm) || bpm < 20 || bpm > 250) return
      const now = Date.now()
      this.bpm = bpm
      this.updatedAt = now
      this.connected = true
      this.history.push({ t: now, bpm })
      if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT)
      this.persist()
      await this.ctx.storage.setAlarm(now + STALE_AFTER_MS)
      this.broadcast()
    } else if (msg.type === 'disconnected') {
      this.markDisconnected()
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason)
    } catch {
      // already closed
    }
    if (this.ctx.getTags(ws).includes('broadcaster')) {
      const others = this.ctx.getWebSockets('broadcaster').filter((s) => s !== ws)
      if (others.length === 0) this.markDisconnected()
    } else {
      this.broadcast(ws) // viewer count changed
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011, 'error')
  }

  /** Fires when no reading arrived for STALE_AFTER_MS. */
  async alarm() {
    if (this.connected && !this.isLive()) this.markDisconnected()
  }

  private isLive() {
    return this.connected && this.updatedAt !== null && Date.now() - this.updatedAt < STALE_AFTER_MS
  }

  private markDisconnected() {
    if (!this.connected) return
    this.connected = false
    this.persist()
    this.broadcast()
  }

  private persist() {
    const kv = this.ctx.storage.kv
    kv.put('bpm', this.bpm)
    kv.put('updatedAt', this.updatedAt)
    kv.put('connected', this.connected)
    kv.put('history', this.history)
  }

  private viewerSockets(exclude?: WebSocket) {
    return this.ctx
      .getWebSockets('viewer')
      .filter((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN)
  }

  private broadcast(exclude?: WebSocket) {
    const viewers = this.viewerSockets(exclude)
    const msg: ServerMessage = {
      type: 'update',
      state: { ...this.getState(), viewers: viewers.length },
    }
    const payload = JSON.stringify(msg)
    // The broadcaster also gets updates so it can show the viewer count
    for (const ws of [...viewers, ...this.ctx.getWebSockets('broadcaster')]) {
      try {
        ws.send(payload)
      } catch {
        // socket went away; webSocketClose will clean up
      }
    }
  }
}
