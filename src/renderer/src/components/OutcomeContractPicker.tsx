import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type {
  OutcomeContract,
  OutcomeTaskBindingInput
} from '@shared/verifiedOutcomes'
import { OUTCOME_DATA_CLASSES, OUTCOME_ENVIRONMENTS } from '@shared/verifiedOutcomes'
import { cn, errorMessage } from '../lib/utils'

const selectClass =
  'h-8 min-w-0 rounded-md border border-line bg-canvas px-2 text-[10.5px] text-muted outline-none transition-colors focus:border-accent/45 disabled:opacity-50'

export function OutcomeContractPicker({
  value,
  onChange,
  disabled = false,
  className
}: {
  value: OutcomeTaskBindingInput | null
  onChange: (value: OutcomeTaskBindingInput | null) => void
  disabled?: boolean
  className?: string
}) {
  const [contracts, setContracts] = useState<OutcomeContract[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.knight.verifiedOutcomes.snapshot()
      .then((snapshot) => {
        if (!active) return
        setContracts(snapshot.contracts.filter(
          (contract) => contract.lifecycle === 'active' && contract.versions.some((version) => version.status === 'active')
        ))
      })
      .catch((cause) => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [])

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="inline-flex h-8 items-center gap-1.5 text-[10.5px] text-faint" title="Verified Outcomes contract">
        <ShieldCheck size={12} className="text-accent" />
        Outcome
      </span>
      <select
        aria-label="Outcome contract"
        disabled={disabled}
        value={value?.contractId ?? ''}
        onChange={(event) => {
          const contractId = event.target.value
          if (!contractId) onChange(null)
          else onChange({
            contractId,
            dataClass: value?.dataClass ?? 'internal',
            environment: value?.environment ?? 'development'
          })
        }}
        className={cn(selectClass, 'max-w-[220px] flex-1')}
      >
        <option value="">No contract</option>
        {contracts.map((contract) => {
          const active = contract.versions.find((version) => version.status === 'active')
          return <option key={contract.id} value={contract.id}>{contract.name} · v{active?.revision}</option>
        })}
        {value && !contracts.some((contract) => contract.id === value.contractId) ? (
          <option value={value.contractId}>{value.contractId} · pinned</option>
        ) : null}
      </select>
      {value ? (
        <>
          <select
            aria-label="Outcome data classification"
            disabled={disabled}
            value={value.dataClass}
            onChange={(event) => onChange({ ...value, dataClass: event.target.value as OutcomeTaskBindingInput['dataClass'] })}
            className={selectClass}
          >
            {OUTCOME_DATA_CLASSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            aria-label="Outcome environment"
            disabled={disabled}
            value={value.environment}
            onChange={(event) => onChange({ ...value, environment: event.target.value as OutcomeTaskBindingInput['environment'] })}
            className={selectClass}
          >
            {OUTCOME_ENVIRONMENTS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </>
      ) : null}
      {error ? <span className="w-full text-[9.5px] text-danger">{error}</span> : null}
    </div>
  )
}
