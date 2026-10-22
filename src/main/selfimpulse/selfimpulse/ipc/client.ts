/**
 * SelfImpulse — the native seam (keychain, OS notification, app facts).
 *
 * Present in a NATIVE host: Electron answers through the NAMED methods
 * `electron/preload.cjs` publishes on `window.selfImpulseDesktop`. The web
 * edition sees neither, so every call is guarded and the engine degrades
 * honestly to browser storage / no notification — the same code, two hosts.
 *
 * WHAT CHANGED HERE, AND WHY IT WAS A SECURITY DEFECT. This file used to define
 * "native" as one thing (a single host-marker object existing on the page),
 * and the human approval gate asked it whether to raise an OS notification. The
 * packaged Electron app answered "no" to a question about itself, so the gate
 * that exists to wake a human never woke one on that build — and the same test
 * decided whether the issuer's Ed25519 key went to the OS credential store. The
 * engine also told the model, in its own system prompt, that it was running in a
 * "browser/webview". Host identity is now resolved through the capability
 * matrix (`src/ipc/hostCapabilities.ts`), which asks what this host EXPOSES
 * rather than which shell it belongs to.
 *
 * The native host gives SelfImpulse three things (see the Electron handlers in
 * electron/main.cjs and electron/native/*.cjs):
 *   • secretGet / secretSet — the OS keychain for the Ed25519 issuer key
 *     (service "selfimpulse", ref "selfimpulse.issuerkey.v1"); the key never leaves the
 *     machine, and a memory-only fallback is reported as such. NEVER a plaintext
 *     write: that is the house rule of `src/auth/credentialStore.ts`, and it has
 *     no host name in it.
 *   • notify — an OS notification when a run pauses at the human
 *     gate (the desktop says so even if the window is unfocused)
 *   • info — platform facts for the UI
 */
import { detectHost, electronInfo, electronNotifyBridge, electronSecretBridge } from "../../app/desktop";
import { can, refusal } from "../../ipc/hostCapabilities";

export interface SecretGetResult {
  present: boolean;
  value: string | null;
  /** true only when sealed in the OS keychain; false = process memory (lost at exit) */
  keychain: boolean;
  /** What the host said about where this answer came from. Stated, never invented. */
  warning?: string;
}

export interface SecretSetResult {
  stored: boolean;
  keychain: boolean;
  warning?: string;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  native: boolean;
}

export interface NotifyReceipt {
  sent: boolean;
  via: "electron" | "none";
  reason?: string;
}

/**
 * True when a native desktop shell is attached (Electron).
 *
 * Kept under its old name because callers read it as "is there a host at all",
 * and that question is still exactly what it answers. It is NOT the capability
 * question: for "can this host hold my key / raise an OS notification", use
 * `can("secrets")` / `can("notifications")`, which is what the seams below do.
 * A shell can be present and still expose nothing (an older preload), and the
 * answer to that has to be a refusal in words, not a browser fallback.
 */
export function isNativeHost(): boolean {
  return detectHost() !== "web";
}

export const ipc = {
  /**
   * Read a secret through whichever native seam this host really has.
   *
   * Provider-class references are redacted by the host, not by this file: the
   * Electron main process applies the same rule before the value crosses back
   * (`electron/nativeSecrets.cjs`). A caller that gets `value: null` with
   * `present: true` is reading a real key it is not allowed to see — that is the
   * intended answer, not a failure.
   */
  async secretGet(secretRef: string): Promise<SecretGetResult> {
    const bridge = detectHost() === "electron" && can("secrets") ? electronSecretBridge() : null;
    if (bridge) {
      const r = await bridge.secretGet(secretRef);
      return {
        present: r.present === true,
        value: r.present === true ? r.value : null,
        keychain: r.present === true,
        warning: r.warning,
      };
    }
    // No seam: report an absent key with the reason, rather than throwing a
    // host-specific error string out of an Electron window.
    return { present: false, value: null, keychain: false, warning: refusal("secrets", "Reading the issuer key") };
  },
  async secretSet(secretRef: string, value: string): Promise<SecretSetResult> {
    const bridge = detectHost() === "electron" && can("secrets") ? electronSecretBridge() : null;
    if (bridge) {
      const r = await bridge.secretSet(secretRef, value);
      /* `keychain` is the honest field of the old shape, and it is only ever
       * true when the receipt says the write landed in the OS credential store.
       * A refused write is reported as refused — never as memory-only, which is
       * a claim this seam has no evidence for. */
      return {
        stored: r.stored === true,
        keychain: r.stored === true && r.location === "keychain",
        warning: r.warning,
      };
    }
    return { stored: false, keychain: false, warning: refusal("secrets", "Storing the issuer key") };
  },
  /**
   * Raise the human-gate notification on the desktop.
   *
   * Returns a receipt and never throws: this is called from the approval gate,
   * where a missing notification must not block or fake a human decision. The
   * gate records the receipt so a run can be read afterwards and say whether a
   * person was actually reached.
   */
  async notifyApproval(title: string, body: string): Promise<NotifyReceipt> {
    if (detectHost() === "electron" && can("notifications")) {
      try {
        const r = await electronNotifyBridge()(title, body);
        return r && r.sent
          ? { sent: true, via: "electron" }
          : { sent: false, via: "none", reason: r?.reason ?? "the Electron notification channel reported nothing" };
      } catch (e) {
        return { sent: false, via: "none", reason: `the Electron notification channel failed: ${String(e)}` };
      }
    }
    return { sent: false, via: "none", reason: refusal("notifications") };
  },
  /**
   * Who is running, as the host says.
   *
   * Refuses in words where there is no host to ask, rather than inventing an
   * "AppInfo" for a browser — a UI that printed it would be asserting facts
   * nobody answered.
   */
  async appInfo(): Promise<AppInfo> {
    if (detectHost() === "electron") {
      const info = await electronInfo();
      if (!info) throw new Error(refusal("window", "Asking the Electron shell for its build facts"));
      return {
        name: typeof info.name === "string" ? info.name : "SelfImpulse",
        version: typeof info.version === "string" ? info.version : "unknown",
        platform: typeof info.platform === "string" ? info.platform : "unknown",
        native: true,
      };
    }
    throw new Error(refusal("window", "Asking the host for its build facts"));
  },
};

export {};
