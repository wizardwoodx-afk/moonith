/**
 * The JS half of the motion tokens in styles.css.
 *
 * Framer Motion cannot read a custom property, so the numbers are mirrored here
 * instead of being re-invented per component. `timing.test.ts` fails if the two
 * files ever disagree — change a curve in one, the test makes you change it in
 * the other.
 *
 * ENTER decelerates: the interface looks like it heard you. EXIT accelerates: a
 * thing that has already been read gets out of the way faster than it arrived.
 * MOVE is symmetric, for travelling between two known places. HERO is the house
 * signature, reserved for the view switch and the send ripple.
 */
export type CubicBezier = [number, number, number, number]

export const EASE_ENTER: CubicBezier = [0.23, 1, 0.32, 1]
export const EASE_EXIT: CubicBezier = [0.4, 0, 1, 1]
export const EASE_MOVE: CubicBezier = [0.77, 0, 0.175, 1]
export const EASE_HERO: CubicBezier = [0.16, 1, 0.3, 1]

/** Seconds, because that is what the motion library takes. */
export const DURATION = {
  feedback: 0.1,
  enter: 0.18,
  pop: 0.2,
  surface: 0.25,
  exit: 0.13
} as const

/** Milliseconds, because that is what CSS takes. */
export const STAGGER_STEP_MS = 24
export const STAGGER_CAP = 8

/** Rows further apart than this did not arrive together, so they are not part
 *  of the same cascade and must not queue behind one another. */
const BATCH_WINDOW_MS = 80

/**
 * Turns a stream of first-sight ids into a batch position.
 *
 * A list that mounts as one batch gets 0, 1, 2 ... and cascades. A single row
 * joining a list that is already on screen gets 0 and appears the instant it
 * exists. The cap lives in CSS (--stagger-cap), so a forty-row list never still
 * trickling in after the reader has moved on.
 */
export function createBatchOrder(now: () => number = (): number => performance.now()): {
  positionFor: (id: string) => number
  reset: () => void
} {
  const positions = new Map<string, number>()
  let lastAt = Number.NEGATIVE_INFINITY
  let lastPosition = 0

  return {
    positionFor(id: string): number {
      const known = positions.get(id)
      if (known !== undefined) return known
      const at = now()
      lastPosition = at - lastAt <= BATCH_WINDOW_MS ? lastPosition + 1 : 0
      lastAt = at
      positions.set(id, lastPosition)
      return lastPosition
    },
    reset(): void {
      positions.clear()
      lastAt = Number.NEGATIVE_INFINITY
      lastPosition = 0
    }
  }
}
