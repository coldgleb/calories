import { useEffect, useRef, useState } from 'preact/hooks'
import { fmt1 } from '../ui'

export interface WeightPoint {
  date: string
  weightKg: number
}

const HEIGHT = 200
const M = { top: 12, right: 14, bottom: 24, left: 38 }

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

/** Round tick step (0.5, 1, 2, 5, 10 kg) giving about four gridlines. */
export function niceTicks(min: number, max: number): number[] {
  if (max - min < 0.5) {
    min -= 0.5
    max += 0.5
  }
  const span = max - min
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => span / s <= 4) ?? 50
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks = []
  for (let v = start; v <= end + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10)
  return ticks
}

/** Single-series weight line. Points are sorted by date. */
export function WeightChart(props: { points: WeightPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [active, setActive] = useState<number>()

  useEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pts = props.points
  const values = pts.map((p) => p.weightKg)
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const times = pts.map((p) => parseISO(p.date).getTime())
  const tMin = times[0]
  const tMax = times[times.length - 1]

  const innerW = width - M.left - M.right
  const innerH = HEIGHT - M.top - M.bottom
  const x = (t: number) => M.left + (tMax === tMin ? innerW / 2 : ((t - tMin) / (tMax - tMin)) * innerW)
  const y = (v: number) => M.top + (yMax === yMin ? innerH / 2 : (1 - (v - yMin) / (yMax - yMin)) * innerH)

  const xs = times.map(x)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p.weightKg).toFixed(1)}`).join('')
  const showDots = pts.length <= 40

  // Date labels: first, last and one in between when there is room.
  const labelIdx = pts.length === 1 ? [0] : width > 360 && pts.length > 2 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : [0, pts.length - 1]

  function onPointer(e: PointerEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    let best = 0
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i
    setActive(best)
  }

  const a = active !== undefined ? pts[active] : undefined
  const ax = active !== undefined ? xs[active] : 0
  const ay = a ? y(a.weightKg) : 0

  return (
    <div class="chart" ref={wrapRef}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`График веса: от ${fmt1(values[0])} до ${fmt1(values[values.length - 1])} кг`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(undefined)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line class="chart-grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text class="chart-label" x={M.left - 6} y={y(t)} text-anchor="end" dominant-baseline="middle">
              {fmt1(t)}
            </text>
          </g>
        ))}
        {labelIdx.map((i, k) => (
          <text
            key={i}
            class="chart-label"
            x={xs[i]}
            y={HEIGHT - 6}
            text-anchor={labelIdx.length === 1 ? 'middle' : k === 0 ? 'start' : k === labelIdx.length - 1 ? 'end' : 'middle'}
          >
            {shortDate(pts[i].date)}
          </text>
        ))}
        {a && <line class="chart-crosshair" x1={ax} x2={ax} y1={M.top} y2={HEIGHT - M.bottom} />}
        <path class="chart-line" d={path} />
        {showDots &&
          pts.map((p, i) => <circle key={p.date} class="chart-dot" cx={xs[i]} cy={y(p.weightKg)} r={4} />)}
        {a && <circle class="chart-dot active" cx={ax} cy={ay} r={5} />}
        {/* Hit area larger than the marks */}
        <rect x={M.left - 10} y={0} width={innerW + 20} height={HEIGHT} fill="transparent" />
      </svg>
      {a && (
        <div
          class="chart-tip"
          style={{
            left: `${Math.min(Math.max(ax, 56), width - 56)}px`,
            top: `${Math.max(ay - 12, 0)}px`,
          }}
        >
          <strong>{fmt1(a.weightKg)} кг</strong>
          <span>{shortDate(a.date)}</span>
        </div>
      )}
    </div>
  )
}
