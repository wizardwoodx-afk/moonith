import type { SVGProps } from 'react'

/**
 * The SelfImpulse mark: a pulse trace in the product's amber, inside the
 * rounded tile it ships with. Sized by `size`; every other SVG prop passes
 * through so it can sit inline with the icon set it replaces.
 */
export function BrandMark({ size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="SelfImpulse"
      {...rest}
    >
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="11"
        fill="#0F1113"
        stroke="#262A31"
        strokeWidth="1.5"
      />
      <path
        d="M 8 31.5 L 14.5 31.5 L 19.5 13.5 L 25.5 35.5 L 30.5 24.5"
        fill="none"
        stroke="#C9A45C"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="35.5" cy="24.5" r="2.5" fill="#C9A45C" />
      <circle cx="41.5" cy="24.5" r="1.4" fill="#3F7D6E" fillOpacity="0.72" />
    </svg>
  )
}
