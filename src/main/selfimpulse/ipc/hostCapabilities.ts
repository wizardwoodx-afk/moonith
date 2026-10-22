/**
 * THE DESKTOP CAPABILITY MATRIX — "can this host actually do X?", not "is this
 * host named Tauri?".
 *
 * WHY THIS MODULE EXISTS. `useTauri()` in `src/ipc/client.ts` was `detectHost()
 * === "tauri"`, and every native trust boundary in the app asked *that*
 * question: the OS keychain write, federation, the human-gate notification, the
 * filesystem, git, dialogs. The app has shipped TWO native hosts for a while
 * (Tauri in `src-tauri/`, Electron in `electron/`), and `detectHost()` already
 * returned `"electron"` correctly — so the packaged Electron build answered
 * "no" to every one of them and was treated as a web page at every boundary.
 * The consequence that made this a security bug rather than a cosmetic one:
 * `ipc.secretSet` fell through to `localDb.secretSet`, which writes the
 * provider API key as PLAINTEXT inside the `selfimpulse.v3.db` localStorage
 * blob, and then reported `location: "browser-localStorage"` as if that were a
 * thing a desktop build should do. The house rule in
 * `src/auth/credentialStore.ts` — "NO CREDENTIAL EVER REACHES PLAINTEXT
 * `localStorage` … never a quiet downgrade to a plaintext write" — has no host
 * name in it, and therefore bound the Electron build too.
 *
 * WHY THE ONE-LINE FIX WAS WRONG. Flipping `useTauri()` to also accept
 * `"electron"` breaks the app: `electron/preload.cjs` deliberately exposes a
 * short list of NAMED methods over `contextBridge` and no generic `invoke`
 * escape hatch, so Electron would have started calling Tauri commands that do
 * not exist there (`secret_set`, `a2a_host_start`, `shell_exec`, …). Whether a
 * host can do a thing is a property of what that host EXPOSES, not of which
 * shell it belongs to. That question needs a table, and this is it.
 *
 * HOW EACH ANSWER IS EARNED. Every capability is resolved by probing the real
 * surface — the presence AND TYPE of the specific methods the host publishes —
 * and every default is FALSE. Two consequences of that rule, both deliberate:
 *
 *  · a host that gains a capability must EARN it by shipping the named method
 *    (see `electron/preload.cjs`: `secretSet`, `notify`), and this module then
 *    reports it without being edited again — except to add the new capability
 *    name;
 *  · a host that loses one (an older preload, a partially built shell, a page
 *    that faked the marker object) reports FALSE and its callers refuse in
 *    words. Nothing here infers a capability from a host name, a user agent, or
 *    a `host` string.
 *
 * HONEST LIMITS OF A SHAPE PROBE. Every capability names a distinct method on
 * the Electron preload, so the probe is exact — there is no generic `invoke`
 * channel left in this app that could prove a command family it does not
 * actually carry. A caller must still treat a native refusal at CALL time as
 * the normal case: this table proves the seam exists, the receipt from the seam
 * is what proves the action happened.
 */
import { detectHost, isElectronSurface } from "../app/desktop";

/**
 * Every capability a renderer might want a native host to perform.
 *
 * THE LIST IS THE TYPE. This used to be a hand-written union of string
 * literals beside a hand-written array of the same names, and the two
 * drifted: `providerCall` was in the union, in the method table, and
 * published by the preload — and NOT in the array. The array is what
 * `resolveCapabilities` iterates, so `can("providerCall")` was false on
 * every host, the native provider path in `src/ipc/client.ts` was dead
 * code, and the packaged app could not call a provider at all.
 *
 * Nothing caught it because every check derived its expectations from the
 * same array that was wrong.
 *
 * So the array is the single source of truth and the type is derived from
 * it. A capability that exists in one place exists in the other by
 * construction, and adding a name to the union without adding it to the
 * list is no longer expressible.
 */
export const DESKTOP_CAPABILITIES = [
  /** Read/write/remove in the OS credential store (keychain / Windows Credential Manager). */
  "secrets",
  /** Mount, status and stop of the bundled, supervised A2A host. */
  "federation",
  /** Raise an OS notification that survives an unfocused or hidden window. */
  "notifications",
  /** Read/write the local filesystem through the host. */
  "fs",
  /** Inspect a real repository (status, diff, HEAD, branch, read-only verdict). */
  "git",
  /** Drive the frameless window: minimise, maximise, close, fullscreen, always-on-top. */
  "window",
  /** A native open/save picker the user actually clicked. */
  "dialog",
  /** A blocking native confirmation dialog the page cannot auto-dismiss — the human gate. */
  "confirm",
  /** Run a dev tool under a human-minted, expiring execution grant. */
  "exec",
  /** Bind a provider key to one origin through a native human dialog. */
  "providerBinding",
  /** Make a provider call from the main process, with the key attached there.
   *  The renderer's plaintext never leaves the OS credential store. */
  "providerCall",
  /** The managed engine tier: status and seat execution through the supervised local agent core. */
  "engine",
  /** Drive a real browser through the supervised browser service: sessions, navigation, page verbs. */
  "browser",
  /** The app's own in-process Control MCP server: graph tools that mutate the stored workflow only behind a human grant. */
  "controlMcp",
] as const;

/** Every capability a renderer might want a native host to perform. */
export type DesktopCapability = (typeof DESKTOP_CAPABILITIES)[number];

/** One host's answers, all of them derived, none of them assumed. */
export type CapabilityTable = Record<DesktopCapability, boolean>;

/** The minimum an empty table may claim: nothing. */
const NOTHING: CapabilityTable = DESKTOP_CAPABILITIES.reduce(
  (acc, c) => ({ ...acc, [c]: false }),
  {} as CapabilityTable,
);

/** What a probe may see instead of a live browser `window`. */
export interface HostSurfaceLike {
  selfImpulseDesktop?: Record<string, unknown> | null;
  navigator?: { userAgent?: string };
}

const isFn = (v: unknown): boolean => typeof v === "function";

/** All of these, or none of it counts. A half-built bridge earns nothing. */
const hasAll = (bag: Record<string, unknown>, names: string[]): boolean =>
  names.every((n) => isFn(bag[n]));

/**
 * The Electron method names that prove each capability.
 *
 * Kept as DATA rather than inline `typeof` tests, so `probe/nativeTrustPreload`
 * can assert the two sides agree: every name listed here must be a named method
 * the preload actually publishes, and nothing in the preload may be reachable
 * except through such a name. A drift in either direction fails a probe: a name
 * here with no method there is a capability the app would claim and not have; a
 * method there with no name here is native surface the renderer cannot use.
 */
export const ELECTRON_CAPABILITY_METHODS: Record<DesktopCapability, string[]> = {
  secrets: ["secretSet", "secretGet", "secretHas", "secretRemove"],
  federation: ["federationStatus", "federationMount", "federationStop"],
  notifications: ["notify"],
  fs: ["fsRead", "fsWrite", "fsList", "fsMkdir", "fsRemove"],
  git: ["gitStatus", "gitDiff", "gitHead", "gitBranch", "gitIsRepo", "gitReadOnlyCheck"],
  window: ["minimize", "toggleMaximize", "close", "isMaximized", "setFullscreen", "isFullscreen", "setAlwaysOnTop"],
  dialog: ["openFile"],
  confirm: ["confirmAsk"],
  exec: ["shellExec", "execGrantRequest", "execGrantsStatus", "execGrantsRevoke"],
  providerBinding: ["providerBindEndpoint", "providerEndpointsList", "providerUnbindEndpoint"],
  /* The provider CALL is a separate capability from the BINDING, and it is
   * separate on purpose: a host that can bind an endpoint but cannot make a
   * call would let the user approve a destination and then never use it, and
   * a host that can make a call but cannot bind one would send a key
   * somewhere no human approved. One method, one meaning. */
  providerCall: ["llmChat"],
  engine: ["engineStatus", "engineSeat"],
  /* All ten supervisor verbs, not a subset: a host that can open a session but
   * cannot close it, or can navigate but cannot read the console, is a browser
   * that leaks processes and reports clean pages. `browserStatus` is in the list
   * because "is a browser even attached?" is the question every caller must be
   * able to ask before it believes any other answer. */
  browser: [
    "browserStatus",
    "browserStart",
    "browserStop",
    "browserSessionCreate",
    "browserSessionClose",
    "browserSessions",
    "browserNavigate",
    "browserAct",
    "browserScreenshot",
    "browserConsole",
  ],
  /* All nine channels the Control MCP module registers, not a read-only subset:
   * a host that can list nodes but cannot connect ports is a graph editor that
   * would silently do nothing, which is exactly the V7 bug U this surface was
   * built to stop. `controlMcpTools` and `controlMcpConnectTest` are in the list
   * because "what does this server actually implement?" is the question a caller
   * must be able to ask before it believes any mutation receipt. */
  controlMcp: [
    "controlMcpTools",
    "controlMcpConnectTest",
    "controlMcpCall",
    "controlMcpValidateGraph",
    "controlMcpListNodes",
    "controlMcpConnectPorts",
    "controlMcpDisconnectPorts",
    "controlMcpRunWorkflow",
    "controlMcpCallTool",
  ],
};

/**
 * Resolve one host's table from the surface it publishes.
 *
 * `surface` is optional so the live app reads the real `window` while a probe
 * can hand this function a fake host and pin what it resolves. No branch here
 * consults a host NAME: `detectHost()` is used only to pick which SURFACE to
 * look at, and every capability is then an independent shape test.
 */
export function resolveCapabilities(surface?: HostSurfaceLike | null): CapabilityTable {
  const bag: HostSurfaceLike | null =
    surface !== undefined
      ? surface
      : typeof globalThis.window === "undefined"
        ? null
        : (globalThis.window as unknown as HostSurfaceLike);

  if (!bag) return mainProcessCapabilities();

  const el = isElectronSurface(bag)
    ? bag
    : bag.selfImpulseDesktop;
  // The Electron identity gate is the ONE in `electronSurface()`'s own helper
  // (`isElectronSurface`: marker plus a working window verb, whitelisted by
  // shape). Without it nothing is granted — a plain page that defines
  // `selfImpulseDesktop` gets an all-false table.
  if (isElectronSurface(el)) {
    const out = { ...NOTHING };
    for (const cap of DESKTOP_CAPABILITIES) out[cap] = hasAll(el, ELECTRON_CAPABILITY_METHODS[cap]);
    return out;
  }

  return { ...NOTHING };
}

/** The live table for the host this renderer is running in. */
export function capabilities(): CapabilityTable {
  return resolveCapabilities(liveHostSurface());
}

/**
 * The table for SelfImpulse's main process.
 *
 * There is no `window` here, so the renderer shape tests cannot answer. Each
 * `true` below is a capability this host really implements (see
 * `host/knight.ts`); everything else stays false and its refusal still names
 * the gap. `window`, `dialog`, `confirm`, `browser`, `federation`,
 * `providerBinding` and `controlMcp` are renderer or unimplemented surfaces,
 * so they are NOT claimed.
 */
function mainProcessCapabilities(): CapabilityTable {
  if (typeof process === "undefined" || !process.versions?.electron) return { ...NOTHING };
  return {
    ...NOTHING,
    secrets: true,
    notifications: true,
    fs: true,
    git: true,
    exec: true,
    providerCall: true,
    engine: true,
  };
}

/** The window object as the app sees it, or null outside a renderer (probe runs, Node). */
function liveHostSurface(): HostSurfaceLike | null {
  return typeof globalThis.window === "undefined" ? null : (globalThis.window as unknown as HostSurfaceLike);
}

/**
 * Can this host do X? Defaults to NO on every unknown, including an unknown
 * host, an unknown capability name, and a bridge that threw.
 */
export function can(capability: DesktopCapability): boolean {
  try {
    const table = capabilities();
    return table[capability] === true;
  } catch {
    return false;
  }
}

/** Words for who the app thinks it is running as — used by every refusal. */
export function describeHost(): string {
  switch (detectHost()) {
    case "electron":
      return "the Electron desktop build";
    default:
      return "a browser (there is no desktop shell here)";
  }
}

/** The capabilities this host is missing, in a stable order, for a UI that must say so. */
export function missingCapabilities(table: CapabilityTable = capabilities()): DesktopCapability[] {
  return DESKTOP_CAPABILITIES.filter((c) => table[c] !== true);
}

/**
 * The refusal, in words, naming the host it thinks it is in.
 *
 * This is the whole point of the matrix: a host that cannot do a thing still
 * REFUSES rather than returning an empty result that reads as success, and the
 * sentence is specific enough that a reader can tell "this build has no keychain"
 * from "the keychain refused this write" from "you are in a browser".
 */
export function refusal(capability: DesktopCapability, subject?: string): string {
  const who = describeHost();
  const what = subject ?? CAPABILITY_SUBJECT[capability];
  const native = detectHost() !== "web";
  if (capability === "secrets") {
    return native
      ? `${what}: this is ${who}, and it exposes no OS credential store. Nothing was stored, and nothing was written to browser storage either — a desktop build does not get to downgrade a key to plaintext.`
      : `${what}: ${who} holds no OS credential store, and this app never writes a credential as plaintext into browser storage. Run the desktop build to store a key.`;
  }
  if (capability === "federation") {
    return native
      ? `Federation is a desktop capability that ${who} does not expose: this build carries no supervised A2A host, so nothing was mounted and no port was opened.`
      : "Federation is a desktop capability. This build has no bundled A2A host, so nothing was mounted and no port was opened.";
  }
  if (capability === "notifications") {
    return native
      ? `A notification could not be raised from ${who}: it exposes no native notification channel, so the message stayed in this window.`
      : `A notification cannot be raised from ${who}: the browser's own permission gate decides, and nothing was promised to the user.`;
  }
  if (capability === "browser") {
    /* The sentence has to rule out the one failure this seam is most likely to
     * produce: an empty result that reads as a page. A host with no supervisor
     * did not browse anything, and says so instead of handing back a blank
     * title, a missing screenshot or a session id nobody issued. */
    return native
      ? `${what}: this is ${who}, and it exposes no supervised browser service. Nothing was fetched — no page was opened, no screenshot was saved, no console line was read, and no session id was issued.`
      : `${what}: ${who} has no supervised browser service, and this app never invents a page result to fill the gap. Run the desktop build to browse.`;
  }
  if (capability === "controlMcp") {
    /* The one thing this seam must never produce is a result that reads as a
     * mutation. A host with no Control MCP did not look at the stored graph and
     * did not touch it, and the sentence has to say both halves — the V7 defect
     * (bug U) was exactly a `connect_ports` that echoed its arguments back with
     * `ok: true` while nothing moved. */
    return native
      ? `${what}: this is ${who}, and it exposes no Control MCP server. Nothing was read — no graph was validated, no node was listed — and nothing was changed: no wire was connected or removed and no run was queued.`
      : `${what}: ${who} has no Control MCP server, and this app never echoes a graph result back to fill the gap. Run the desktop build to use the control tools.`;
  }
  return native
    ? `${what} is a desktop capability that ${who} does not expose: nothing was done, and no result here is a stand-in for one.`
    : `${what} needs the native desktop build: ${who} cannot do it, and nothing was faked instead.`;
}

/** What each capability is FOR, in the owner's words — the subject of a refusal. */
const CAPABILITY_SUBJECT: Record<DesktopCapability, string> = {
  secrets: "The provider key",
  federation: "Federation",
  notifications: "The OS notification",
  fs: "The filesystem",
  git: "git",
  window: "The window controls",
  dialog: "A native file picker",
  confirm: "The native confirmation",
  exec: "Running a dev tool",
  providerBinding: "Binding a provider key to an endpoint",
  providerCall: "Making a provider call with the stored key",
  engine: "The managed engine seat",
  browser: "The browser session",
  controlMcp: "The Control MCP graph tools",
};
