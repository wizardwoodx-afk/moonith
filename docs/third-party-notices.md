# Third-party notices — the Studio engines

SelfImpulse ships two tools, `studio_commands` and `studio_run`, that drive
fourteen open-source desktop engines. The engines are **not bundled**. Each one
is a separate application the user installs; SelfImpulse only spawns the
command-line binary that the installed app provides.

## Attribution

Every engine below is dual-licensed **MIT OR Apache-2.0** by the ArtCraft Team
(`github.com/storytold`). They are used here under those licences.

| Our name | Greek | Upstream | Repository | CLI verified |
|---|---|---|---|---|
| Techne | τέχνη | ArtCraft | `storytold/artcraft` | no |
| Agora | ἀγορά | ArtCraft Launcher | `storytold/craft-launcher` | no |
| Eikon | εἰκών | PhotoCraft | `storytold/photocraft` | yes |
| Phos | φῶς | LightCraft | `storytold/lightcraft` | no |
| Kinema | κίνημα | FilmCraft | `storytold/filmcraft` | no |
| Schema | σχῆμα | DesignCraft | `storytold/designcraft` | no |
| Gramme | γραμμή | VectorCraft | `storytold/vectorcraft` | yes |
| Chartes | χάρτης | PdfCraft | `storytold/pdfcraft` | yes |
| Drama | δρᾶμα | EffectCraft | `storytold/effectcraft` | no |
| Logos | λόγος | WordCraft | `storytold/wordcraft` | yes |
| Skene | σκηνή | DeckCraft | `storytold/deckcraft` | yes |
| Pinax | πίναξ | GridCraft | `storytold/gridcraft` | yes |
| Techton | τέκτων | CADCraft | `storytold/cadcraft` | yes |
| Echo | ἠχώ | SoundCraft | `storytold/soundcraft` | no |
| Eidos | εἶδος | FigCraft | `storytold/figcraft` | no |

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
modifications. Merely invoking an installed binary does not trigger that
obligation, which is why it is the chosen integration.

## Unverified engines

An engine marked `no` follows the same architecture — a command registry and a
`{name}-cli` binary — but its command-line tool and Windows build were not
confirmed when this table was written. `studio_run` says so rather than
pretending the engine is ready.
