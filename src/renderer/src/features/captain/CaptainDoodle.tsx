export function CaptainDoodle() {
  return (
    <div className="relative flex h-[150px] w-full items-center justify-center" aria-hidden="true">
      <svg
        viewBox="0 0 220 132"
        className="h-[124px] w-[196px] overflow-visible"
        role="presentation"
      >
        <defs>
          <radialGradient id="si-sun" cx="50%" cy="44%" r="62%">
            <stop offset="0%" stopColor="var(--c-gold)" stopOpacity="0.34" />
            <stop offset="62%" stopColor="var(--c-gold)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--c-gold)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="si-hill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="si-piece" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--c-accent-ink)" />
            <stop offset="100%" stopColor="var(--c-accent)" />
          </linearGradient>
        </defs>

        <circle cx="112" cy="58" r="52" fill="url(#si-sun)" />
        <circle
          cx="112"
          cy="58"
          r="36"
          fill="none"
          stroke="var(--c-gold)"
          strokeOpacity="0.22"
          strokeDasharray="2 7"
        />
        <circle cx="112" cy="58" r="27" fill="none" stroke="var(--c-line-strong)" strokeOpacity="0.5" />

          <path
            d="M38 95c18-16 39-24 73-24 35 0 54 8 71 24l10 10H28l10-10Z"
            fill="url(#si-hill)"
            opacity="0.7"
          />
        <path d="M38 105h144" stroke="var(--c-line-strong)" strokeOpacity="0.55" strokeLinecap="round" />

        <g transform="translate(72 27)">
          <path
            d="M57 66c4-4 6-10 5-16 5-2 8-7 8-12 0-8-6-14-14-15l-9-1 7-9c2-3-1-7-4-5L26 25c-6 5-8 13-6 20l2 7 8-5c-1 6-4 10-9 13v7h36v-1Z"
            fill="url(#si-piece)"
          />
          <path
            d="M48 24c-4 2-7 5-9 9M29 33l-1 8M33 57h31"
            stroke="var(--c-canvas)"
            strokeOpacity="0.4"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="42" cy="31" r="1.8" fill="var(--c-gold)" />
          <path
            d="M20 73h48c3 0 5 2 5 5H15c0-3 2-5 5-5Z"
            fill="var(--c-accent-ink)"
          />
          <path d="M12 83h64" stroke="var(--c-accent-ink)" strokeWidth="3" strokeLinecap="round" />
        </g>

        <g fill="var(--c-gold)">
          <path d="m38 43 1.7 4.3L44 49l-4.3 1.7L38 55l-1.7-4.3L32 49l4.3-1.7L38 43Z" opacity="0.8" />
          <path d="m183 36 1.2 3.1 3.1 1.2-3.1 1.2-1.2 3.1-1.2-3.1-3.1-1.2 3.1-1.2 1.2-3.1Z" opacity="0.6" />
          <circle cx="171" cy="73" r="2" opacity="0.5" />
          <circle cx="52" cy="68" r="1.4" opacity="0.45" />
        </g>
      </svg>
    </div>
  )
}
