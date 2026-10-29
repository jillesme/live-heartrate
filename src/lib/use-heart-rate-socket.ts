import { useEffect, useRef, useState } from 'react'
import type { HeartRatePoint, HeartRateState, ServerMessage } from './heart-rate-types'

const HISTORY_LIMIT = 300

/**
 * Connects to the Durable Object WebSocket with auto-reconnect + keepalive.
 * Pass `query` (e.g. role/token) for broadcasters; returns a `send` function.
 */
export function useHeartRateSocket(opts: {
  initialState?: HeartRateState
  initialHistory?: HeartRatePoint[]
  query?: Record<string, string>
  enabled?: boolean
}) {
  const { enabled = true } = opts
  const [state, setState] = useState<HeartRateState | undefined>(opts.initialState)
  const [history, setHistory] = useState<HeartRatePoint[]>(opts.initialHistory ?? [])
  const [socketOpen, setSocketOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const lastUpdatedRef = useRef(opts.initialState?.updatedAt ?? null)
  const queryKey = JSON.stringify(opts.query ?? {})

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let retry = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      const url = new URL('/ws', location.href)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      for (const [k, v] of Object.entries(JSON.parse(queryKey) as Record<string, string>)) {
        url.searchParams.set(k, v)
      }
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        retry = 0
        setSocketOpen(true)
        setError(null)
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 30_000)
      }
      ws.onmessage = (e) => {
        if (e.data === 'pong') return
        const msg = JSON.parse(e.data) as ServerMessage
        const s = msg.state
        if (msg.type === 'init') {
          setHistory(msg.history)
        } else if (s.bpm !== null && s.updatedAt !== null && s.updatedAt !== lastUpdatedRef.current) {
          const point = { t: s.updatedAt, bpm: s.bpm }
          setHistory((h) => [...h, point].slice(-HISTORY_LIMIT))
        }
        lastUpdatedRef.current = s.updatedAt
        setState(s)
      }
      ws.onclose = (e) => {
        clearInterval(pingTimer)
        setSocketOpen(false)
        if (wsRef.current === ws) wsRef.current = null
        if (stopped) return
        if (e.code === 4000) {
          setError('Another broadcaster took over')
          return
        }
        // Handshake rejections (e.g. 401) surface as 1006 with no detail
        if (e.code === 1006 && retry >= 2) setError('Connection failed (check token?)')
        const delay = Math.min(1000 * 2 ** retry++, 15_000)
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(reconnectTimer)
      clearInterval(pingTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled, queryKey])

  const send = (data: unknown) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
  }

  return { state, history, socketOpen, error, send }
}

/** Re-renders every `ms` so relative timestamps stay fresh. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export function timeAgo(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleString()
}
