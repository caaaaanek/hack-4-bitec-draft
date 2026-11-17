import { useState } from 'react'
import { PageTitle } from '@/components/layout/PageTitle'
import { fmt } from '@/lib/scoring/methodology'
import { COMPONENT_IDS } from '@/lib/scoring/methodology'
import { canAccess } from '@/lib/access'
import { measureSummary } from '@/lib/measures'
import { allMeasures } from '@/lib/decisions'
import { DEMO_MEASURES, TODAY } from '@/demo/measures'
import { useDecisions } from '@/demo/decisionsStore'
import { useDemoOptional } from '@/demo/demoContext'
import { useInstitution } from '@/demo/useInstitution'
import { DynamicsPanel } from '@/components/dashboard/DynamicsChart'
import { IndexCard } from '@/components/dashboard/IndexCard'
import { ParticipationCard } from '@/components/dashboard/ParticipationCard'
import { ComponentCard } from '@/components/dashboard/ComponentCard'
import { FocusCard } from '@/components/dashboard/FocusCard'
import { WhyPanel, type WhySection } from '@/components/dashboard/WhyPanel'

/** Огляд закладу: композиція за еталоном (індекс і участь, три компоненти, динаміка й фокус). */
export function Home() {
  const inst = useInstitution()
  const { role } = useDemoOptional()
  const decisions = useDecisions()
  const [why, setWhy] = useState<{ open: boolean; section: WhySection }>({
    open: false,
    section: 'top',
  })
  const openWhy = (section: WhySection = 'top') => setWhy({ open: true, section })

  const { components, series } = inst
  const prev = series[series.length - 2]!
  const measures = canAccess(role, '/tracker')
    ? measureSummary(allMeasures(DEMO_MEASURES, decisions), TODAY)
    : null

  return (
    <div data-ready="true" className="grid gap-5 xl:grid-cols-3">
      <PageTitle>Огляд закладу</PageTitle>

      <IndexCard inst={inst} onWhy={openWhy} className="xl:col-span-2" />
      <ParticipationCard inst={inst} />

      {COMPONENT_IDS.map((id) => {
        const c = components.find((x) => x.id === id)!
        return (
          <ComponentCard
            key={id}
            id={id}
            value={c.credited.value}
            previous={prev.components[id]}
            delta={Math.round((c.credited.value - prev.components[id]) * 10) / 10}
            limitedHint={
              c.credited.limited
                ? `Сприйняття ${fmt(c.perception)}, факти ${fmt(c.facts)}, зараховано ${fmt(c.credited.value)}`
                : undefined
            }
          />
        )
      })}

      <DynamicsPanel
        series={series}
        events={inst.events}
        moreHref="/trends"
        chartClassName="h-[220px] xl:h-[220px]"
        className="xl:col-span-2"
      />
      <FocusCard
        attention={inst.attention}
        strengths={inst.strengths}
        measures={measures}
        links={{
          recommendations: canAccess(role, '/recommendations'),
          report: canAccess(role, '/reports'),
          tracker: canAccess(role, '/tracker'),
        }}
      />

      <WhyPanel
        open={why.open}
        section={why.section}
        onClose={() => setWhy((w) => ({ ...w, open: false }))}
        inst={inst}
      />
    </div>
  )
}
