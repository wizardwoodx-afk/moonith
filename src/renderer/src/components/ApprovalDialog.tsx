import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { useApp } from '../store'
import { cn } from '../lib/utils'
import { Button, Modal } from './ui'

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const

export function ApprovalDialog() {
  const approval = useApp((state) => state.approval)
  const tasks = useApp((state) => state.tasks)
  const respond = useApp((state) => state.respondApproval)
  if (!approval) return null

  const task = tasks.find((item) => item.id === approval.taskId)
  const riskClass =
    approval.risk === 'high'
      ? 'border-danger/30 bg-danger/10 text-danger'
      : approval.risk === 'medium'
        ? 'border-warn/30 bg-warn/10 text-warn'
        : 'border-positive/30 bg-positive/10 text-positive'

  return (
    <Modal
      open
      onClose={() => void respond(false)}
      width="max-w-lg"
      icon={<ShieldCheck size={17} />}
      title="Knight needs your permission"
      subtitle={task ? `For “${task.title}”` : 'To continue this task'}
      className="border-line-strong"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => void respond(false)}>
            Deny
          </Button>
          {approval.allowAlways ? (
            <Button variant="secondary" size="sm" onClick={() => void respond(true, true)}>
              Always allow in this task
            </Button>
          ) : null}
          <Button variant="primary" size="sm" onClick={() => void respond(true)} autoFocus>
            Allow once
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[14px] font-medium">{approval.title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{approval.summary}</p>
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
              riskClass
            )}
          >
            {approval.risk === 'high' ? <AlertTriangle size={10} /> : null}
            {RISK_LABEL[approval.risk]}
          </span>
        </div>

        <div className="rounded-xl border border-line bg-canvas">
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
            <span className="font-mono text-[10.5px] text-faint">{approval.tool}</span>
          </div>
          <pre className="scroll-thin max-h-56 overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink/85">
            {approval.details || approval.summary}
          </pre>
        </div>

        <p className="text-[11.5px] leading-relaxed text-faint">
          Review the details before you allow this action. You can change permission behavior per
          task in the composer.
        </p>
      </div>
    </Modal>
  )
}
