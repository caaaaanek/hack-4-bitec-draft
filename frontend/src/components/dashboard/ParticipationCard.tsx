import { useId } from 'react'
import { Card, SegmentedBar, Tooltip } from '@/components/ui'
import { RESPONDENT_CATEGORIES } from '@/components/ui/messages'
import { K_MIN_GROUP } from '@/lib/scoring/methodology'
import type { Institution } from '@/demo/institutions'

/** «Участь»: відповіли з запрошених за категоріями, лише кількості, без імен. Групи менші за k окремо не показуються. */
export function ParticipationCard({ inst, className }: { inst: Institution; className?: string }) {
  const hid = useId()
  return (
    <Card as="section" aria-labelledby={hid} className={className}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={hid} className="card-title">
          Участь
        </h2>
        <Tooltip content="Мінімальна група k: результати груп, де відповіло менше людей, окремо не показуються. Це захищає анонімність учасників.">
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-fine font-medium text-text-muted">
            k = {K_MIN_GROUP}
          </span>
        </Tooltip>
      </div>
      <ul className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
        {inst.participation.map((p) => {
          const label = RESPONDENT_CATEGORIES[p.id].label
          return (
            <li key={p.id} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-body">
                <span>{label}</span>
                <span className="tabular">
                  <span className="font-semibold">{p.answered}</span>
                  <span className="text-text-muted"> з {p.invited}</span>
                </span>
              </div>
              <SegmentedBar
                value={p.answered}
                max={p.invited}
                segments={20}
                label={`${label}: відповіли ${p.answered} з ${p.invited}`}
              />
              {p.answered < K_MIN_GROUP && (
                <p className="m-0 text-fine text-text-muted">
                  Менше мінімальної групи: окремо не показується.
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
