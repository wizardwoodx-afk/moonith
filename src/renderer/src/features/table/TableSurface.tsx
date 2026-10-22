import { useEffect } from 'react'
import { useTableStore } from './tableStore'
import { PairingPanel } from './PairingPanel'
import { SharedTable } from './SharedTable'

export function TableSurface() {
  const role = useTableStore((state) => state.state.role)
  const begin = useTableStore((state) => state.begin)

  useEffect(() => begin(), [begin])

  return (
    <div className="h-full bg-canvas text-ink">
      {role === 'idle' ? <PairingPanel /> : <SharedTable />}
    </div>
  )
}
