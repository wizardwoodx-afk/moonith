import { useEffect, useState } from 'react'
import { Modal, Button } from './ui'

interface ConfirmRequest {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type Resolver = (confirmed: boolean) => void

let pending: ((options: ConfirmRequest, resolve: Resolver) => void) | null = null

/**
 * Ask the user to confirm something destructive.
 *
 * `window.confirm()` is not implemented in Electron's renderer — it resolves to
 * `undefined` rather than blocking for an answer. Every call site that guarded a
 * delete with `if (window.confirm(…))` therefore took the false branch silently
 * and the action never ran, with nothing logged. This is the in-app equivalent:
 * same promise-returning shape, but it actually renders.
 */
export function confirmDialog(options: ConfirmRequest): Promise<boolean> {
  if (!pending) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => pending?.(options, resolve))
}

export function ConfirmHost(): React.JSX.Element | null {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [resolve, setResolve] = useState<Resolver | null>(null)

  useEffect(() => {
    pending = (options, done) => {
      setRequest(options)
      setResolve(() => done)
    }
    return () => {
      pending = null
    }
  }, [])

  const settle = (confirmed: boolean): void => {
    resolve?.(confirmed)
    setRequest(null)
    setResolve(null)
  }

  if (!request) return null

  return (
    <Modal
      open
      onClose={() => settle(false)}
      width="max-w-sm"
      title={request.title}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => settle(false)}>
            {request.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            autoFocus
            variant={request.danger ? 'primary' : 'primary'}
            size="sm"
            className={request.danger ? 'bg-danger hover:brightness-110' : undefined}
            onClick={() => settle(true)}
          >
            {request.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {request.body ? (
        <p className="text-[12.5px] leading-relaxed text-muted">{request.body}</p>
      ) : null}
    </Modal>
  )
}
