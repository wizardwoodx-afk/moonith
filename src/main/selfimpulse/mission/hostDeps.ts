/**
 * §HOST RUNNER DEPS — the Loop page's execution deps (VH 12.0).
 *
 * The managed engine tier (the Electron shell's supervised local core) runs real
 * seats; every other host gets the honest refusal path (git/verify report that
 * they did not run rather than pretending). The Mission Loop engine never fakes a
 * run — these are the deps the app hands it; probes inject deterministic ones.
 */
import { ipc } from "../ipc/client";
import type { TeamRunnerDeps } from "./teamExecutor";

/**
 * The managed engine tier — what the renderer may ask the host's agent core.
 *
 * The bridge methods live behind `window.selfImpulseDesktop` on the Electron
 * host only; the capability matrix (`src/ipc/hostCapabilities.ts`) names them,
 * and `probe/nativeTrustPreload` holds the preload to that name list. The page
 * never sees the engine's listener or its one-time token: main validates the
 * payload and carries the call, and a refusal comes back as
 * `{ available: false, reason }` — a receipt that says what did NOT run, the
 * same words-first discipline every other seam here answers in.
 */
interface EngineBridge {
  engineStatus?: () => Promise<{ enabled?: boolean; ready?: boolean; operational?: boolean; reason?: string }>;
  engineSeat?: (req: { prompt: string; readOnly?: boolean; maxSteps?: number; model?: string }) =>
    Promise<{ available?: boolean; exitCode?: number; stdout?: string; stderr?: string; durationMs?: number; timedOut?: boolean; reason?: string }>;
}

function engineBridge(): EngineBridge | null {
  const w = (globalThis as { selfImpulseDesktop?: unknown }).selfImpulseDesktop;
  return w && typeof w === "object" ? (w as EngineBridge) : null;
}

/**
 * `testCommand` names the repository's own check, which only a host carrying an
 * executor can run; on this host `verify` refuses in words, so it is accepted
 * and ignored rather than dropped from the call signature.
 */
export function hostRunnerDeps(_opts?: { testCommand?: string }): TeamRunnerDeps {
  return {
    // 19.7.15: the native seat runner. This is what actually runs an agent now
    // that the CLI tier is gone — the owner's own provider key, in this process,
    // under the authority envelope the Governor derived. A read-only seat is
    // told so in the system prompt and gets no write or shell affordance; the
    // capability ceiling in src/security/guardrail.ts is what actually enforces
    // that, not this string.
    //
    // 20.x — when the managed engine tier is present AND operational, the seat
    // runs there first: a multi-step agent core with its own workspace-fenced
    // file/git/shell tools, instead of one un-toolboxed chat call. A host
    // without the tier (a browser preview, or a desktop shell whose engine is not
    // installed yet) or with no
    // provider key configured falls through to the 19.7 path below — the same
    // seat, the same caps, nothing silently different.
    nativeInvoke: async (req) => {
      const started = Date.now();
      const bridge = engineBridge();
      const bStatus = bridge?.engineStatus ? await bridge.engineStatus().catch(() => null) : null;
      if (bridge?.engineSeat && bStatus?.enabled && bStatus.ready && bStatus.operational) {
        try {
          const r = await bridge.engineSeat({
            prompt: req.prompt,
            ...(req.readOnly ? { readOnly: true } : {}),
          });
          if (r.available === true) {
            return {
              exitCode: r.exitCode ?? 1,
              stdout: r.stdout ?? "",
              stderr: r.stderr ?? "",
              durationMs: r.durationMs ?? Date.now() - started,
              timedOut: r.timedOut === true,
            };
          }
          // The host itself refused (validation, busy, dead listener). Run the
          // legacy native seat instead of reporting a run that did not happen —
          // but only when the refusal is not a policy one; a refused payload is
          // ours to fix, so it surfaces rather than silently re-routing.
          if (r.available === false && typeof r.reason === "string" && r.reason.startsWith("refused:")) {
            return {
              exitCode: 1,
              stdout: "",
              stderr: r.reason,
              durationMs: Date.now() - started,
              timedOut: false,
            };
          }
        } catch {
          /* engine tier unreachable this call — the 19.7 path below answers */
        }
      }
      // Resolve the owner's OWN configured key, the same way the native loop
      // does in src/engine/hermesRuntime.ts (resolveLlm): no key means no run.
      // A seat must never fall back to a default model it was not granted.
      const candidates = ["openai", "anthropic", "ollama"];
      let chosen: { provider: string; model: string; secret_ref: string; base_url?: string } | null = null;
      for (const kind of candidates) {
        const secret_ref = kind === "ollama" ? "provider.ollama.local" : `provider.${kind}.production`;
        const have = await ipc.secretExists([secret_ref]);
        if (have?.[secret_ref]) {
          chosen = {
            provider: kind,
            model: req.model || (kind === "anthropic" ? "claude-sonnet-4" : kind === "ollama" ? "llama3.1" : "gpt-4o-mini"),
            secret_ref,
            ...(kind === "ollama" ? { base_url: "http://127.0.0.1:11434" } : {}),
          };
          break;
        }
      }
      if (!chosen) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "no provider key is configured — add one in Settings before running agents. Nothing ran.",
          durationMs: Date.now() - started,
          timedOut: false,
        };
      }
      try {
        const out = await ipc.llmChat({
          provider: chosen.provider,
          model: chosen.model,
          secret_ref: chosen.secret_ref,
          ...(chosen.base_url ? { base_url: chosen.base_url } : {}),
          system: req.readOnly
            ? "You are a governed reviewer operating READ-ONLY. Do not write files or run shell commands; report findings."
            : "You are a governed worker inside a sandboxed workspace. Stay inside the given working directory.",
          messages: [{ role: "user", content: req.prompt }],
        });
        return {
          exitCode: 0,
          stdout: out?.content ?? "",
          stderr: "",
          durationMs: Date.now() - started,
          timedOut: false,
        };
      } catch (err) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `native seat failed: ${String(err)}`,
          durationMs: Date.now() - started,
          timedOut: false,
        };
      }
    },
    // External agent CLIs are removed. No binary is resolved by id and no
    // third-party agent process is spawned. Dev-tool seats (node/npm/cargo/git
    // and the repository's own tests) still run — through shell_exec, which keeps
    // its own allowlist and workspace containment.
    resolveBin: async (_bin) => null,
    cliInvoke: async (req) => {
      void req;
      return {
        exitCode: 127,
        stdout: "",
        stderr:
          "external agent CLIs are removed — every agent runs in-process on your own provider key. Refused in words; nothing ran.",
        durationMs: 0,
        timedOut: false,
      };
    },
    git: async (args, _cwd) => {
      /* 20.x — this host carries no executor, so git DID NOT run. The old
         reply (`{ ok: true, stdout: "ok" }`) let snapshot builds, worktree
         creation and `.git/info/exclude` writes report success while touching
         nothing, and the seat ran on believing work it could not have done.
         The honest answer is a failure naming why. */
      return { ok: false, exitCode: null, stdout: "", stderr: `git did not run: this host carries no executor (only the desktop shells do). ${args.join(" ")} did not happen.`, reason: "no executor on this host" };
    },
    /**
     * This host carries no filesystem writer, so a requested write does nothing —
     * it never silently reports success, and nothing that depends on the file can
     * read it.
     *
     * The writer used to call `ipc.fsWrite` and re-raise a rejection carrying (a)
     * the path, (b) the host's own words, and (c) the consequence in one sentence,
     * because an earlier `fsWrite(...).catch(() => undefined)` swallow let a run's
     * receipt record work that had not happened. That branch went with the host
     * that could reach it; what remains is the no-executor path.
     */
    writeFile: async (_filePath, _contents) => {},
    verify: async (_cwd) => {
      /* 20.x — a host with no executor previously returned a canned
         `exitCode: 0, "PASS — simulated verify"` after 250 ms, and `runSeat`
         reads ONLY the exit code, so every seat on this host recorded
         `verified: true` even though the word "simulated" sat in stdout that
         nothing downstream inspects. A verify that tests nothing is a test
         failure wearing a green LED: exitCode 1, the reason in stderr words,
         and the merge gate's own job to hold the seat. */
      return {
        exitCode: 1,
        stdout: "",
        stderr: "verify did not run: this host carries no executor — only a desktop shell (or a host carrying the managed engine tier) can run the repository's own check.",
        durationMs: 0,
        timedOut: false,
      };
    },
  };
}

/**
 * Deps for a host with no reachable CLI layer: honest "blocked", never fake.
 *
 * It lives here, beside the host's real deps, rather than beside the graph
 * that uses it: the mission cycle loads the graph's runtime LAZILY, and a
 * dependency on the runtime from this module would drag the whole of it back
 * into the first-paint bundle.
 */
export function noHostDeps(): TeamRunnerDeps {
  return {
    cliInvoke: async () => ({ exitCode: null, stdout: "", stderr: "no host CLI layer", durationMs: 0, timedOut: true }),
    resolveBin: async () => null,
    writeFile: async () => undefined,
  };
}
