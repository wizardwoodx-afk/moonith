import { agentName } from '../lib/localProfile'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { useApp } from '../store'
import { cn } from '../lib/utils'
import { Button, Modal } from './ui'
import { Markdown } from './Markdown'

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const

export function ApprovalDialog() {
  const approval = useApp((state) => state.approval)
  const tasks = useApp((state) => state.tasks)
  const respond = useApp((state) => state.respondApproval)
  if (!approval) return null

  const task = tasks.find((item) => item.id === approval.taskId)
  const pageReview = approval.review?.kind === 'library-page' ? approval.review : null
  const diffReview = approval.review?.kind === 'diff' ? approval.review : null
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
      width={pageReview || diffReview ? 'max-w-3xl' : 'max-w-lg'}
      icon={<ShieldCheck size={17} />}
      title={pageReview ? 'Review page draft' : diffReview ? 'Review the change' : 'SelfImpulse needs your permission'}
      subtitle={
        pageReview
          ? `${pageReview.destination} · ${task ? `${agentName()} in “${task.title}”` : agentName()}`
          : task
            ? `For “${task.title}”`
            : 'To continue this task'
      }
      className="border-line-strong"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => void respond(false)}>
            {pageReview ? 'Decline' : 'Deny'}
          </Button>
          {approval.allowAlways ? (
            <Button variant="secondary" size="sm" onClick={() => void respond(true, true)}>
              Always allow in this task
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void respond(true)}
            autoFocus={!pageReview && !diffReview}
          >
            {pageReview ? 'Approve & save' : 'Allow once'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[14px] font-medium">{pageReview?.title ?? approval.title}</p>
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

        {pageReview ? (
          <div className="overflow-hidden rounded-xl border border-line bg-canvas">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <span className="text-[10.5px] font-medium text-faint">Markdown preview</span>
              <span className="text-[10px] text-faint">Exact draft · no always-allow</span>
            </div>
            <div className="scroll-thin max-h-[48vh] overflow-y-auto px-5 py-4">
              <Markdown content={pageReview.content} />
            </div>
          </div>
        ) : diffReview ? (
          <div className="overflow-hidden rounded-xl border border-line bg-canvas">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <span className="truncate font-mono text-[10.5px] text-faint">{diffReview.path}</span>
              <span className="shrink-0 font-mono text-[10.5px]">
                <span className="text-positive">+{diffReview.added}</span>
                {'  '}
                <span className="text-danger">-{diffReview.removed}</span>
              </span>
            </div>
            {diffReview.note ? (
              <p className="border-b border-line px-4 py-2 text-[11.5px] leading-relaxed text-warn">
                {diffReview.note}
              </p>
            ) : null}
            {diffReview.lines.length ? (
              <div className="scroll-thin max-h-[46vh] overflow-auto py-1">
                {diffReview.lines.map((line, index) => (
                  <p
                    key={`${line.sign}-${index}`}
                    className={
                      line.sign === '+'
                        ? 'bg-positive/10 px-4 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words text-ink'
                        : line.sign === '-'
                          ? 'bg-danger/10 px-4 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words text-muted'
                          : 'px-4 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words text-ink/70'
                    }
                  >
                    <span className="mr-2 inline-block w-2 select-none text-faint">{line.sign}</span>
                    {line.text || ' '}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-canvas">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
              <span className="font-mono text-[10.5px] text-faint">{approval.tool}</span>
            </div>
            <pre className="scroll-thin max-h-56 overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink/85">
              {approval.details || approval.summary}
            </pre>
          </div>
        )}

        <p className="text-[11.5px] leading-relaxed text-faint">
          {pageReview
            ? 'Only this exact draft is approved. Saving checks the page revision again; a changed draft or conflicting revision requires a new review.'
            : diffReview
              ? 'This is the exact change. Deny it and nothing on disk is touched; approve it and the file is written as shown.'
              : 'Review the details before you allow this action. You can change permission behavior per task in the composer.'}
        </p>
      </div>
    </Modal>
  )
}
