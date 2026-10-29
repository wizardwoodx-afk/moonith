# FONTLOG — Pulsidian Serif / Pulsidian Sans v1.0.0

Custom production instances built 2026 for an enterprise agentic AI brand system.

## Sources (SIL Open Font License 1.1)
- Serif: Newsreader by Production Type (github.com/productiontype/Newsreader)
- Sans: Inter by Rasmus Andersson and contributors (github.com/rsms/inter)
Full license texts: `licenses/Newsreader-OFL.txt`, `licenses/Inter-OFL.txt`.
Original copyright notices are retained inside the font files.

## Customisation performed
- Renamed to Pulsidian Serif / Pulsidian Serif Display / Pulsidian Sans (working brand name).
- Serif cuts instantiated at bespoke optical coordinates for screen clarity:
  Regular 430@opsz18, Medium 540@opsz24, SemiBold 650@opsz36, Italic 430@opsz18,
  Display SemiBold 610@opsz72.
- Sans cuts instantiated at opsz14: 400 / 510 / 610 / 700.
- Delivered as static TTF + WOFF2 with corrected name tables and weight metadata.

This family is *inspired by* the warm editorial direction of modern AI brands.
It is not a copy of, and contains no glyphs from, any proprietary typeface
(including Anthropic's Styrene/Tiempos).

## Renaming later
Edit `FAMILY_PREFIX` in `build_fonts.py` and re-run — all binaries, names and
PostScript names rebuild under the final company/font name.
