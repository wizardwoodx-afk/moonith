/**
 * egressNet — DNS- and IP-aware egress enforcement.
 *
 * WHY THIS EXISTS. `checkEgressUrl` is a hostname-STRING policy. That is a
 * necessary first gate and it is not sufficient: OWASP's SSRF guidance is
 * explicit that hostname checks are bypassable through DNS rebinding, redirect
 * chains and alternate IP representations, and that the real control is to
 * validate the RESOLVED address and pin it. Two live holes proved that here:
 *
 *   1. IPv4-mapped IPv6. `http://[::ffff:a9fe:a9fe]/` is 169.254.169.254 — the
 *      cloud metadata endpoint — written in the mapped form. The string policy's
 *      IPv6 checks match only /^(fc|fd)/ and /fe80:/, so this passed as "an
 *      ordinary IPv6 host". Shipped, reachable, and it is the SSRF the whole
 *      guard exists to stop.
 *   2. DNS rebinding (TOCTOU). A hostname that resolves public at check time
 *      and private at connect time defeats any string policy. This is
 *      CVE-2025-69660 (simstudioai/sim) and CVE-2026-64849 (MLflow) in the wild.
 *
 * WHAT THIS DOES. It adds the three layers OWASP asks for that a string check
 * cannot provide:
 *
 *   1. normalize()  — canonicalize a host to a real IP, unwrapping IPv4-mapped
 *                     and IPv4-embedded IPv6, and rejecting bare integer /
 *                     octal / hex IPv4 forms.
 *   2. classifyIp() — classify that IP against the IANA special-purpose
 *                     registries (loopback, RFC1918, CGNAT, link-local, IETF
 *                     protocol assignments, multicast, reserved, NAT64, v4-mapped).
 *   3. safeEgressFetch() — resolve ONCE, classify, pin the answer, and re-run
 *                     the whole policy on every redirect hop with redirects
 *                     disabled at the client (OWASP: "Disable HTTP redirections").
 *
 * LOOPBACK STAYS ALLOWED, deliberately. A local Ollama and a self-hosted
 * gateway are documented, consented product surface, and `checkEgressUrl` has
 * always allowed them. The native provider path therefore passes
 * `allowLoopback`, and the web/browser fetch paths do not need to. This mirrors
 * the existing policy — it does not quietly widen or narrow what the product
 * can reach.
 *
 * FAIL-CLOSED. A hostname that resolves to BOTH a public and a private address
 * is refused. A resolver that throws is refused. An IP we cannot parse is
 * refused. "I could not tell" is never "yes".
 */

import { checkEgressUrl } from "./guardrail";
import {
  classifyHost,
  classifyIp,
  isObfuscatedIpv4Literal,
  normalizeHost,
  type IpClass,
  type IpKind,
  type NormalizedHost,
} from "./ipClassify";

/* 11.14.4 — normalization and classification moved to ./ipClassify so that
   `checkEgressUrl` (14 call sites) and this module run ONE policy instead of
   two that could disagree. They re-exported rather than being rewritten, so
   every existing import — and probe/egressNet.test.ts — keeps working. */

/* ── 1. normalization ─────────────────────────────────────────────────────── */

/** @deprecated imported from ./ipClassify; re-exported for existing callers. */
export type { IpClass, IpKind, NormalizedHost };
export { classifyHost, classifyIp, normalizeHost };


/* ── 3. resolution + redirect-safe fetch ──────────────────────────────────── */

export type Resolver = (hostname: string) => Promise<string[]>;

const systemResolver: Resolver = async (hostname) => {
  const dns = await import("node:dns/promises").catch(() => null);
  if (!dns) return [];
  const out: string[] = [];
  try {
    for (const r of await dns.lookup(hostname, { all: true, verbatim: true })) out.push(r.address);
  } catch { /* resolved below as a failure */ }
  return out;
};

export interface EgressDecision {
  ok: boolean;
  reason: string;
  /** The address the caller must connect to. Pinning this closes the rebinding window. */
  pinnedIp?: string;
  scope?: IpClass["scope"];
  /** `pinned` says whether the transport actually connected to that
   *  address. `false` means the platform fetch ran and the name was
   *  resolved a second time — which the record must not hide. */
  hops?: { url: string; ip: string; status: number; pinned?: boolean }[];
}

/**
 * Resolve once, classify every answer, and pin the winner.
 *
 * Fails closed: a name that resolves to BOTH a public and a non-public address
 * is refused, because an attacker who controls the name controls which address
 * the client happens to pick.
 */
export async function resolveEgress(
  raw: string,
  opts: { allowLoopback?: boolean; resolve?: Resolver } = {},
): Promise<EgressDecision> {
  const allowLoopback = opts.allowLoopback ?? false;
  const resolve = opts.resolve ?? systemResolver;

  // The string policy still runs first — it owns scheme and suffix policy.
  const base = checkEgressUrl(raw);
  if (!base.ok) return { ok: false, reason: base.reason };

  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");

  // Literal address: no DNS involved, so the TOCTOU question does not arise.
  const literal = normalizeHost(host);
  if (literal.kind !== "unknown") {
    const cls = classifyIp(literal, allowLoopback);
    return cls.ok
      ? { ok: true, reason: "", pinnedIp: literal.ip, scope: cls.scope }
      // Name the address we actually refused, not the disguise it was written as.
      : { ok: false, reason: `${literal.ip} — ${cls.reason}`, scope: cls.scope };
  }
  if (literal.ip === "" && isObfuscatedIpv4Literal(host.toLowerCase())) {
    return { ok: false, reason: `obfuscated IP literal "${host}" refused — write the address in dotted-quad form`, scope: "unknown" };
  }

  let answers: string[];
  try {
    answers = await resolve(host);
  } catch (e) {
    return { ok: false, reason: `DNS resolution failed for "${host}": ${e instanceof Error ? e.message : String(e)}` };
  }
  if (answers.length === 0) return { ok: false, reason: `"${host}" resolved to no addresses — refused rather than guessing`, scope: "unknown" };

  const seen: string[] = [];
  let pinned: { ip: string; scope: IpClass["scope"] } | null = null;
  for (const a of answers) {
    const n = normalizeHost(a);
    const cls = classifyIp(n, allowLoopback);
    if (!cls.ok) {
      return { ok: false, reason: `"${host}" resolves to ${n.ip || a} — ${cls.reason}`, scope: cls.scope };
    }
    seen.push(n.ip || a);
    if (!pinned) pinned = { ip: n.ip || a, scope: cls.scope };
  }
  return { ok: true, reason: "", pinnedIp: pinned!.ip, scope: pinned!.scope, hops: [{ url: raw, ip: pinned!.ip, status: 0 }] };
}

const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Is this an IPv6 literal? Used to tell the transport's `lookup` callback
 * which address family the pinned address is. Kept local so this module
 * needs no `node:net` (which the browser aliases to a throwing stub).
 */
function ipFamily(ip: string): 4 | 6 {
  return ip.includes(":") ? 6 : 4;
}

/**
 * THE PINNED TRANSPORT.
 *
 * The DNS-rebinding window is a TOCTOU: the name is resolved and classified
 * at check time, and the transport resolves it AGAIN at connect time. If the
 * two answers differ — public at check, loopback at connect — the check was
 * decoration.
 *
 * Node's `http.request`/`https.request` accept a `lookup` option, so the
 * connection can be told to use the address that was ALREADY CLASSIFIED,
 * while the `Host` header and the TLS servername stay the original name.
 * The transport never resolves the name a second time, so the window is
 * closed rather than narrowed.
 *
 * Returns null when this host cannot pin (a browser has no socket to pin
 * with, and no DNS to resolve with). The caller then falls back to the
 * platform fetch and says so — the hop record carries `pinned: false`, so
 * the audit trail states which transport actually ran.
 */
/**
 * What a pin attempt produced.
 *
 * The three cases are DIFFERENT and the difference matters:
 *
 *  · `pinned` — the request went to the classified address. The control
 *    worked.
 *  · `unavailable` — this host has no socket and no DNS to pin with (a
 *    browser). Nothing was attempted, so the platform fetch is the honest
 *    transport and the hop says `pinned: false`.
 *  · `failed` — a pin WAS attempted and did not work. The name was already
 *    resolved and classified, and the transport could not reach that exact
 *    address. Falling back to the platform fetch here would resolve the
 *    name a SECOND time — which is the exact rebinding window the pin
 *    exists to close. So this case refuses.
 */
type PinResult =
  | { kind: "pinned"; response: Response }
  | { kind: "unavailable" }
  | { kind: "failed"; reason: string };

/** The slice of Node's request object this transport actually uses. */
interface PinnedRequest {
  on: (e: string, cb: (...a: never[]) => void) => void;
  destroy: () => void;
  write: (s: string) => void;
  end: () => void;
}

async function pinnedNodeFetch(rawUrl: string, pinnedIp: string, init: RequestInit): Promise<PinResult> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { kind: "failed", reason: "the URL could not be parsed" };
  }
  const isHttps = u.protocol === "https:";
  const mod = isHttps
    ? await import("node:https").catch(() => null)
    : await import("node:http").catch(() => null);
  if (!mod || typeof mod.request !== "function") return { kind: "unavailable" };

  /* An IPv6 literal arrives from the URL parser WITH ITS BRACKETS —
     `new URL("https://[::1]/").hostname` is `"[::1]"`. Node's own
     `urlToHttpOptions` strips them; a hand-written request option does
     not, and a bracketed hostname is a malformed connect target and a
     malformed TLS servername. Strip them here, and keep the brackets only
     in the URL itself. */
  const connectHost = u.hostname.replace(/^\[|\]$/g, "");

  const headers: Record<string, string> = {};
  const rawHeaders = init.headers;
  if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
    for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
      if (typeof v === "string") headers[k.toLowerCase()] = v;
    }
  }
  /* The Host header stays the NAME: that is what the server routes on and
   * what the certificate is checked against. The ADDRESS is what we connect
   * to. */
  headers.host = u.host;

  const bodyText = typeof init.body === "string" ? init.body : undefined;

  return await new Promise<PinResult>((resolve) => {
    let settled = false;
    const finish = (value: PinResult): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      /* A SYNCHRONOUS throw from `request` means this host has no socket to
         pin with — that is what the browser stub does, and the stub says so
         in its own header: the failure is meant to read as "this host cannot
         pin an address" so the caller can fall back to the platform fetch and
         state that fact. A pin that was attempted and FAILED is a different
         thing entirely: that arrives asynchronously as a socket error, and it
         refuses. */
      let req: PinnedRequest;
      try {
        req = mod.request({
        protocol: u.protocol,
        hostname: connectHost,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: init.method ?? "GET",
        headers,
        /* SNI: the certificate is checked against the NAME, not the
         * address, so TLS still verifies. */
        servername: isHttps ? connectHost : undefined,
        /* THE PIN. The transport asks for the address of a name it is
         * already connecting to; this is where the name stops being
         * resolved.
         *
         * The callback MUST honour `options.all`. Node sets it by default
         * (`autoSelectFamily` is on since Node 20), and when it is set
         * Node expects the ARRAY form — `cb(null, [{address, family}])`.
         * Handing it a bare string instead throws
         * `ERR_INVALID_IP_ADDRESS` inside Node, the request errors, and
         * every pinned request fell through to the unpinned fallback. The
         * pin was decoration: the control the module is built around had
         * never once applied. */
        lookup: (
          _hostname: string,
          options: unknown,
          callback: (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
        ) => {
          const family = ipFamily(pinnedIp);
          const wantsAll = Boolean((options as { all?: boolean } | undefined)?.all);
          if (wantsAll) {
            (callback as unknown as (e: Error | null, a: Array<{ address: string; family: number }>) => void)(null, [
              { address: pinnedIp, family },
            ]);
            return;
          }
          (callback as unknown as (e: Error | null, a: string, f: number) => void)(null, pinnedIp, family);
        },
        }) as unknown as PinnedRequest;
      } catch {
        /* No socket on this host. The browser stub throws here by name. */
        finish({ kind: "unavailable" });
        return;
      }
      if (init.signal) {
        const signal = init.signal;
        if (signal.aborted) {
          req.destroy();
          finish({ kind: "failed", reason: "the request was aborted before it was sent" });
          return;
        }
        signal.addEventListener("abort", () => req.destroy(), { once: true });
      }
      req.on("error", (e: Error) =>
        finish({ kind: "failed", reason: `the connection to the pinned address failed: ${e?.message ?? String(e)}` }),
      );
      req.on("response", (res: { statusCode?: number; statusMessage?: string; headers: Record<string, string | string[] | undefined>; on: (e: string, cb: (c: Buffer) => void) => void }) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            const outHeaders = new Headers();
            for (const [k, v] of Object.entries(res.headers ?? {})) {
              if (typeof v === "string") outHeaders.set(k, v);
              else if (Array.isArray(v)) for (const one of v) outHeaders.append(k, one);
            }
            finish({
              kind: "pinned",
              response: new Response(text, { status: res.statusCode ?? 502, statusText: res.statusMessage ?? "", headers: outHeaders }),
            });
          } catch {
            finish({ kind: "failed", reason: "the response could not be read" });
          }
        });
      });
      if (bodyText !== undefined) req.write(bodyText);
      req.end();
    } catch (e) {
      finish({ kind: "failed", reason: `the pinned request could not be made: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
}

export interface SafeEgressInit extends RequestInit {
  fetchImpl?: typeof fetch;
  allowLoopback?: boolean;
  resolve?: Resolver;
  maxRedirects?: number;
  /** Force the pinned transport off, even where the host has one. Used by
   *  the probe that proves the fallback is honest. */
  allowUnpinned?: boolean;
}

/**
 * A fetch that OWASP's SSRF guidance accepts: redirects are followed manually,
 * every hop is re-resolved and re-classified, and the address decided at check
 * time is the address handed to the transport.
 */
export async function safeEgressFetch(raw: string, init: SafeEgressInit = {}): Promise<Response> {
  const { fetchImpl, allowLoopback, resolve, maxRedirects, allowUnpinned, ...rest } = init;
  const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!doFetch) throw new Error("no fetch available in this runtime — nothing was executed");

  const hops: EgressDecision["hops"] = [];
  let current = raw;

  for (let hop = 0; hop <= (maxRedirects ?? DEFAULT_MAX_REDIRECTS); hop += 1) {
    const decision = await resolveEgress(current, { allowLoopback, resolve });
    if (!decision.ok) {
      throw new Error(`egress refused at hop ${hop}: ${decision.reason} — nothing further was sent.`);
    }
    // `manual` is load-bearing: an auto-following client would reach an
    // unvetted hop without ever coming back through this loop.
    /* THE PIN. Where the host can connect to the address that was just
       classified, it does — and the transport never resolves the name
       again, which is what closes the rebinding window. Where it cannot
       (a browser has no DNS and no socket to pin with), the platform fetch
       runs and the hop says `pinned: false`, so the record states which
       transport actually carried the request.

       AND WHERE THE PIN WAS ATTEMPTED AND FAILED, THE REQUEST DOES NOT GO
       OUT AT ALL. Falling back to the platform fetch there would resolve
       the name a SECOND time — which is precisely the rebinding window
       the pin exists to close. A control that fails open is not a
       control. So a failed pin is a refusal, in words, and nothing is
       sent. */
    let res: Response | null = null;
    let pinned = false;
    const host = new URL(current).hostname.replace(/^\[|\]$/g, "");
    /* AN INJECTED TRANSPORT IS THE TRANSPORT.
     *
     * `fetchImpl` is how the product's own seams take a caller-supplied
     * transport (the tool context, the QA harness, a probe double). Pinning
     * past it would ignore the caller's fetch and open a real socket to an
     * address the caller never handed us — the check would still run, but
     * the request would not be the one that was asked for. So a pin is only
     * for the platform fetch, and a caller who supplies one gets exactly
     * what they supplied, with the hop record saying `pinned: false`. */
    if (!fetchImpl && !allowUnpinned && decision.pinnedIp && decision.pinnedIp !== host) {
      const attempt = await pinnedNodeFetch(current, decision.pinnedIp, { ...rest, redirect: "manual" });
      if (attempt.kind === "pinned") {
        res = attempt.response;
        pinned = true;
      } else if (attempt.kind === "failed") {
        throw new Error(
          `egress refused at hop ${hop}: the classified address ${decision.pinnedIp} could not be reached (${attempt.reason}) — nothing further was sent, because falling back would resolve the name again and reopen the rebinding window.`,
        );
      }
      /* `unavailable` — this host cannot pin at all. The platform fetch
         runs and the hop says so. */
    }
    if (!res) {
      res = await doFetch(current, { ...rest, redirect: "manual" });
      pinned = false;
    }
    hops.push({ url: current, ip: decision.pinnedIp ?? "", status: res.status, pinned });

    const location = res.headers.get("location");
    if (!location || res.status < 300 || res.status > 399) {
      Object.defineProperty(res, "egressHops", { value: hops, enumerable: false });
      return res;
    }
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new Error(`egress refused: hop ${hop} returned an unparseable Location — nothing further was sent.`);
    }
    if (hop === (maxRedirects ?? DEFAULT_MAX_REDIRECTS)) {
      throw new Error(`egress refused: more than ${maxRedirects ?? DEFAULT_MAX_REDIRECTS} redirects — possible redirect loop.`);
    }
    current = next;
  }
  throw new Error("egress refused: redirect budget exhausted.");
}
