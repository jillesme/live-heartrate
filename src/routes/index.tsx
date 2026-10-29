import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { Sparkline } from '#/components/sparkline'
import { DO_NAME, type HeartRatePoint, type HeartRateState } from '#/lib/heart-rate-types'
import { timeAgo, useHeartRateSocket, useNow } from '#/lib/use-heart-rate-socket'

const getHeartRate = createServerFn({ method: 'GET' }).handler(async () => {
  const stub = env.HEART_RATE.getByName(DO_NAME)
  const [state, history] = await Promise.all([stub.getState(), stub.getHistory()])
  // Spread into plain objects (RPC results carry a Disposable symbol)
  return { state: { ...state } as HeartRateState, history: history.map((p) => ({ ...p })) as HeartRatePoint[] }
})

export const Route = createFileRoute('/')({
  loader: () => getHeartRate(),
  component: Viewer,
})

function Viewer() {
  const initial = Route.useLoaderData()
  const { state, history, socketOpen } = useHeartRateSocket({
    initialState: initial.state,
    initialHistory: initial.history,
  })
  const now = useNow()
  const live = !!state?.connected && state.bpm !== null
  const beat = live ? 60 / state.bpm! : 0

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-xl">
        <header className="flex items-center justify-between text-sm text-neutral-400 mb-10">
          <h1 className="font-semibold tracking-wide uppercase">Jilles Live Heart Rate</h1>
          <span className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${live ? 'bg-rose-500 animate-pulse' : 'bg-neutral-600'}`} />
            {live ? 'LIVE' : 'OFFLINE'}
          </span>
        </header>

        {live ? (
          <section className="flex flex-col items-center">
            <div
              className="text-rose-500 heartbeat"
              style={{ animationDuration: `${beat}s` }}
              aria-hidden
            >
              <HeartIcon className="size-28" />
            </div>
            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-[9rem] leading-none font-bold tabular-nums">{state.bpm}</span>
              <span className="text-2xl text-neutral-400 font-medium">BPM</span>
            </div>
          </section>
        ) : (
          <section className="flex flex-col items-center text-center">
            <HeartIcon className="size-28 text-neutral-700" />
            <p className="mt-8 text-2xl font-medium text-neutral-300">
              Jilles HR monitor currently not connected
            </p>
            {state?.bpm != null && (
              <p className="mt-2 text-neutral-500">Last reading: {state.bpm} BPM</p>
            )}
          </section>
        )}

        <div className="mt-12">
          <Sparkline points={history} dim={!live} />
        </div>

        <footer className="mt-6 flex justify-between text-sm text-neutral-500 tabular-nums">
          <span>
            {state?.updatedAt ? `Last update ${timeAgo(state.updatedAt, now)}` : 'No readings yet'}
          </span>
          <span>
            {socketOpen ? `${state?.viewers ?? 0} watching` : 'Reconnecting…'}
          </span>
        </footer>
      </div>
      <p className="mt-16 text-xs text-neutral-600">
        Garmin Forerunner 965 → Web Bluetooth → Cloudflare Durable Object → you
      </p>
    </main>
  )
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.3 4.5 7 4.5c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.7 0 5.9 3.8 4.5 7.2C19.5 16.4 12 21 12 21z" />
    </svg>
  )
}
