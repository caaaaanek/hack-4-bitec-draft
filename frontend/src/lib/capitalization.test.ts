import { describe, expect, it } from 'vitest'
import * as messages from '@/components/ui/messages'
import * as data from '@/demo/data'
import * as me from '@/demo/me'
import * as survey from '@/demo/survey'
import * as units from '@/demo/units'

/** Ключі, значення яких не є видимим текстом (ідентифікатори, літери, коди). */
const TECHNICAL_KEYS = new Set([
  'id',
  'letter',
  'source',
  'component',
  'kind',
  'cycle',
  'token',
  'to',
  'href',
  'icon',
  'weight',
  'parentId',
  'short',
  'unitId',
  'status',
  'priority',
  // Продовження речення після «N питання»: окремо не показується.
  'about',
])

const firstLetter = (s: string): string | undefined => s.match(/\p{L}/u)?.[0]

function collect(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === 'string') {
    out.push([path, value])
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collect(v, `${path}[${i}]`, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (TECHNICAL_KEYS.has(k)) continue
      collect(v, `${path}.${k}`, out)
    }
  }
}

describe('Регістр видимих рядків', () => {
  const modules: Record<string, object> = { messages, data, me, survey, units }
  const strings: [string, string][] = []
  for (const [name, mod] of Object.entries(modules)) {
    for (const [k, v] of Object.entries(mod)) {
      if (typeof v === 'function' || k.endsWith('_ID')) continue
      collect(v, `${name}.${k}`, strings)
    }
  }

  it('збирає достатньо рядків', () => {
    expect(strings.length).toBeGreaterThan(80)
  })

  it('кожен видимий рядок починається з великої літери', () => {
    const bad = strings
      .filter(([, s]) => /\p{L}/u.test(s))
      .filter(([, s]) => {
        const l = firstLetter(s)!
        return l !== l.toUpperCase()
      })
    expect(bad.map(([p, s]) => `${p}: ${s}`)).toEqual([])
  })
})
