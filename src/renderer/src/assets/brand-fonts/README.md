# Pulsidian Type System v1.0.0

An Anthropic-direction (warm, bookish, editorial) font system — built clean,
clear and production-ready. Working name **Pulsidian** (rename in one line, see FONTLOG).

## The system (3 roles — nothing more)
| Role | Font | Used for |
|---|---|---|
| Display | Pulsidian Serif Display 600 | Hero headlines, brand statements, deck covers |
| Reading | Pulsidian Serif 400/500/600 + Italic | AI answers, reports, documents, article text |
| Product UI | Pulsidian Sans 400/500/600/700 | Buttons, nav, dashboards, tables, labels |

## Install in your app
```html
<link rel="stylesheet" href="brand-fonts/fonts.css">
<h1 class="font-display">Agents that do the work.</h1>
<p class="font-serif-body">Long-form agent output reads like a book...</p>
<button class="font-ui">Deploy agent</button>
```
React/Next: import `brand-fonts/fonts.css` once in your root layout, then use
`var(--font-display)`, `var(--font-serif)`, `var(--font-sans)` anywhere.
Tokens for code: `typography.ts` / `typography.tokens.json`.
Desktop/design tools: install the `.ttf` files in `fonts/`.

Pairs with the colour pack: load `brand-tokens/brand.css` + `brand-fonts/fonts.css` together.

## Files
- `fonts/` — 9 styles × (TTF + WOFF2)
- `fonts.css` — @font-face + type scale + utility classes
- `preview.html` — live specimen (fonts embedded)
- `FONTLOG.md` — sources, licence, customisation record
- `build_fonts.py` — rebuild/rename script
