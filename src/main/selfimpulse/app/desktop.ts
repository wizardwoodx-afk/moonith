/* SelfImpulse runs this engine in the MAIN process. When there is no
 * `window`, these primitives are answered by the Electron host directly. */
import {
  knightAppInfo,
  knightNotify,
  knightSecretDelete,
  knightSecretExists,
  knightSecretGet,
  knightSecretSet
} from "../host/knight";

export type DesktopHost = "electron" | "web";

/**
 * What one native secret call reported. Mirrors the receipt `secret_set` gives
 * back on the Rust side, restricted to the two answers an Electron host can
 * honestly give: it either wrote to the OS credential store, or it wrote
 * nothing at all. `"browser-localStorage"` is deliberately NOT expressible
 * here — a native shell that could not reach the keychain must say so, not
 * quietly relocate the key into the webview's storage.
 */
export interface NativeSecretWrite {
  stored: boolean;
  location: "keychain" | "absent";
  survivesRestart: boolean;
  warning?: string;
}

export interface NativeSecretRead {
  ref: string;
  present: boolean;
  /** null for a provider key on every native host: the page names a key, it does not read one. */
  value: string | null;
  redacted?: boolean;
  hint?: string | null;
  warning?: string;
}

/** The remove receipt: `removed` is what the credential store actually answered. */
export interface NativeSecretRemove {
  removed: boolean;
  warning?: string;
}

export interface NativeSecretStatus {
  exists: boolean;
  location: "keychain" | "absent";
  survivesRestart: boolean;
  warning?: string;
}

export interface NativeNotifyReceipt {
  sent: boolean;
  supported: boolean;
  reason?: string;
}

/** The M-7 report: whether this window's renderer actually has the Chromium sandbox. */
export interface NativeHostStatus {
  host: "electron";
  sandboxEnabled: boolean;
  /** true when the sandbox had to be dropped to make the window open at all. */
  sandboxDegraded: boolean;
  sandboxReason: string;
  sandboxAttempts: Array<{ label: string; ok: boolean; detail: string }>;
  secretStore: string;
  pid: number | null;
}

/**
 * The surface `electron/preload.cjs` exposes on the renderer's window.
 *
 * Which members are OPTIONAL is the design, not an oversight: the members that
 * prove the bridge is a desktop shell (`host`, `minimize`) are required, and
 * every member that PROVES A CAPABILITY is optional so that callers are forced
 * by the type to ask the capability matrix before using it. A required
 * `secretSet` would let code compile against a preload that does not ship it —
 * which is precisely how the packaged app ended up calling Tauri commands that
 * do not exist on this host.
 */
interface ElectronBridge {
  host: "electron";
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  setFullscreen: (v: boolean) => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  setAlwaysOnTop: (v: boolean) => Promise<void>;
  /** Build and runtime identity for the About surface. */
  info?: () => Promise<Record<string, unknown>>;
  openExternal?: (url: string) => Promise<boolean>;
  openFile?: (filters?: unknown) => Promise<unknown>;
  // ---- capabilities the Electron shell now earns natively (see electron/main.cjs) ----
  secretSet?: (ref: string, value: string) => Promise<NativeSecretWrite>;
  secretGet?: (ref: string) => Promise<NativeSecretRead>;
  secretHas?: (refs: string[]) => Promise<Record<string, NativeSecretStatus>>;
  secretRemove?: (ref: string) => Promise<NativeSecretRemove>;
  notify?: (title: string, body: string) => Promise<NativeNotifyReceipt>;
  hostStatus?: () => Promise<NativeHostStatus>;
  /** Re-run the install-directory ACL grant; on success the main process reopens the window WITH the sandbox. */
  retrySandbox?: () => Promise<NativeHostStatus>;
}

/** The one identity gate for the Electron shell: the marker AND a working window verb. */
export function isElectronSurface(bag: unknown): bag is Record<string, unknown> {
  if (!bag || typeof bag !== "object") return false;
  const b = bag as Record<string, unknown>;
  // Whitelisted by SHAPE, not by name: a page that happens to define
  // `selfImpulseDesktop` with the wrong shape is not a desktop host, and
  // trusting the property alone would let any web page claim native rights.
  return b.host === "electron" && typeof b.minimize === "function";
}

/** The shell surface, or null when this renderer is not the Electron host. */
function electronBridge(): ElectronBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  // The preload names this surface `selfImpulseDesktop`; older harnesses and direct
  // injections (including the secret-seam probe) put the same marker on `window`.
  const raw = w as { selfImpulseDesktop?: unknown };
  const b = isElectronSurface(w) ? w : raw.selfImpulseDesktop;
  return isElectronSurface(b) ? (b as unknown as ElectronBridge) : null;
}

/**
 * The Electron bridge, for the capability matrix.
 *
 * Returned as an open bag on purpose: `hostCapabilities.ts` asks "is
 * `secretSet` a function?" and must be able to ask about a member the type does
 * not know yet, without a cast at every call site. Every consumer that wants to
 * CALL something goes through one of the narrowed accessors below instead.
 */
export function electronSurface(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const bag = (window as unknown as { selfImpulseDesktop?: unknown }).selfImpulseDesktop;
  return isElectronSurface(bag) ? bag : null;
}

const isFn = (v: unknown): boolean => typeof v === "function";

/** The four secret verbs, all present or none of them trusted. */
export type ElectronSecrets = {
  secretSet: (ref: string, value: string) => Promise<NativeSecretWrite>;
  secretGet: (ref: string) => Promise<NativeSecretRead>;
  secretHas: (refs: string[]) => Promise<Record<string, NativeSecretStatus>>;
  secretRemove: (ref: string) => Promise<NativeSecretRemove>;
};

/** The native secret store, ONLY when this host really exposes all four verbs. */
export function electronSecretBridge(): ElectronSecrets | null {
  const b = electronBridge();
  if (b) {
    const s = b as unknown as Partial<ElectronSecrets>;
    if (!isFn(s.secretSet) || !isFn(s.secretGet) || !isFn(s.secretHas) || !isFn(s.secretRemove)) return null;
    return s as ElectronSecrets;
  }
  // Main process: the OS keychain is reached through Electron, not a window.
  if (typeof window === "undefined" && inElectronMain()) {
    return {
      secretSet: async (ref, value) => knightSecretSet(ref, value),
      secretGet: async (ref) => {
        const value = knightSecretGet(ref);
        return { ref, present: value !== null, value, redacted: false };
      },
      secretHas: async (refs) => knightSecretExists(refs),
      secretRemove: async (ref) => knightSecretDelete(ref),
    };
  }
  return null;
}

/** The native notification verb, ONLY when this host really exposes it. */
export function electronNotifyBridge(): (title: string, body: string) => Promise<NativeNotifyReceipt> {
  const b = electronBridge();
  if (b && typeof b.notify === "function") {
    const notify = b.notify;
    return (title, body) => notify(title, body);
  }
  if (typeof window === "undefined" && inElectronMain()) {
    return async (title, body) => knightNotify(title, body);
  }
  throw new Error("this Electron build exposes no notification channel");
}

/** Build and runtime identity from the Electron shell, or null when it cannot answer. */
export async function electronInfo(): Promise<Record<string, unknown> | null> {
  const b = electronBridge();
  if (b && typeof b.info === "function") {
    try {
      return await b.info();
    } catch {
      return null;
    }
  }
  if (typeof window === "undefined" && inElectronMain()) return knightAppInfo();
  return null;
}

/** The M-7 sandbox report, or null when the host cannot answer the question. */
export async function electronHostStatus(): Promise<NativeHostStatus | null> {
  const b = electronBridge();
  if (!b || typeof b.hostStatus !== "function") return null;
  try {
    return await b.hostStatus();
  } catch {
    return null;
  }
}

/** Re-attempt the install-directory grant and reopen the window sandboxed if it now works. */
export async function electronRetrySandbox(): Promise<NativeHostStatus | null> {
  const b = electronBridge();
  if (!b || typeof b.retrySandbox !== "function") return null;
  try {
    return await b.retrySandbox();
  } catch {
    return null;
  }
}

/**
 * Whether the app is running inside the desktop shell.
 *
 * The ONE identity gate is the Electron preload surface (`selfImpulseDesktop`,
 * proved by shape in `isElectronSurface`), so this cannot report a desktop host
 * for a page that merely defines a look-alike object, and cannot miss the real
 * shell either. Failing to detect the shell must not happen silently — the
 * window is frameless and the app draws its own controls — so the check is
 * written to be hard to get wrong rather than to be clever.
 */
export function detectHost(): DesktopHost {
  if (typeof window === "undefined") {
    return inElectronMain() ? "electron" : "web";
  }
  if (electronBridge()) return "electron";
  return "web";
}

/** True when this module is executing inside Electron's main process. */
function inElectronMain(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.electron);
}

export function detectPlatform(): "mac" | "win" | "linux" {
  if (typeof navigator === "undefined") {
    return process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "win";
  return "linux";
}

export interface WindowApi {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  startDragging: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (v: boolean) => Promise<boolean>;
  setAlwaysOnTop: (v: boolean) => Promise<void>;
}

export async function getWindowApi(): Promise<WindowApi> {
  const el = electronBridge();
  if (el) {
    return {
      minimize: () => el.minimize(),
      toggleMaximize: () => el.toggleMaximize(),
      close: () => el.close(),
      // The frameless Electron window is dragged by a `-webkit-app-region:
      // drag` header the main process injects, so there is no drag IPC here.
      startDragging: async () => {},
      // Fullscreen reads the NATIVE state, not `document.fullscreenElement`:
      // the button toggles the OS window state, and a renderer-side check can
      // never see it — the two answers would disagree and the button state
      // would go stale, which is the "the fullscreen button is broken" bug.
      isFullscreen: () => el.isFullscreen(),
      setFullscreen: (v) => el.setFullscreen(v),
      setAlwaysOnTop: (v) => el.setAlwaysOnTop(v),
    };
  }
  return {
    minimize: async () => {
      document.body.classList.toggle("desk-min", true);
    },
    toggleMaximize: async () => {
      document.body.classList.toggle("desk-max");
    },
    close: async () => {
      window.close();
    },
    startDragging: async () => {},
    isFullscreen: async () => Boolean(document.fullscreenElement),
    setFullscreen: async (v) => {
      if (v) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
      return Boolean(document.fullscreenElement);
    },
    setAlwaysOnTop: async () => {},
  };
}

/**
 * Raise a notification about this app from outside the window.
 *
 * Two seams, and they are NOT the same thing:
 *
 *  · a native shell that exposes `notify` hands the message to the OS, which is
 *    the only way a notification survives an unfocused or hidden window (and the
 *    only way the human approval gate reaches a person who walked away);
 *  · a browser can raise a `Notification` too, but only with the page's
 *    permission and only while the page is alive — a different promise, so it is
 *    a different branch, not a fallback that pretends to be the first one.
 *
 * The return value is a receipt, not a promise of what the user did with it:
 * `via: "none"` means no notification was raised, and the caller can say so.
 * Before this, the Electron build took the browser branch for a *native*
 * affordance and nothing in the app could tell the difference.
 */
export async function notifyNative(title: string, body: string): Promise<{ sent: boolean; via: "electron" | "browser" | "none"; reason?: string }> {
  const el = electronBridge();
  if (el && typeof el.notify === "function") {
    try {
      const r = await el.notify(title, body);
      return r && r.sent
        ? { sent: true, via: "electron" }
        : { sent: false, via: "none", reason: r?.reason ?? "the native notification channel reported nothing" };
    } catch (e) {
      return { sent: false, via: "none", reason: `the native notification channel failed: ${String(e)}` };
    }
  }
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
      return { sent: true, via: "browser" };
    }
    if ("Notification" in window && Notification.permission !== "denied") {
      const p = await Notification.requestPermission();
      if (p === "granted") {
        new Notification(title, { body });
        return { sent: true, via: "browser" };
      }
      return { sent: false, via: "none", reason: `the browser refused notification permission (${p})` };
    }
    return { sent: false, via: "none", reason: "the browser refused notification permission" };
  } catch (e) {
    return { sent: false, via: "none", reason: String(e) };
  }
}

export function downloadText(filename: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.selfimpulse.json,.mjpack"; // .mjpack kept: legacy pack import compatibility
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch {
          resolve(null);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}
