# Third-party notices — the Studio engines

SelfImpulse ships two tools, `studio_commands` and `studio_run`, that drive
thirteen open-source desktop engines. The engines are **not bundled**. Each one
is a separate application; SelfImpulse only spawns the command-line binary that
its portable build provides, found in the Studio tools folder (`studio` under
the profile directory), on PATH, or via `SELFIMPULSE_STUDIO_<ID>`.

## Attribution

Every engine below is dual-licensed **MIT OR Apache-2.0** by the ArtCraft Team
(`github.com/storytold`). They are used here under those licences.

| Our name | Greek | Upstream | Repository |
|---|---|---|---|
| Eikon | εἰκών | PhotoCraft | `storytold/photocraft` |
| Phos | φῶς | LightCraft | `storytold/lightcraft` |
| Kinema | κίνημα | FilmCraft | `storytold/filmcraft` |
| Schema | σχῆμα | DesignCraft | `storytold/designcraft` |
| Gramme | γραμμή | VectorCraft | `storytold/vectorcraft` |
| Chartes | χάρτης | PdfCraft | `storytold/pdfcraft` |
| Drama | δρᾶμα | EffectCraft | `storytold/effectcraft` |
| Logos | λόγος | WordCraft | `storytold/wordcraft` |
| Skene | σκηνή | DeckCraft | `storytold/deckcraft` |
| Pinax | πίναξ | GridCraft | `storytold/gridcraft` |
| Techton | τέκτων | CADCraft | `storytold/cadcraft` |
| Echo | ἠχώ | SoundCraft | `storytold/soundcraft` |
| Eidos | εἶδος | FigCraft | `storytold/figcraft` |

The main `storytold/artcraft` app and `storytold/craft-launcher` are **not**
integrated: neither publishes a command-line binary (they ship installers and a
GUI launcher only), so there is nothing for a headless engine to call.

## Why the names are ours

MIT and Apache-2.0 both permit rebranding, but neither grants trademark rights.
PdfCraft states explicitly that the marks under its `docs/brand/` directory are
**excluded** from its open-source licence, and the same applies to the other
projects by default.

So the name shown in the interface is ours (`Pinax`, `Logos`, `Chartes` …), and
the upstream name appears only in this notice and in an error message that tells
the user what to install. `STUDIO_APPS` in `src/main/agent/tools/studio.ts`
carries the mapping in a single place.

The **binaries keep their upstream names** (`gridcraft-cli`, `wordcraft-cli`, …).
Renaming an executable we did not build would misrepresent it to the filesystem
and can break the application's own resource lookup.

## If you redistribute

If you ever bundle these engines with SelfImpulse instead of asking the user to
install them, you must additionally ship each project's `LICENSE-MIT` /
`LICENSE-APACHE` files and its `NOTICE` where present, and mark your
modifications. Merely invoking a binary the user installed does not trigger that
obligation, which is why it is the chosen integration.
