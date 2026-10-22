/**
 * §18/§38 — REAL verification.
 *
 * Before V7, `TEST_RUN` and `STATIC_CHECK` were structurally incapable of being measured: the
 * coding harness either ran for real (and VH parsed its prose) or was the labelled simulation, in
 * which case every check came back `measured: false`. A mission could therefore never honestly
 * reach COMPLETED. That is a hole in the middle of the product.
 *
 * This module closes it by running the *target repository's own* verification commands — its
 * typecheck, its test suite, its linter — and turning the exit code and output into a measured
 * check. VH does not invent a test runner and does not guess a result: it asks the project how it
 * verifies itself, runs exactly that, and reports what happened.
 *
 * Two rules that matter more than the feature:
 *
 *  1. **Never auto-install.** If `node_modules` is absent, npm exits non-zero with a misleading
 *     error. That would be recorded as "tests failed" when in fact nothing ran. So discovery
 *     checks for the dependency directory first and reports `didRun: false` with the reason.
 *  2. **Never treat "cannot run" as "failed".** A check that could not run is `measured: false`
 *     and drags the score down; it is not a red tick. Conflating the two is how a tool starts
 *     lying in both directions.
 */

import type { EvidenceSource } from "./types";

export interface CheckSpec {
  id: string;
  label: string;
  source: EvidenceSource;
  command: string;
  args: string[];
  timeoutSecs: number;
  /** Where this came from, e.g. "package.json scripts.typecheck". */
  discoveredFrom: string;
}

export interface CheckResult {
  spec: CheckSpec;
  /** False when the command was never executed. Distinguished from a failing exit code. */
  didRun: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
  /** Set when it could not run, or when it failed — never both empty and didRun true. */
  reason: string | null;
}

export type RunFn = (command: string, args: string[], cwd: string, timeoutSecs: number) => Promise<{ stdout: string; stderr: string; code: number | null }>;
export type ReadFn = (path: string) => Promise<string>;
/** Existence probe. Separate from ReadFn because a directory cannot be read as text. */
export type ExistsFn = (path: string) => Promise<boolean>;

const join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}/${name}`);

/**
 * Work out how this repository verifies itself. Returns nothing invented: every check points at
 * the manifest entry it was derived from, so the UI can show *why* VH decided to run it.
 */
export async function discoverChecks(repoDir: string, read: ReadFn, exists: ExistsFn = (p) => existsViaRead(p, read)): Promise<CheckSpec[]> {
  const out: CheckSpec[] = [];
  const seen = new Set<string>();
  const add = (spec: CheckSpec) => {
    const key = `${spec.command} ${spec.args.join(" ")}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(spec);
  };

  // ---- Node / TypeScript ----
  const pkgRaw = await tryRead(join(repoDir, "package.json"), read);
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

      const typecheck = pickScript(scripts, ["typecheck", "type-check", "tsc"]);
      if (typecheck) {
        add({ id: "typecheck", label: "Typecheck", source: "STATIC_CHECK", command: "npm", args: ["run", typecheck.name], timeoutSecs: 240, discoveredFrom: `package.json scripts.${typecheck.name}` });
      } else if (allDeps.typescript) {
        add({ id: "typecheck", label: "Typecheck", source: "STATIC_CHECK", command: "npm", args: ["exec", "--", "tsc", "--noEmit"], timeoutSecs: 240, discoveredFrom: "package.json dependency: typescript" });
      }

      const lint = pickScript(scripts, ["lint", "eslint", "biome", "check"]);
      if (lint) {
        add({ id: "lint", label: "Lint", source: "STATIC_CHECK", command: "npm", args: ["run", lint.name], timeoutSecs: 180, discoveredFrom: `package.json scripts.${lint.name}` });
      }

      const test = pickScript(scripts, ["test", "test:unit", "test:run"]);
      if (test) {
        add({ id: "test", label: "Test suite", source: "TEST_RUN", command: "npm", args: ["run", test.name], timeoutSecs: 600, discoveredFrom: `package.json scripts.${test.name}` });
      }
    } catch {
      /* a malformed package.json is not a reason to invent checks */
    }
  }

  // ---- Rust ----
  if (await exists(join(repoDir, "Cargo.toml"))) {
    add({ id: "cargo-check", label: "cargo check", source: "STATIC_CHECK", command: "cargo", args: ["check", "--all-targets"], timeoutSecs: 900, discoveredFrom: "Cargo.toml" });
    add({ id: "cargo-test", label: "cargo test", source: "TEST_RUN", command: "cargo", args: ["test"], timeoutSecs: 900, discoveredFrom: "Cargo.toml" });
  }

  // ---- Python ----
  if ((await exists(join(repoDir, "pyproject.toml"))) || (await exists(join(repoDir, "pytest.ini")))) {
    add({ id: "pytest", label: "pytest", source: "TEST_RUN", command: "python3", args: ["-m", "pytest", "-q"], timeoutSecs: 600, discoveredFrom: "pyproject.toml / pytest.ini" });
  }

  return out;
}

function pickScript(scripts: Record<string, string>, names: string[]): { name: string } | null {
  for (const n of names) if (scripts[n]) return { name: n };
  return null;
}

async function tryRead(path: string, read: ReadFn): Promise<string | null> {
  try {
    return await read(path);
  } catch {
    return null;
  }
}

async function existsViaRead(path: string, read: ReadFn): Promise<boolean> {
  return (await tryRead(path, read)) !== null;
}

/**
 * Run one check. `didRun: false` means VH never executed anything — the reason says why, and the
 * caller must record that as unmeasured rather than as a failure.
 */
export async function runCheck(spec: CheckSpec, repoDir: string, run: RunFn, canRun: () => Promise<boolean>, exists: ExistsFn = existsNative): Promise<CheckResult> {
  const started = Date.now();
  const finish = (r: Omit<CheckResult, "spec" | "durationMs">): CheckResult => ({ spec, durationMs: Date.now() - started, ...r });

  if (!(await canRun())) {
    return finish({ didRun: false, exitCode: null, output: "", reason: "no executor available — this needs the native desktop build, not the browser preview" });
  }

  // Refuse to run npm/yarn/pnpm checks with no dependencies installed: they exit non-zero with a
  // misleading message, which would be recorded as a test failure that never happened.
  if (/^(npm|npx|yarn|pnpm)$/.test(spec.command)) {
    if (!(await exists(join(repoDir, "node_modules")))) {
      return finish({ didRun: false, exitCode: null, output: "", reason: "node_modules is absent; VH will not run an install for you, so this check was not performed" });
    }
  }

  try {
    const r = await run(spec.command, spec.args, repoDir, spec.timeoutSecs);
    const output = [r.stdout, r.stderr].filter((s) => s && s.trim()).join("\n").trim();
    return finish({
      didRun: true,
      exitCode: r.code,
      output,
      reason: r.code === 0 ? null : `exited ${r.code ?? "with no code (killed or signalled)"}`,
    });
  } catch (e) {
    return finish({ didRun: false, exitCode: null, output: "", reason: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Environment detection. In the browser there is no filesystem and no process, so VH says so
 * rather than pretending. In the desktop shell everything goes through IPC. Under node — the
 * probes, or a headless run — it uses node's own fs and child_process.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof process === "undefined";
}

export async function readNative(path: string): Promise<string> {
  if (isBrowser()) {
    const { ipc } = await import("../ipc/client");
    /* The native seam answers with a RESULT (`{ok, content, reason}`). The
     * whole object used to be returned where a string was promised, and it
     * type-checked because the verb was typed `never`. */
    const r = await ipc.fsRead(path);
    if (!r?.ok) throw new Error(`read failed: ${r?.reason ?? "the filesystem seam refused"}`);
    return r.content;
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

/**
 * Native existence probe. A directory cannot be read as text, and `node_modules` is a directory,
 * so this checks metadata rather than reading.
 */
export async function existsNative(path: string): Promise<boolean> {
  if (isBrowser()) {
    const { ipc } = await import("../ipc/client");
    try {
      await ipc.fsList(path);
      return true;
    } catch {
      return false;
    }
  }
  const { stat } = await import("node:fs/promises");
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/* Agent/dev CLIs that are allowlisted for direct Node-hosted execution. This
 * mirrors the executor's own allowlist in electron/native/exec.cjs
 * (V-security fix: the previous Node path spawned ANY command with no
 * allowlist, no env scrub and no approval gate, and inherited the parent
 * environment wholesale — equivalent to an env leak + un-gated exec). */
const SHELL_ALLOWED: ReadonlySet<string> = new Set([
  "hermes", "agent",
  "node", "npm", "npx", "python", "python3", "pip", "pip3", "pytest", "cargo", "git", "go",
]);

export async function runNative(command: string, args: string[], cwd: string, timeoutSecs: number) {
  if (isBrowser()) {
    const { ipc } = await import("../ipc/client");
    const r = (await ipc.shellExec(command, args, cwd, timeoutSecs)) as { stdout?: string; stderr?: string; code?: number | null };
    return { stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), code: r.code ?? null };
  }
  // V-security gate: on the Node host, apply the same bare-name allowlist the
  // Rust shell_exec applies. Absolute paths are refused here because there is
  // no registered-workspace-root check in this TS-side path; the Tauri IPC
  // path (above) owns the workspace-root containment. This keeps Node-hosted
  // harness runs (e.g. si-host, probes under node) from spawning arbitrary
  // binaries, and from inheriting credential-shaped env vars.
  const bare = command.replace(/.*[\\/]/, "").replace(/\.(exe|cmd|bat|com)$/i, "");
  if (!SHELL_ALLOWED.has(bare)) {
    return { stdout: "", stderr: `shell capability boundary: '${command}' is not an allowlisted CLI (${[...SHELL_ALLOWED].join(", ")}). Refused in words; nothing ran.`, code: null };
  }
  const { spawn } = await import("node:child_process");
  const { scrubEnv } = await import("./sandbox");
  const scrubbed = scrubEnv(process.env as Record<string, string>);
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, env: { ...scrubbed, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, Math.max(1, timeoutSecs) * 1000);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${e.message}`.trim(), code: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export async function canRunNative(): Promise<boolean> {
  /* No renderer host in this build carries a process executor, so a check
   * inside the app answers "it did not run" and the caller records it as
   * unmeasured. The Node host — the probes, the local host — runs for real. */
  if (isBrowser()) return false;
  return true;
}

/** The whole pass: discover, run, and summarise for the flight recorder. */
export async function runAllChecks(
  repoDir: string,
  opts: { read?: ReadFn; run?: RunFn; canRun?: () => Promise<boolean>; exists?: ExistsFn; only?: Array<"TEST_RUN" | "STATIC_CHECK"> } = {},
): Promise<CheckResult[]> {
  const read = opts.read ?? readNative;
  const run = opts.run ?? runNative;
  const canRun = opts.canRun ?? canRunNative;
  const exists = opts.exists ?? ((p: string) => existsViaRead(p, read));
  let specs = await discoverChecks(repoDir, read);
  if (opts.only?.length) specs = specs.filter((s) => opts.only!.includes(s.source as "TEST_RUN" | "STATIC_CHECK"));
  const out: CheckResult[] = [];
  for (const spec of specs) out.push(await runCheck(spec, repoDir, run, canRun, exists));
  return out;
}
