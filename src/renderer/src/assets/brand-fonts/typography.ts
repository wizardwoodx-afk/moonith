// Pulsidian typography tokens v1.0.0
export const typography = {
  "version": "1.0.0",
  "families": {
    "display": "'Pulsidian Serif Display', 'Pulsidian Serif', Georgia, serif",
    "serif": "'Pulsidian Serif', Georgia, 'Times New Roman', serif",
    "sans": "'Pulsidian Sans', Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    "mono": "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
  },
  "styles": {
    "display": {
      "family": "display",
      "weight": 600,
      "size": "clamp(2.75rem, 6vw, 4.5rem)",
      "lineHeight": 1.02,
      "letterSpacing": "-0.02em",
      "use": "Hero headlines, brand statements"
    },
    "h1": {
      "family": "display",
      "weight": 600,
      "size": "clamp(2rem, 4vw, 3rem)",
      "lineHeight": 1.08,
      "letterSpacing": "-0.018em",
      "use": "Page titles"
    },
    "h2": {
      "family": "serif",
      "weight": 600,
      "size": "1.75rem",
      "lineHeight": 1.18,
      "letterSpacing": "-0.012em",
      "use": "Section titles, document headings"
    },
    "serifBody": {
      "family": "serif",
      "weight": 400,
      "size": "1.125rem",
      "lineHeight": 1.65,
      "letterSpacing": "0",
      "use": "AI long-form answers, reports, reading surfaces"
    },
    "ui": {
      "family": "sans",
      "weight": 400,
      "size": "0.9375rem",
      "lineHeight": 1.5,
      "letterSpacing": "-0.011em",
      "use": "App UI, navigation, controls, tables"
    },
    "label": {
      "family": "sans",
      "weight": 700,
      "size": "0.6875rem",
      "lineHeight": 1.3,
      "letterSpacing": "0.09em",
      "textTransform": "uppercase",
      "use": "Eyebrows, status, metadata"
    }
  }
} as const;
export const fontFamilies = typography.families;
