/**
 * The engines a seat can run on. There are two, and both run IN-PROCESS on the
 * owner's own provider key:
 *
 *   hermes — the vendored native agent loop (act / observe / adjust)
 *   llm    — the direct provider seam
 *
 * There are no other engines and there is no extension point for one: no
 * external binary, no ACP peer, no user-registered harness. A seat whose
 * config names anything else resolves to `hermes` — saved graphs keep working,
 * and nothing here can ever spawn a third-party process. The absence of an
 * extension surface IS the guarantee, and probe/noExternalCli.test.ts pins it.
 */
export type HarnessId = "hermes" | "llm";

export interface HarnessSpec {
  id: HarnessId;
  name: string;
  /**
   * External binaries this engine needs. ALWAYS EMPTY, and the emptiness is the
   * point: the drill walks this list on PATH and asserts that no engine resolves
   * to a binary, which is how "nothing here spawns a third-party process" is
   * proven mechanically instead of asserted in a comment. A field that could
   * grow back is a field that will.
   */
  bins: string[];
  /** argv template. Also always empty; it survives only because the brain seam
   *  returns it, and it is empty for the same reason `bins` is. */
  argv: string[];
  /** What the operator must do to make this engine usable. Never an install
   *  command for a third-party agent — there are none. */
  install: string;
  notes: string;
  /** Where the behaviour is implemented, so a claim can be re-traced. */
  source?: string;
}

export const HARNESSES: HarnessSpec[] = [
  {
    id: "hermes",
    name: "Native agent (in-process)",
    bins: [],
    argv: [],
    install: "Nothing to install — the agent loop runs inside SelfImpulse on your own provider key (or a local Ollama).",
    notes: "The vendored act/observe/adjust loop. Every crew seat runs here, so every action carries one audited receipt format and the trust story has no third party in it.",
    source: "src/engine/hermesRuntime.ts",
  },
  {
    id: "llm",
    name: "Direct LLM (API / Ollama)",
    bins: [],
    argv: [],
    install: "Save a provider key in Settings → Providers, or run Ollama locally",
    notes: "Not an agent loop. Calls the chat API with the composed agent prompt — the direct seam under the native runner.",
  },
];

export const HARNESS_BY_ID = new Map(HARNESSES.map((h) => [h.id, h]));

export function defaultHarness(): HarnessId {
  return "hermes";
}

/** Only the in-process engines are offered — nothing else exists to offer. */
export const HARNESS_OPTIONS = HARNESSES.map((h) => h.id);
