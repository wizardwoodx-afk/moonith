export interface NativeCatalogDefinition {
  id: string
  name: string
  description: string
  version: string
  design: string
  sample?: {
    eyebrow: string
    heading: string
    caption: string
    accent: string
    items: string[]
  }
}

/**
 * Small reviewed entries shipped with SelfImpulse. They are data, not plugins:
 * no install scripts, provider hooks, tools, or network callbacks are present.
 */
export const NATIVE_CATALOG: NativeCatalogDefinition[] = [
  {
    id: 'moonlight-product',
    name: 'Moonlight Product',
    description: 'A focused product surface for agent workflows, with clear hierarchy and accessible states.',
    version: '1.0.0',
    design: `# Moonlight Product

## Intent
Use a quiet dark surface for focused agent work. Let content and action state carry the hierarchy; do not add decorative noise.

## Tokens
- Canvas: #0a0a0c; raised surface: #171719; border: #27272b.
- Primary text: #e4e4e7; secondary text: #ceced1; metadata: #c1c1c4.
- Accent: #a5a5b3. Reserve stronger color for success, warning, and error states.
- Radius: 12px for cards, 8px for controls. Use a 4/8px spacing rhythm.

## Components
- Page header: one concise title, one supporting sentence, one primary action.
- Cards: 1px borders, restrained elevation, no gratuitous gradients.
- Controls: visible keyboard focus, 44px minimum pointer target where space allows.
- Status: pair color with text or an icon; never use color alone.
- Motion: 160–220ms opacity/transform transitions; honor reduced-motion preferences.

## Accessibility and content
Keep body text at least 14px in production surfaces. Maintain WCAG AA contrast, descriptive labels, and a logical heading order. Empty states explain the next useful action.

## Agent handoff
Create semantic HTML/CSS or the requested native UI equivalent. Keep design tokens in one place and verify keyboard, responsive, loading, empty, and error states.`,
    sample: {
      eyebrow: 'SELFIMPULSE / WORKSPACE',
      heading: 'A clearer next action',
      caption: 'Focused surfaces for work that needs a human decision.',
      accent: '#a5a5b3',
      items: ['Review plan', 'Inspect evidence', 'Approve handoff']
    }
  },
  {
    id: 'editorial-signal',
    name: 'Editorial Signal',
    description: 'A measured editorial system for briefs, reports, and decision-ready narratives.',
    version: '1.0.0',
    design: `# Editorial Signal

## Intent
Make complex information feel calm and readable. Use editorial typography and generous whitespace to guide attention from the central claim to supporting evidence.

## Tokens
- Paper: #f7f5ef; ink: #24231f; muted ink: #625e55; rule: #ddd8cc.
- Accent: #8a6b45, used sparingly for links, markers, and one key action.
- Display: Georgia or a local serif; body: a local sans-serif; measure: 62–72 characters.

## Composition
Lead with a specific headline and a short deck. Use a single-column reading flow for narrative and a two-column layout only when comparison adds meaning. Pull quotes must not repeat body copy.

## Evidence
Cite the source beside the claim, distinguish observed facts from interpretation, and label dates. Tables get headers and a readable mobile fallback.

## Agent handoff
Deliver a real document or artifact with a title, summary, evidence section, and explicit next decision. Check long headings, footnotes, print layout, and reduced-motion behavior.`,
    sample: {
      eyebrow: 'FIELD NOTE / 025',
      heading: 'Make the evidence legible',
      caption: 'A decision brief with a point of view and room to verify it.',
      accent: '#8a6b45',
      items: ['The central claim', 'What we observed', 'The next decision']
    }
  },
  {
    id: 'calm-data',
    name: 'Calm Data',
    description: 'A legible dashboard language for operational metrics, comparisons, and exceptions.',
    version: '1.0.0',
    design: `# Calm Data

## Intent
Help a person understand what changed, why it matters, and where to look next. Do not turn every metric into a competing visual alarm.

## Tokens
- Canvas: #f3f5f2; surface: #ffffff; ink: #1d2823; muted: #5e6b63; grid: #d9e0da.
- Accent: #3d7067; positive: #377440; warning: #986b00; danger: #a63a2a.
- Use tabular numerals and consistent units. Keep chart colors distinguishable without relying on hue alone.

## Components
Every metric has a label, value, time range, and comparison basis. Every chart has a title, axis or legend, and a text summary. Exceptions include an owner or next action.

## Behavior
Show loading and empty states without layout jumps. Preserve filters in the URL or artifact state when appropriate. Provide a table alternative for dense charts and never animate values on initial load.

## Agent handoff
Use realistic but clearly labelled sample data when no source is supplied. Verify keyboard access, small screens, overflow, and that the summary agrees with the displayed values.`,
    sample: {
      eyebrow: 'OPERATIONS / THIS WEEK',
      heading: 'The signal behind the metric',
      caption: 'A compact view of change, context, and the exception that needs attention.',
      accent: '#3d7067',
      items: ['98.2% successful runs', '4 approvals waiting', '1 exception to review']
    }
  }
]
