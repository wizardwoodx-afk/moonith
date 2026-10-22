/**
 * §WEB EVIDENCE — the control plane's real web-search layer (keyless providers).
 *
 * WHY
 *   The Researcher's contract says "gather sources you can point at, return
 *   (claim, source, confidence) triples". Until now the evidence came from
 *   whatever the harness already knew. The 2026 orchestration landscape treats
 *   grounded retrieval as table stakes, so this module gives the Researcher
 *   live web evidence WITHOUT adding a key requirement and WITHOUT a sidecar:
 *   three CORS-open, keyless providers (Wikipedia, HN Algolia, GitHub
 *   repository search) plus two optional self-configured ones (SearXNG,
 *   Brave) for users who run their own endpoint.
 *
 *   SOURCE-KIND HONESTY (11.9.4-Major+ review fix): every hit carries
 *   `sourceKind` — GitHub repos are PRIMARY (first-party code/docs), Wikipedia
 *   and HN are SECONDARY (they summarize/discuss; useful evidence, never
 *   first-party), search endpoints are META (indexes over the web). The
 *   Researcher reports the kind instead of pretending everything is primary.
 *
 * HONESTY RULES (the same ones the rest of SelfImpulse obeys)
 *   1. A provider that fails (timeout, CORS, HTTP error, not configured) is
 *      reported in `providers` with the reason — never silently dropped.
 *   2. Confidence is computed from measured overlap + recency, bucketed
 *      high/medium/low — a hit that matched one token never claims "high".
 *   3. Nothing here persists, phones home, or runs without the user's node
 *      asking for it: `searchWeb` is only called by agent code paths.
 *   4. The pure core (plan/normalize/dedupe/score/triples) has no network at
 *      all, so probe/webSearch.test.ts exercises it offline with fixtures.
 *   5. A hit is somebody else's sentence. `title` and `snippet` are what a
 *      stranger wrote on a stranger's server, and this report is handed to
 *      agents that put it in front of a model — so it carries an `untrusted`
 *      notice in FRONT of the fields it governs
 *      (`src/security/untrustedContent.ts`). Recognition is not the same as
 *      disclaiming authority: `scanForInjection` can spot an injection-shaped
 *      snippet and still leave the model unable to tell a page from its owner.
 *
 * EGRESS (19.7.16 — how a request is actually made, and why it differs per provider)
 *   `checkEgressUrl` is a HOSTNAME-STRING policy: a DNS name comes back
 *   `scope:"unknown"` and is allowed. That is fine for a constant host and wrong
 *   for a user-supplied one, because a name that is public at check time can be
 *   169.254.169.254 at connect time (DNS rebinding, TOCTOU), and because the old
 *   call site used the platform default redirect policy — so a hostile endpoint
 *   could answer 302 to the metadata service and the client would follow it
 *   without ever coming back through the check.
 *
 *   So the two cases are handled differently, on purpose:
 *
 *   · searxng — the ONLY provider whose host the user controls. Its request goes
 *     through `safeEgressFetch` (security/egressNet): resolve once, classify every
 *     answer, pin the address, follow redirects MANUALLY and re-resolve +
 *     re-classify each hop under a 5-hop budget. Anything it cannot resolve is
 *     refused, never guessed. This is the same call the product already makes for
 *     a self-hosted Ollama endpoint (src/ipc/client.ts:760), with the same
 *     `allowLoopback: true` — a local SearXNG is documented product surface.
 *
 *   · wikipedia / hn / github / brave — constant hosts written in this file. There
 *     is no attacker-chosen DNS name to rebind, so per-hop resolution would buy
 *     nothing; but the redirect hole is closed for free with `redirect:"manual"`,
 *     so a compromised or spoofed upstream cannot steer the client at the metadata
 *     endpoint. A 3xx is reported as an honest failed provider instead of being
 *     followed.
 *
 *   THE BROWSER TRADE-OFF, STATED PLAINLY. `safeEgressFetch` resolves through
 *   node:dns, which does not exist in a browser bundle, and it is built to fail
 *   closed there ("resolved to no addresses — refused rather than guessing"). So on
 *   the web surface a NAMED searxng root is not contacted; an IP-LITERAL root still
 *   works, because a literal has no TOCTOU window and needs no resolver. We chose
 *   that over letting the web surface fetch a name it cannot vet: a provider that
 *   reports why it did not run is honest, a provider that silently skips the check
 *   on one surface is not. The outcome note says which case happened, so it reads
 *   as a decision rather than a mystery.
 *
 * THIS IS THE ONE IMPLEMENTATION (audit M-1). `src/mission/webSearch.ts` used to be a
 * second copy of this module — same ten exports, same provider table, and NONE of the
 * egress hardening above, because it was written down from a revision that predates
 * 19.7.16. Since `src/mission/teamExecutor.ts` imported `./webSearch`, every planner and
 * reviewer run in a team mission was fetching through the unhardened copy: a
 * `169.254.169.254` SearXNG root accepted, default redirects followed, no address
 * resolution. Two copies of one module is not redundancy, it is a place to be wrong
 * twice; the mission path is now a re-export of this file, so the hardening cannot be
 * skipped by picking the other import. Probe `webSearchDrift` pins that there is one
 * implementation and that both paths reach it.
 */

export type WebProviderId = "wikipedia" | "hn" | "github" | "searxng" | "brave";

/** primary = first-party artifact; secondary = summarizes/discusses; meta = index. */
export type SourceKind = "primary" | "secondary" | "meta";

import { checkEgressUrl } from "../../security/guardrail";
import { safeEgressFetch } from "../../security/egressNet";
import { withUntrustedNotice } from "../../security/untrustedContent";

export interface WebProviderSpec {
  id: WebProviderId;
  name: string;
  kind: SourceKind;
  needsConfig: boolean;
  note: string;
  /** Builds the request URL for a query. Config-dependent providers need opts. */
  buildUrl: (query: string, opts?: WebSearchOpts) => string | null;
}

export interface WebSearchOpts {
  /** Self-hosted SearXNG root, e.g. "http://127.0.0.1:8888". */
  searxngRoot?: string;
  /** Brave Search API key (sent as a header by the caller). */
  braveKey?: string;
  /** Injectable fetch for tests / non-browser hosts. */
  fetchImpl?: typeof fetch;
  /** Set false to forbid falling back to the host's global fetch (tests). */
  useGlobalFetch?: boolean;
  /** Per-provider timeout. Default 6000ms. */
  timeoutMs?: number;
}

export interface WebHit {
  url: string;
  title: string;
  snippet: string;
  source: WebProviderId;
  kind: SourceKind;
  /** Publication time when the provider reports one, else null. */
  ts: string | null;
  /** Measured relevance in [0,1] — see scoreHit. */
  score: number;
}

export interface WebProviderOutcome {
  id: WebProviderId;
  ok: boolean;
  hits: number;
  note: string;
}

export interface WebEvidenceReport {
  query: string;
  hits: WebHit[];
  providers: WebProviderOutcome[];
  fetchedAt: string;
  /**
   * Every hit below is text a stranger wrote on a stranger's server. Put FIRST in the
   * object (`withUntrustedNotice`) so a model reading this report meets the disclaimer
   * before the content it governs — see `src/security/untrustedContent.ts`. The `hits`
   * fields are the outside ones; `providers` is this module's own account of what it did,
   * so it is deliberately not listed as untrusted.
   */
  untrusted: string;
}

export interface ClaimTriple {
  claim: string;
  source: string;
  confidence: "high" | "medium" | "low";
  /** primary / secondary / meta — never implied, always stated. */
  kind: SourceKind;
}

export const WEB_PROVIDERS: WebProviderSpec[] = [
  {
    id: "wikipedia",
    name: "Wikipedia (opensearch)",
    kind: "secondary",
    needsConfig: false,
    note: "keyless, CORS-open — primary encyclopedic sources",
    buildUrl: (q) =>
      `https://en.wikipedia.org/w/api.php?action=opensearch&origin=*&format=json&limit=5&search=${encodeURIComponent(q)}`,
  },
  {
    id: "hn",
    name: "Hacker News (Algolia)",
    kind: "secondary",
    needsConfig: false,
    note: "keyless, CORS-open — recent primary discussion + links",
    buildUrl: (q) =>
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=5`,
  },
  {
    id: "github",
    name: "GitHub repository search",
    kind: "primary",
    needsConfig: false,
    note: "keyless unauthenticated repository search — first-party code/docs",
    buildUrl: (q) =>
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5`,
  },
  {
    id: "searxng",
    name: "SearXNG (self-hosted)",
    kind: "meta",
    needsConfig: true,
    note: "user's own metasearch endpoint — keeps queries local-first",
    buildUrl: (q, o) => {
      if (!o?.searxngRoot) return null;
      /* FINALFIX: the user-configured root is still egress-checked — an
       * SSRF-shaped root (metadata endpoint, link-local, non-http scheme)
       * is refused here instead of fetched. This is the STRING half of the
       * gate; the resolved-address half (rebinding, redirects) is in
       * `guardedFetch` below, because a string check cannot see either. */
      const root = o.searxngRoot.replace(/\/$/, "");
      if (!checkEgressUrl(`${root}/search`).ok) return null;
      return `${root}/search?q=${encodeURIComponent(q)}&format=json`;
    },
  },
  {
    id: "brave",
    name: "Brave Search (BYO key)",
    kind: "meta",
    needsConfig: true,
    note: "optional key in Providers — never stored by this module",
    buildUrl: (q, o) =>
      o?.braveKey ? `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5` : null,
  },
];

/** Split a goal into at most `max` search queries. Pure, offline, deterministic. */
export function planQueries(goal: string, max = 3): string[] {
  const parts = goal
    .split(/[\n;。]|\. /)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
    .map((s) => (s.length > 90 ? `${s.slice(0, 90)}…` : s));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : [goal.trim() || ""];
}

/* ── normalizers: provider JSON -> WebHit (pure) ─────────────────────────── */

export function normalizeWikipedia(json: unknown, query: string): WebHit[] {
  // opensearch shape: [query, [titles], [snippets], [urls]]
  if (!Array.isArray(json) || json.length < 4) return [];
  const [, titles, snippets, urls] = json as [string, string[], string[], string[]];
  if (!Array.isArray(titles) || !Array.isArray(urls)) return [];
  return titles.map((title, i) => ({
    url: String(urls[i] ?? ""),
    title: String(title),
    snippet: String(Array.isArray(snippets) ? snippets[i] ?? "" : ""),
    source: "wikipedia" as const,
    kind: "secondary" as const,
    ts: null,
    score: scoreHit({ url: String(urls[i] ?? ""), title: String(title), snippet: String(Array.isArray(snippets) ? snippets[i] ?? "" : ""), source: "wikipedia", kind: "secondary", ts: null }, query),
  })).filter((h) => h.url.length > 0);
}

export function normalizeHn(json: unknown, query: string): WebHit[] {
  const hits = (json as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) return [];
  return hits
    .map((h) => {
      const o = h as { url?: string | null; title?: string | null; story_text?: string | null; created_at?: string | null; objectID?: string };
      const url = o.url ?? (o.objectID ? `https://news.ycombinator.com/item?id=${o.objectID}` : "");
      return {
        url,
        title: String(o.title ?? ""),
        snippet: String(o.story_text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220),
        source: "hn" as const,
        kind: "secondary" as const,
        ts: o.created_at ?? null,
        score: 0,
      };
    })
    .filter((h) => h.url.length > 0)
    .map((h) => ({ ...h, score: scoreHit(h, query) }));
}

export function normalizeGithub(json: unknown, query: string): WebHit[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const o = it as { html_url?: string; full_name?: string; description?: string | null; pushed_at?: string | null };
      return {
        url: String(o.html_url ?? ""),
        title: String(o.full_name ?? ""),
        snippet: String(o.description ?? "").slice(0, 220),
        source: "github" as const,
        kind: "primary" as const,
        ts: o.pushed_at ?? null,
        score: 0,
      };
    })
    .filter((h) => h.url.length > 0)
    .map((h) => ({ ...h, score: scoreHit(h, query) }));
}

/* ── scoring / dedupe / triples (pure) ───────────────────────────────────── */

const SOURCE_PRIOR: Record<WebProviderId, number> = {
  wikipedia: 0.55,
  hn: 0.45,
  github: 0.45,
  searxng: 0.4,
  brave: 0.4,
};

/** Token-overlap relevance with a mild recency boost, anchored on a source prior. */
export function scoreHit(hit: Omit<WebHit, "score">, query: string): number {
  const qTokens = new Set(
    query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3),
  );
  if (qTokens.size === 0) return SOURCE_PRIOR[hit.source] * 0.8;
  const text = `${hit.title} ${hit.snippet}`.toLowerCase();
  let matched = 0;
  for (const t of qTokens) if (text.includes(t)) matched += 1;
  const overlap = matched / qTokens.size;
  let recency = 0;
  if (hit.ts) {
    const ageDays = (Date.now() - Date.parse(hit.ts)) / 86_400_000;
    if (Number.isFinite(ageDays)) recency = ageDays < 7 ? 0.1 : ageDays < 90 ? 0.05 : 0;
  }
  return Math.min(1, 0.35 * overlap + 0.55 * overlap * SOURCE_PRIOR[hit.source] + recency + 0.1 * SOURCE_PRIOR[hit.source]);
}

export function dedupeHits(hits: WebHit[]): WebHit[] {
  const seen = new Set<string>();
  const out: WebHit[] = [];
  for (const h of hits) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    out.push(h);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The Researcher's contract shape: (claim, source, confidence) triples. */
export function toTriples(hits: WebHit[]): ClaimTriple[] {
  return hits.map((h) => ({
    claim: `${h.title}${h.snippet ? ` — ${h.snippet}` : ""}`.slice(0, 280),
    source: h.url,
    confidence: h.score >= 0.55 ? "high" : h.score >= 0.3 ? "medium" : "low",
    kind: h.kind,
  }));
}

/* ── the guarded request (19.7.16) ────────────────────────────────────────── */

/**
 * ONE provider, TWO enforcement paths — the split is the design; see the header.
 *
 * `USER_CHOSEN` is the set of providers whose host a person typed. For those,
 * `safeEgressFetch` resolves and re-classifies the address and follows redirects
 * by hand, so a name cannot turn into a link-local address between the check and
 * the connect, and a 302 cannot walk the client somewhere unvetted. For every
 * other provider the host is a constant in this file, so there is no name to
 * rebind and `redirect: "manual"` closes the only remaining hole.
 *
 * Nothing here can widen what is reachable: `safeEgressFetch` re-runs
 * `checkEgressUrl` on every hop, and `allowLoopback: true` is required for the
 * documented self-hosted SearXNG (a loopback metasearch is product surface, not
 * an oversight).
 */
const USER_CHOSEN: ReadonlySet<WebProviderId> = new Set<WebProviderId>(["searxng"]);

async function guardedFetch(
  id: WebProviderId,
  url: string,
  init: RequestInit,
  doFetch: typeof fetch,
): Promise<Response> {
  if (USER_CHOSEN.has(id)) {
    return safeEgressFetch(url, {
      ...init,
      fetchImpl: doFetch,
      allowLoopback: true,
      maxRedirects: 5,
    });
  }
  // `manual` is load-bearing: the platform default follows redirects, and a hop
  // followed by the client never comes back through the policy.
  return doFetch(url, { ...init, redirect: "manual" });
}

/**
 * A `buildUrl` of null means two very different things, and rule 1 of this module
 * is that a provider which fails says WHY. A configured SearXNG root that the
 * egress guard refuses is not "not configured" — it is a refusal, and saying so is
 * the difference between a fixable setting and a mystery.
 */
function notConfiguredNote(p: WebProviderSpec, opts: WebSearchOpts): string {
  if (p.id === "searxng" && opts.searxngRoot) {
    const verdict = checkEgressUrl(`${opts.searxngRoot.replace(/\/$/, "")}/search`);
    return verdict.ok
      ? "egress guard produced no url for this root"
      : `egress refused: ${verdict.reason} — nothing was sent`;
  }
  return "not configured";
}

/* ── the orchestrator ─────────────────────────────────────────────────────── */

export async function searchWeb(query: string, opts: WebSearchOpts = {}): Promise<WebEvidenceReport> {
  const doFetch = opts.fetchImpl ?? (opts.useGlobalFetch === false ? undefined : typeof fetch === "function" ? fetch : undefined);
  const timeoutMs = opts.timeoutMs ?? 6000;
  const outcomes: WebProviderOutcome[] = [];
  const hits: WebHit[] = [];

  if (!doFetch) {
    return withUntrustedNotice(
      {
        query,
        hits: [],
        providers: WEB_PROVIDERS.map((p) => ({ id: p.id, ok: false, hits: 0, note: "no fetch available in this host" })),
        fetchedAt: new Date().toISOString(),
      },
      "web search result",
      ["hits"],
    );
  }

  await Promise.all(
    WEB_PROVIDERS.map(async (p) => {
      const url = p.buildUrl(query, opts);
      if (url === null) {
        outcomes.push({ id: p.id, ok: false, hits: 0, note: p.needsConfig ? notConfiguredNote(p, opts) : "no url" });
        return;
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await guardedFetch(
          p.id,
          url,
          { signal: ctl.signal, headers: p.id === "github" ? { Accept: "application/vnd.github+json" } : undefined },
          doFetch,
        );
        // A 3xx on a constant-host provider is no longer followed, so it is named
        // for what it is rather than reported as a bare status.
        if (res.status >= 300 && res.status <= 399) {
          outcomes.push({ id: p.id, ok: false, hits: 0, note: `http ${res.status} redirect not followed (egress guard)` });
          return;
        }
        if (!res.ok) {
          outcomes.push({ id: p.id, ok: false, hits: 0, note: `http ${res.status}` });
          return;
        }
        const json: unknown = await res.json();
        const norm =
          p.id === "wikipedia" ? normalizeWikipedia(json, query)
          : p.id === "hn" ? normalizeHn(json, query)
          : p.id === "github" ? normalizeGithub(json, query)
          : [];
        hits.push(...norm);
        outcomes.push({ id: p.id, ok: true, hits: norm.length, note: "ok" });
      } catch (e) {
        // An egress refusal is a DECISION, not a network flake, so it is reported
        // in the words the guard used — "resolved to no addresses" and "egress
        // refused" are the difference between a fixable configuration and a bug.
        const msg =
          e instanceof Error && e.name === "AbortError"
            ? `timeout ${timeoutMs}ms`
            : e instanceof Error && /egress refused/.test(e.message)
              ? e.message.slice(0, 200)
              : "network/cors";
        outcomes.push({ id: p.id, ok: false, hits: 0, note: msg });
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return withUntrustedNotice(
    { query, hits: dedupeHits(hits), providers: outcomes, fetchedAt: new Date().toISOString() },
    "web search result",
    ["hits"],
  );
}
