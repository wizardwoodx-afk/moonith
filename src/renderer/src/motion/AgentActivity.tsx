import type { AgentActivityState, AgentActivityValue } from '../lib/agentActivity'
import { useMotion } from '../lib/motion'
import './AgentActivity.css'

/** The states where something is actually happening, and so the glyph breathes. */
const IN_FLIGHT: readonly AgentActivityState[] = ['reading', 'delegating', 'thinking', 'responding', 'working']

/** One quiet activity signal; elapsed time deliberately lives outside this status. */
export function AgentActivity({ activity }: { activity: AgentActivityValue }) {
  const resolved = useMotion((state) => state.resolved)
  const { state, label, detail } = activity
  const active = IN_FLIGHT.includes(state)

  return (
    <span
      className="agent-activity"
      data-state={state}
      data-active={active ? 'true' : 'false'}
      data-motion-mode={resolved}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Remounting on the state key is what replays the settle. The live region
          stays mounted above it, so the label change is still announced. */}
      <span key={state} data-motion="state" className="agent-activity__glyph-wrap">
        <svg
          className="agent-activity__glyph"
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          {state === 'reading' ? (
            <>
              <path className="agent-activity__sheet" d="M5 2.5h7l3 3V17H5z M12 2.5V6h3 M7.5 9h5 M7.5 12h3" />
              <path className="agent-activity__scan" d="M3.5 9h13" />
            </>
          ) : state === 'delegating' ? (
            <>
              <path className="agent-activity__stem" d="M3 10h4" />
              <path className="agent-activity__branch" d="M7 10V4h9 M14 2l2 2-2 2" />
              <path className="agent-activity__branch" d="M7 10h9 M14 8l2 2-2 2" />
              <path className="agent-activity__branch" d="M7 10v6h9 M14 14l2 2-2 2" />
            </>
          ) : state === 'complete' ? (
            <path d="m4.5 10 3.5 3.5 7.5-7.5" />
          ) : state === 'error' ? (
            <path d="m5.5 5.5 9 9 M14.5 5.5l-9 9" />
          ) : state === 'paused' ? (
            <path d="M7 4.5v11 M13 4.5v11" />
          ) : state === 'waiting' ? (
            <>
              <circle cx="10" cy="10" r="6.5" />
              <path d="M10 6v4l2.5 1.5" />
            </>
          ) : (
            <>
              <path className="agent-activity__line" d="M4 5.5h10" />
              <path className="agent-activity__line" d="M4 10h12" />
              <path className="agent-activity__line" d="M4 14.5h7" />
            </>
          )}
        </svg>
      </span>
      <span key={`${state}-${label}`} data-motion="state" className="agent-activity__copy">
        <span className="agent-activity__label">{label}</span>
        {detail ? <span className="agent-activity__detail"> · {detail}</span> : null}
      </span>
    </span>
  )
}
