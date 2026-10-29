# House style

What this codebase does on purpose, in its own words. Read it before adding a
component, an animation or a string — the point is not rules for their own sake,
it is that one hand should be visible everywhere.

## Naming

The product speaks one vocabulary and it is not the industry's. The agent is a
**Captain**, the shared surface is a **Table**, each machine occupies a **seat**,
agreement is **turning a key**, the audit trail is a **ledger**, and a published
joint action is **co-signed**. Internal codenames (`knight`, the `knight-file:`
scheme, `KNIGHT_BUILD_ONLY`) stay internal; nothing user-visible names a vendor,
a library or an upstream project.

Anything that names the product reads from `src/shared/identity.ts`. That file is
the single source for the name, tagline, author and build signature, so a rebrand
is one edit rather than a tree-wide search.

## Motion

- Animate `transform`, `opacity` and `filter` only. Never width, height, margin
  or padding.
- Interaction under 300ms. Presses are the fastest thing in the app.
- Enters use ease-out; nothing enters from `scale(0)` or full transparency
  without movement behind it.
- Every pressable thing sinks the same distance: `translateY(1.5px)
  scale(0.978)`. The `Button` variants carry it, and a rule in `styles.css`
  carries raw `<button>`s so chips and menu items do not feel cheaper than the
  real buttons next to them.
- Switching a sidebar view resolves the incoming surface out of a 9px blur over
  300ms. It is one animation for the whole app, applied at the view container.
- `prefers-reduced-motion` kills all of it from one wildcard rule. Do not
  re-introduce motion that survives it.

## Surfaces

One radius scale, one border colour, one shadow temperament. The chatbox radius
is a token (`--r-composer`) shared by every input surface so the composer, the
Table's composer and the task box read as the same object at different widths.
Cards appear where elevation communicates hierarchy and nowhere else; groups are
otherwise separated with `border-t` and `divide-y`.

## Brand marks

`src/renderer/src/components/BrandMarks.tsx` renders the wordmark and the orbit
glyph as CSS **masks** filled with `currentColor`, never as pictures. That is
what lets one asset serve every theme; a white-on-black PNG dropped into a warm
sidebar paints a black rectangle. Derived files come from
`scripts/brand-assets.mjs` and are regenerated, never hand-edited.

The app icon is two artworks by design: the full lockup above 32px, the orbit
glyph below it, because a wordmark with 8px letterforms is a smudge.

## Comments

Explain the constraint, the incident or the trade-off — never what the next line
already says. A comment that only names its own code is noise; a comment that
records why the obvious approach was rejected is the part a future reader cannot
reconstruct. Prefer one block at the top of a function over one per line inside
it.

## Verification

Nothing is "done" from a source read. `npm run typecheck`, `npm run test`,
`npm run build`, then look at the running app. Two symlink tests fail on Windows
for privilege reasons and are a known baseline, not a regression.
