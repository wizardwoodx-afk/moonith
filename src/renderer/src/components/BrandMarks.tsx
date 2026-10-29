import type { CSSProperties, SVGProps } from 'react'
import wordmarkUrl from '../assets/brand/wordmark.png'
import glyphUrl from '../assets/brand/glyph.png'

/**
 * The SelfImpulse brand marks, drawn as masks rather than pictures.
 *
 * The supplied art is white on a black plate with no alpha channel, which is
 * unusable directly: dropped into a warm sidebar it paints a black rectangle,
 * and into the Moon theme it disappears. `scripts/brand-assets.mjs` keys that
 * black to alpha and trims the plate, so all that is left is the shape — and a
 * shape can be filled with `currentColor`. These marks therefore follow whatever
 * theme is active and whatever colour their container is using, with no second
 * asset per theme.
 */

/** Trimmed ink box of each generated file, so width follows height. */
const WORDMARK_ASPECT = 383 / 80
const GLYPH_ASPECT = 71 / 64

function maskStyle(url: string, height: number, aspect: number): CSSProperties {
  return {
    display: 'inline-block',
    height,
    width: Math.round(height * aspect),
    backgroundColor: 'currentColor',
    maskImage: `url(${url})`,
    maskSize: '100% 100%',
    maskRepeat: 'no-repeat',
    WebkitMaskImage: `url(${url})`,
    WebkitMaskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat'
  }
}

/**
 * The full wordmark. For the one place the brand is stated at rest: the top of
 * the expanded rail. It replaces both the old mark and the plain "SelfImpulse"
 * label, because the wordmark already is that label.
 */
export function BrandWordmark({
  height = 18,
  className
}: {
  height?: number
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label="SelfImpulse"
      className={className}
      style={maskStyle(wordmarkUrl, height, WORDMARK_ASPECT)}
    />
  )
}

/**
 * The orbit glyph on its own, for the slots a wordmark cannot fit: the
 * collapsed rail, and anywhere else the mark has to read at ~18px. It is the
 * same crop the app icon uses below 32px, so the brand is one shape at every
 * size rather than two.
 */
export function BrandGlyph({ height = 18, className }: { height?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="SelfImpulse"
      className={className}
      style={maskStyle(glyphUrl, height, GLYPH_ASPECT)}
    />
  )
}

/**
 * The glyph under the old `BrandMark` name and prop shape, so the ~13 places
 * that use it as the agent mark — task rows, composer chips, the splash, the
 * settings icon maps — all move to the new brand without editing each call.
 *
 * It accepts SVG props because those call sites pass them through an icon map;
 * the SVG-only ones are deliberately dropped rather than forwarded to a span.
 */
export function BrandMark({
  size = 18,
  className
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <span
      role="img"
      aria-label="SelfImpulse"
      className={className}
      style={maskStyle(glyphUrl, size, GLYPH_ASPECT)}
    />
  )
}
