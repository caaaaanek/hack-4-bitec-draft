import { EyeOff } from 'lucide-react'
import { HIDDEN_GROUP_TEXT } from './messages'

export { HIDDEN_GROUP_TEXT }

export function HiddenGroupState({ parentName }: { parentName?: string }) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted p-4 text-text"
    >
      <EyeOff aria-hidden className="mt-0.5 size-5 shrink-0 text-text-muted" />
      <div className="space-y-1">
        <p className="m-0 text-body">{HIDDEN_GROUP_TEXT}</p>
        {parentName && (
          <p className="m-0 text-caption text-text-muted">
            Показано дані рівня вище: {parentName}.
          </p>
        )}
      </div>
    </div>
  )
}
