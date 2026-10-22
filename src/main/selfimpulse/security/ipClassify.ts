/**
 * ipClassify — the ONE address-classification policy in the tree.
 *
 * 11.14.4. This module exists because the codebase shipped TWO implementations
 * of the same SSRF policy, and only one of them was correct:
 *
 *   · security/guardrail.ts `checkEgressUrl` — regex/STRING matching, and
 *     reachable from 14 call sites, so it was the de-facto default.
 *   · security/egressNet.ts — correct normalization + IANA classification, and
 *     called from exactly ONE production site.
 *
 * The string policy misses the disguises that matter: `http://[::ffff:a9fe:a9fe]/`
 * is 169.254.169.254 (the cloud metadata endpoint) written in IPv4-mapped IPv6
 * form, and it matched none of the v4 regexes. `http://2852039166/` and
 * `http://0xa9fea9fe/` are the same address as an integer and a hex literal.
 * Because `net.fetch` calls the string policy, the LLM could ask for the
 * metadata endpoint and get the body back in its context.
 *
 * WHY A SEPARATE FILE. `guardrail` must be able to ask "is this host private?"
 * without importing `egressNet`, and `egressNet` already imports
 * `checkEgressUrl` from `guardrail` — so the classifier had to move DOWN into a
 * leaf both can import, rather than one importing the other. No cycle, and
 * there is now exactly one place where a special-purpose range is refused.
 *
 * The `pinnedIp` / DNS-rebinding protection lives in egressNet's
 * `safeEgressFetch`, which is a separate concern: this module answers "is this
 * address safe to talk to", not "can the name be rebound after we check".
 *
 * Pinned by probe/egressNet.test.ts (classification) and
 * probe/guardrail.test.ts (the delegation), so neither policy can drift again
 * without a test failing.
 */

export type IpKind = "ipv4" | "ipv6" | "unknown";

/** Expand any IPv6 textual form to 8 groups of 16 bits, or null if unparseable. */
function expandIpv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone); // drop a zone id — it is not routable data
  if (!s.includes(":")) return null;

  // An embedded IPv4 tail (::ffff:127.0.0.1) becomes two hex groups first.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
  } else if (missing < 0) {
    return null;
  }
  const groups: number[] = [];
  for (const g of head) groups.push(parseInt(g, 16));
  for (let i = 0; i < missing; i += 1) groups.push(0);
  for (const g of rest) groups.push(parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/** Strict dotted-quad IPv4. Rejects integer, octal and hex forms by design. */
function parseIpv4(input: string): number[] | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * True for a bare-integer / octal / hex IPv4 literal like 2130706433 or
 * 0x7f000001 — an IP address written in a disguise that no dotted-quad regex
 * would match, but that the URL stack will happily resolve.
 *
 * Exported because egressNet's `resolveEgress` needs to name this case
 * explicitly: `normalizeHost` returns "unknown" for these (a real DNS name also
 * returns "unknown"), and the refusal should say "that is a disguised address,
 * write it in dotted-quad form" rather than "we could not classify it".
 */
export function isObfuscatedIpv4Literal(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){0,2}$/.test(host)) return true;      // 2130706433, 127.1
  if (/^0[xX][0-9a-fA-F]{1,8}$/.test(host)) return true;       // 0x7f000001
  return false;
}

export interface NormalizedHost {
  kind: IpKind;
  /** Canonical dotted-quad for ipv4, lowercase expanded form for ipv6. */
  ip: string;
  octets?: number[];
  groups?: number[];
}

/**
 * Canonicalize a URL hostname to an address, or report why it is not one.
 * Returns kind "unknown" for a real DNS name (which still needs resolving).
 */
export function normalizeHost(rawHost: string): NormalizedHost {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { kind: "unknown", ip: "" };

  const v4 = parseIpv4(host);
  if (v4) return { kind: "ipv4", ip: v4.join("."), octets: v4 };

  if (host.includes(":")) {
    const groups = expandIpv6(host);
    if (groups) {
      // An IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible address is really an
      // IPv4 address wearing an IPv6 hat. Classify the IPv4 inside it, or every
      // v4 check in the codebase silently stops applying. This is the bug that
      // let http://[::ffff:a9fe:a9fe]/ reach the metadata endpoint.
      const isMapped = groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0);
      if (isMapped) {
        const octets = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
        return { kind: "ipv4", ip: octets.join("."), octets };
      }
      return { kind: "ipv6", ip: groups.map((g) => g.toString(16).padStart(4, "0")).join(":"), groups };
    }
  }

  // A bare integer/octal/hex literal is an IP in disguise. Refuse it rather than
  // letting it through as a "hostname" that some fetch path will happily resolve
  // to loopback or metadata.
  if (isObfuscatedIpv4Literal(host)) return { kind: "unknown", ip: "" };

  return { kind: "unknown", ip: "" };
}

export interface IpClass {
  /** Safe to reach under the product's policy. */
  ok: boolean;
  reason: string;
  /** Coarse bucket, for receipts and for the UI to explain a refusal. */
  scope: "public" | "loopback" | "private" | "link-local" | "metadata" | "special" | "multicast" | "reserved" | "unknown";
}

function classifyV4(o: number[], allowLoopback: boolean): IpClass {
  const [a, b] = o;
  const inCidr = (base: number[], bits: number): boolean => {
    let acc = 0;
    for (let i = 0; i < 4; i += 1) {
      const rem = bits - i * 8;
      const mask = rem <= 0 ? 0 : rem >= 8 ? 0xff : (0xff << (8 - rem)) & 0xff;
      if ((o[i] & mask) !== (base[i] & mask)) return false;
      acc += 1;
      if (acc > 4) break;
    }
    return true;
  };
  const C = (scope: IpClass["scope"], reason: string): IpClass => ({ ok: false, reason, scope });

  if (a === 127) return allowLoopback
    ? { ok: true, reason: "", scope: "loopback" }
    : C("loopback", "loopback address refused (SSRF guard)");
  if (a === 169 && b === 254) {
    if (o[2] === 169 && o[3] === 254) return C("metadata", "cloud metadata endpoint refused (SSRF guard)");
    return C("link-local", "link-local address refused (SSRF guard)");
  }
  if (inCidr([0, 0, 0, 0], 8)) return C("reserved", "this-network address refused (SSRF guard)");
  if (inCidr([10, 0, 0, 0], 8)) return C("private", "private network address refused (SSRF guard)");
  if (inCidr([100, 64, 0, 0], 10)) return C("special", "carrier-grade NAT address refused (SSRF guard)");
  if (inCidr([172, 16, 0, 0], 12)) return C("private", "private network address refused (SSRF guard)");
  if (inCidr([192, 0, 0, 0], 24)) return C("special", "IETF protocol assignment refused (SSRF guard)");
  if (inCidr([192, 0, 2, 0], 24)) return C("special", "documentation range refused (SSRF guard)");
  if (inCidr([192, 88, 99, 0], 24)) return C("special", "6to4 relay anycast refused (SSRF guard)");
  if (inCidr([192, 168, 0, 0], 16)) return C("private", "private network address refused (SSRF guard)");
  if (inCidr([198, 18, 0, 0], 15)) return C("special", "benchmarking range refused (SSRF guard)");
  if (inCidr([198, 51, 100, 0], 24)) return C("special", "documentation range refused (SSRF guard)");
  if (inCidr([203, 0, 113, 0], 24)) return C("special", "documentation range refused (SSRF guard)");
  if (a >= 224 && a <= 239) return C("multicast", "multicast address refused (SSRF guard)");
  if (a >= 240) return C("reserved", "reserved address refused (SSRF guard)");
  return { ok: true, reason: "", scope: "public" };
}

function classifyV6(g: number[], allowLoopback: boolean): IpClass {
  const hex = g.map((x) => x.toString(16).padStart(4, "0")).join(":");
  const C = (scope: IpClass["scope"], reason: string): IpClass => ({ ok: false, reason, scope });
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) {
    return allowLoopback ? { ok: true, reason: "", scope: "loopback" } : C("loopback", "IPv6 loopback refused (SSRF guard)");
  }
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 0) return C("reserved", "unspecified address refused (SSRF guard)");
  if ((g[0] & 0xfe00) === 0xfc00) return C("private", "IPv6 unique-local refused (SSRF guard)");
  if ((g[0] & 0xffc0) === 0xfe80) return C("link-local", "IPv6 link-local refused (SSRF guard)");
  if ((g[0] & 0xff00) === 0xff00) return C("multicast", "IPv6 multicast refused (SSRF guard)");
  if (g[0] === 0x2001 && g[1] === 0x0db8) return C("special", "IPv6 documentation range refused (SSRF guard)");
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address in the low bits.
  if (g[0] === 0x0064 && g[1] === 0xff9b) {
    const octets = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
    const inner = classifyV4(octets, allowLoopback);
    return inner.ok ? inner : C(inner.scope, `NAT64-embedded address refused (SSRF guard): ${inner.reason}`);
  }
  if (g[0] === 0x2002) return C("special", `6to4 address refused (SSRF guard): ${hex}`);
  if (g[0] === 0x2001 && g[1] === 0x0000) return C("special", `Teredo address refused (SSRF guard): ${hex}`);
  return { ok: true, reason: "", scope: "public" };
}

/** Classify a normalized address against the IANA special-purpose registries. */
export function classifyIp(n: NormalizedHost, allowLoopback: boolean): IpClass {
  if (n.kind === "ipv4" && n.octets) return classifyV4(n.octets, allowLoopback);
  if (n.kind === "ipv6" && n.groups) return classifyV6(n.groups, allowLoopback);
  return { ok: false, reason: "address could not be classified", scope: "unknown" };
}

/** Convenience: classify a raw host string. */
export function classifyHost(rawHost: string, allowLoopback = false): IpClass {
  return classifyIp(normalizeHost(rawHost), allowLoopback);
}
