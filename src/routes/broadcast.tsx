import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { BroadcasterMessage } from '#/lib/heart-rate-types'
import { useHeartRateSocket } from '#/lib/use-heart-rate-socket'

export const Route = createFileRoute('/broadcast')({
  head: () => ({ meta: [{ title: 'Broadcast · Jilles Live Heart Rate' }, { name: 'robots', content: 'noindex' }] }),
  component: Broadcast,
})

// Minimal Web Bluetooth types (Chrome/Edge only)
type GattCharacteristic = EventTarget & { value?: DataView; startNotifications(): Promise<unknown> }
type GattServer = {
  connected: boolean
  connect(): Promise<GattServer>
  disconnect(): void
  getPrimaryService(s: string): Promise<{ getCharacteristic(c: string): Promise<GattCharacteristic> }>
}
type BluetoothDevice = EventTarget & { name?: string; gatt?: GattServer }
type Bluetooth = { requestDevice(o: { filters: { services: string[] }[] }): Promise<BluetoothDevice> }

const TOKEN_KEY = 'hr-broadcast-token'

/** Parse a Heart Rate Measurement (0x2A37) value. */
function parseHeartRate(value: DataView) {
  const flags = value.getUint8(0)
  return flags & 0x1 ? value.getUint16(1, true) : value.getUint8(1)
}

async function checkToken(token: string) {
  const res = await fetch(`/ws?role=broadcaster&token=${encodeURIComponent(token)}`)
  return res.ok
}

type BtStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting'

function Broadcast() {
  const [token, setToken] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [bt, setBt] = useState<BtStatus>('idle')
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [bpm, setBpm] = useState<number | null>(null)
  const [btError, setBtError] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)
  const deviceRef = useRef<BluetoothDevice | null>(null)
  const stoppedRef = useRef(true)
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null)

  useEffect(() => {
    // Checked after mount to avoid an SSR hydration mismatch
    setSupported('bluetooth' in navigator)
    const saved = localStorage.getItem(TOKEN_KEY)
    if (saved) {
      checkToken(saved).then((ok) => {
        if (ok) setToken(saved)
        else {
          localStorage.removeItem(TOKEN_KEY)
          setTokenError('Saved token is no longer valid')
        }
      })
    }
  }, [])

  const { state, socketOpen, error: socketError, send: rawSend } = useHeartRateSocket({
    query: { role: 'broadcaster', token },
    enabled: !!token,
  })
  const sendRef = useRef(rawSend)
  sendRef.current = rawSend
  const send = (msg: BroadcasterMessage) => sendRef.current(msg)

  const subscribe = async (device: BluetoothDevice) => {
    const server = await device.gatt!.connect()
    const service = await server.getPrimaryService('heart_rate')
    const char = await service.getCharacteristic('heart_rate_measurement')
    char.addEventListener('characteristicvaluechanged', () => {
      if (!char.value) return
      const value = parseHeartRate(char.value)
      setBpm(value)
      send({ type: 'hr', bpm: value })
    })
    await char.startNotifications()
    setBt('connected')
    setBtError(null)
  }

  const onDisconnected = async () => {
    send({ type: 'disconnected' })
    setBpm(null)
    const device = deviceRef.current
    if (stoppedRef.current || !device) return setBt('idle')
    // Watch dropped (out of range, broadcast paused, …) — keep trying
    setBt('reconnecting')
    while (!stoppedRef.current && !device.gatt?.connected) {
      try {
        await subscribe(device)
        return
      } catch {
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }

  const connectWatch = async () => {
    setBtError(null)
    try {
      const device = await (navigator as unknown as { bluetooth: Bluetooth }).bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
      })
      deviceRef.current = device
      stoppedRef.current = false
      setDeviceName(device.name ?? 'Unknown device')
      setBt('connecting')
      device.addEventListener('gattserverdisconnected', onDisconnected)
      await subscribe(device)
      wakeLockRef.current = await navigator.wakeLock?.request('screen').catch(() => null)
    } catch (e) {
      setBt('idle')
      if ((e as Error).name !== 'NotFoundError') setBtError((e as Error).message)
    }
  }

  const disconnectWatch = () => {
    stoppedRef.current = true
    deviceRef.current?.gatt?.disconnect()
    deviceRef.current?.removeEventListener('gattserverdisconnected', onDisconnected)
    deviceRef.current = null
    send({ type: 'disconnected' })
    setBt('idle')
    setBpm(null)
    wakeLockRef.current?.release()
    wakeLockRef.current = null
  }

  const saveToken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!(await checkToken(tokenInput))) {
      setTokenError('Wrong token — it must match BROADCAST_TOKEN (.dev.vars locally, wrangler secret in prod)')
      return
    }
    setTokenError(null)
    localStorage.setItem(TOKEN_KEY, tokenInput)
    setToken(tokenInput)
  }

  const forgetToken = () => {
    disconnectWatch()
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setTokenInput('')
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-xl font-semibold">Broadcast heart rate</h1>

        {!supported && (
          <p className="rounded-lg bg-amber-500/10 text-amber-300 p-4 text-sm">
            Web Bluetooth isn't available in this browser. Use Chrome or Edge on macOS.
          </p>
        )}

        {!token ? (
          <form onSubmit={saveToken} className="space-y-3">
            <label className="block text-sm text-neutral-400">Broadcast token</label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 outline-none focus:border-rose-500"
              autoFocus
              // Password-manager extensions (e.g. Keeper) inject attributes before hydration
              suppressHydrationWarning
            />
            <button className="w-full rounded-lg bg-neutral-100 text-neutral-900 py-2 font-medium">Save</button>
            {tokenError && <p className="text-sm text-rose-400">{tokenError}</p>}
          </form>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Durable Object" value={socketOpen ? 'Connected' : socketError ?? 'Connecting…'} ok={socketOpen} />
              <Stat label="Watch" value={bt === 'connected' ? deviceName! : bt} ok={bt === 'connected'} />
              <Stat label="Current BPM" value={bpm?.toString() ?? '—'} ok={bpm !== null} />
              <Stat label="Viewers" value={String(state?.viewers ?? 0)} ok />
            </dl>

            {bt === 'idle' ? (
              <button
                onClick={connectWatch}
                disabled={!supported}
                className="w-full rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-40 py-3 font-semibold"
              >
                Connect watch
              </button>
            ) : (
              <button onClick={disconnectWatch} className="w-full rounded-lg bg-neutral-800 hover:bg-neutral-700 py-3 font-semibold">
                Disconnect watch
              </button>
            )}
            {btError && <p className="text-sm text-rose-400">{btError}</p>}

            <button onClick={forgetToken} className="text-xs text-neutral-500 hover:text-neutral-300">
              Forget token
            </button>
          </>
        )}

        <details className="text-sm text-neutral-400">
          <summary className="cursor-pointer">Device setup (Garmin, Whoop, chest straps)</summary>
          <ol className="mt-2 list-decimal pl-5 space-y-1">
            <li>Garmin Forerunner 965: hold UP (menu) → Health &amp; Wellness → Wrist Heart Rate → Broadcast Heart Rate → press START. Or hold LIGHT and pick the Broadcast Heart Rate control.</li>
            <li>Whoop: in the Whoop app, go to Device Settings → Heart Rate Broadcast and turn it on.</li>
            <li>No macOS pairing needed: click "Connect watch" and pick your device in Chrome's chooser.</li>
            <li>If it doesn't show up, allow Chrome under System Settings → Privacy &amp; Security → Bluetooth.</li>
            <li>Keep this tab open; the screen is kept awake while connected.</li>
          </ol>
        </details>
      </div>
    </main>
  )
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={`mt-1 font-medium capitalize ${ok ? 'text-neutral-100' : 'text-neutral-400'}`}>{value}</dd>
    </div>
  )
}
