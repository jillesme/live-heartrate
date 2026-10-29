import type { HeartRatePoint } from '#/lib/heart-rate-types'

/** Simple SVG line chart of recent heart rate readings. */
export function Sparkline({ points, dim }: { points: HeartRatePoint[]; dim?: boolean }) {
  const W = 600
  const H = 120
  if (points.length < 2) return <div style={{ height: H }} />

  const bpms = points.map((p) => p.bpm)
  const min = Math.min(...bpms) - 5
  const max = Math.max(...bpms) + 5
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W
  const y = (b: number) => H - ((b - min) / Math.max(1, max - min)) * H
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.bpm).toFixed(1)}`).join(' ')

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`w-full transition-opacity ${dim ? 'opacity-30' : ''}`}
      style={{ height: H }}
    >
      <defs>
        <linearGradient id="hr-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#hr-fill)" />
      <path d={line} fill="none" stroke="#f43f5e" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
