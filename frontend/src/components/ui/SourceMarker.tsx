import { SOURCES } from './config'
import type { SourceId } from './config'

/** Маркер джерела: колір і форма (коло, квадрат, ромб, трикутник). */
export function SourceMarker({ source, size = 14 }: { source: SourceId; size?: number }) {
  const { color, shape } = SOURCES[source]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      {shape === 'circle' && <circle cx="7" cy="7" r="6" fill={color} />}
      {shape === 'square' && <rect x="1.5" y="1.5" width="11" height="11" fill={color} />}
      {shape === 'diamond' && <path d="M7 0.5 13.5 7 7 13.5 0.5 7Z" fill={color} />}
      {shape === 'triangle' && <path d="M7 1 13.5 13H0.5Z" fill={color} />}
    </svg>
  )
}

export function SourceLabel({ source }: { source: SourceId }) {
  return (
    <span className="inline-flex items-center gap-2 text-caption">
      <SourceMarker source={source} />
      {SOURCES[source].label}
    </span>
  )
}
