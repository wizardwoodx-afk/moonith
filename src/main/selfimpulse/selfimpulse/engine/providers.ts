/**
 * VH 16.10.0 — FEATURE 1 (founder redesign): UNIVERSAL MODEL PROVIDERS.
 *
 * Not a local-only brain: the user brings ANY major provider — ChatGPT
 * (OpenAI), Claude (Anthropic), Gemini, Groq, OpenRouter, Ollama (local), or
 * any OpenAI-compatible endpoint — and the brain routes steps across them by
 * TIER: a cheap model for routine steps, a big one for hard steps.
 *
 * WORK · MANAGE · MONITOR (the founder's three verbs):
 *   WORK    — chatStep() runs one tiered, labeled call through the existing
 *             governed boundary (ipc.llmChat).
 *             The web edition keeps its honest split: Ollama runs for real,
 *             cloud providers refuse in words (the web host does not hold
 *             cloud keys — the boundary `ipc/client.ts` already states).
 *   MANAGE  — the provider REGISTRY (any provider, BYOK via the local secret
 *             store — keys are NEVER in the registry) + per-tier ROUTING the
 *             user sets + pingProvider() health checks.
 *   MONITOR — the USAGE LEDGER: every call records provider, model, tier,
 *             latency, tokens, ok/refused; usageSummary() aggregates ok-rate,
 *             avg/p95 latency, per-provider counts and ESTIMATED cost (only
 *             when a price is known — estimates are labeled, never silent).
 *
 * Refusals come in words (no route · disabled · key missing · call failed ·
 * empty answer). OFF by default (`vh.brain.model`) — a human turns it on.
 */
import { ipc } from "../../host/ipcMain";
import { nodeStorage } from "../../host/knight";
import { localDb } from "../../ipc/localDb";
import { detectHost } from "../../app/desktop";
import type { SelfImpulsePlan } from "./selfimpulse";

/* ── the registry (MANAGE) ────────────────────────────────────────────────── */

export type ProviderKind = "openai" | "anthropic" | "google" | "groq" | "openrouter" | "ollama" | "custom";

export interface ProviderEntry {
  id: string; // stable slug, e.g. "openai-main"
  kind: ProviderKind;
  label: string;
  /** Override endpoint (required for "custom"; optional for groq/openrouter/ollama). */
  baseUrl?: string;
  defaultModel: string; // e.g. gpt-4o-mini, claude-sonnet-4, llama3.1:8b
  enabled: boolean;
}

const REGISTRY_KEY = "vh.providers";
type Store = Storage | Map<string, string>;
/** The one KV shape the registry reads/writes. 16.10.2 (external review): the
 * default browser path used to CAST localStorage to a Map and call .get/.set —
 * a real Storage speaks getItem/setItem, so the UI's listProviders() threw,
 * was caught, and showed [] while addProvider() could throw outright. */
type ProviderKV = { get(k: string): string | null; set(k: string, v: string): void };
function asKV(store: Store): ProviderKV {
  if (typeof (store as Storage).getItem === "function") {
    const ls = store as Storage;
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v) };
  }
  const m = store as Map<string, string>;
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}
const memStore = new Map<string, string>();
const defaultStore = (): Store =>
  (globalThis.localStorage ??
    (typeof process !== "undefined" && process.versions?.electron
      ? (nodeStorage as unknown as Store)
      : memStore)) as Store;

export function listProviders(store: Store = defaultStore()): ProviderEntry[] {
  try {
    const raw = asKV(store).get(REGISTRY_KEY);
    return raw ? (JSON.parse(raw) as ProviderEntry[]) : [];
  } catch { return []; }
}
function saveProviders(list: ProviderEntry[], store: Store): void {
  asKV(store).set(REGISTRY_KEY, JSON.stringify(list));
}
export function addProvider(p: Omit<ProviderEntry, "enabled">, store: Store = defaultStore()): ProviderEntry | { error: string } {
  if (!p.id.trim() || !p.label.trim() || !p.defaultModel.trim()) return { error: "provider needs id, label and a default model — refused." };
  if (p.kind === "custom" && !p.baseUrl) return { error: "a custom provider needs its endpoint URL — refused." };
  const list = listProviders(store);
  if (list.some((x) => x.id === p.id)) return { error: `provider id "${p.id}" already exists — refused.` };
  const entry: ProviderEntry = { ...p, enabled: true };
  list.push(entry);
  try { saveProviders(list, store); } catch (e) { return { error: `provider store refused the write: ${(e as Error).message} — nothing was silently dropped.` }; }
  return entry;
}
export function updateProvider(id: string, patch: Partial<ProviderEntry>, store: Store = defaultStore()): { ok: boolean; refused?: string } {
  const list = listProviders(store);
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, refused: `unknown provider "${id}".` };
  list[i] = { ...list[i], ...patch, id }; // id is immutable
  try { saveProviders(list, store); } catch (e) { return { ok: false, refused: `provider store refused the write: ${(e as Error).message} — the change was not saved.` }; }
  return { ok: true };
}
export function removeProvider(id: string, store: Store = defaultStore()): { ok: boolean } {
  try { saveProviders(listProviders(store).filter((x) => x.id !== id), store); } catch { return { ok: false }; }
  localDb.secretDelete(keyRef(id));
  return { ok: true };
}

/** BYOK: the key lives in the local secret store (localDb), never in the registry. */
export const keyRef = (providerId: string): string => `vh.providerkey.${providerId}`;
export function setProviderKey(providerId: string, apiKey: string, kind?: ProviderKind): { ok: boolean; refused?: string } {
  if (!apiKey.trim()) return { ok: false, refused: "empty key — refused (clear it with removeProviderKey instead)." };
  // 16.10.1 (external review): the web edition no longer holds cloud keys AT
  // ALL. Browser localStorage is readable by anything in this origin — the old
  // flow stored a cloud key there and then refused to use it, which was
  // storage risk with zero benefit. The honest split, in this build:
  //   cloud keys → refused in words; nothing is written to page storage.
  //   ollama     → local only, kept in this app's own store.
  if (kind !== "ollama" && detectHost() === "web") {
    return {
      ok: false,
      refused:
        "the web edition cannot hold cloud keys — browser storage is readable by anything in this origin. " +
        "The DESKTOP build stores your key in the OS keychain and runs every provider; on the web, " +
        "SelfImpulse is Ollama/local-only. Refused in words, nothing stored.",
    };
  }
  localDb.secretSet(keyRef(providerId), apiKey.trim());
  return { ok: true };
}
export function removeProviderKey(providerId: string): void { localDb.secretDelete(keyRef(providerId)); }
export function providerHasKey(providerId: string): boolean {
  return Boolean(localDb.secretGet(keyRef(providerId)));
}
export function providerKeyStatus(providerId: string, kind: ProviderKind): "set" | "not-needed" | "missing" {
  if (kind === "ollama") return "not-needed";
  return providerHasKey(providerId) ? "set" : "missing";
}

/* ── tier routing (MANAGE) ────────────────────────────────────────────────── */

export type ModelTier = "cheap" | "big";
export interface ModelRoute { providerId: string; model: string }
export interface ModelPrefs { enabled: boolean; cheap?: ModelRoute; big?: ModelRoute }
const PREFS_KEY = "vh.brain.model";
export const defaultModelPrefs = (): ModelPrefs => ({ enabled: false });

export function modelPrefs(store: Store = defaultStore()): ModelPrefs {
  try {
    const raw = asKV(store).get(PREFS_KEY);
    if (!raw) return defaultModelPrefs();
    const p = JSON.parse(raw) as ModelPrefs;
    return { enabled: p.enabled === true, cheap: p.cheap, big: p.big };
  } catch { return defaultModelPrefs(); }
}
export function setModelPrefs(p: ModelPrefs, store: Store = defaultStore()): void {
  try {
  asKV(store).set(PREFS_KEY, JSON.stringify(p));
  } catch { /* non-persistent host: prefs stay session-only, the card re-reads the truth */ }
}
export const tierFor = (mode: "quick" | "deep"): ModelTier => (mode === "deep" ? "big" : "cheap");

/* ── the call boundary (WORK) ─────────────────────────────────────────────── */

export interface LlmCallRequest {
  provider: string; base_url?: string; model: string;
  messages: Array<{ role: string; content: string }>;
  system?: string; max_tokens?: number; temperature?: number; secret_ref: string;
}
export interface LlmCallResponse { content: string; model: string; usage: { input_tokens: number; output_tokens: number }; duration_ms: number }
export type LlmCaller = (req: LlmCallRequest) => Promise<LlmCallResponse>;

/** Production caller: the existing governed IPC boundary (desktop → Rust; web → Ollama or an honest refusal). */
export const ipcCaller: LlmCaller = (req) => ipc.llmChat(req) as Promise<LlmCallResponse>;

export const PLANNER_SYSTEM =
  "You are the planner inside SelfImpulse's governed brain. Answer with 3 to 6 concrete steps, one per line, no preamble or markdown. The runtime simulates risky steps and pauses them at a human gate — propose honestly.";

export type ModelCallResult =
  | { ok: true; text: string; provider: string; kind: ProviderKind; model: string; tier: ModelTier; durationMs: number; tokensIn: number; tokensOut: number }
  | { ok: false; refused: string };

/**
 * One tiered, labeled, recorded call — the WORK verb.
 * Resolves the tier route → the provider → calls through the boundary →
 * records usage. Every refusal is in words and still lands in the ledger.
 */
export async function chatStep(prompt: string, tier: ModelTier, opts?: { prefs?: ModelPrefs; caller?: LlmCaller; store?: Store }): Promise<ModelCallResult> {
  const prefs = opts?.prefs ?? modelPrefs(opts?.store);
  if (!prefs.enabled) {
    const refused = "model routing is OFF — a human enables it (System → Model providers); never a silent provider call.";
    recordUsage({ ok: false, refused, ts: new Date().toISOString(), }, opts?.store);
    return { ok: false, refused };
  }
  const route = tier === "cheap" ? prefs.cheap : prefs.big;
  if (!route) {
    const refused = `no ${tier}-tier route configured — refusing rather than silently spending the other tier.`;
    recordUsage({ ok: false, refused, ts: new Date().toISOString(), }, opts?.store);
    return { ok: false, refused };
  }
  const provider = listProviders(opts?.store).find((x) => x.id === route.providerId);
  if (!provider) {
    const refused = `route names unknown provider "${route.providerId}" — fix the routing in System → Model providers.`;
    recordUsage({ ok: false, refused, ts: new Date().toISOString(), }, opts?.store);
    return { ok: false, refused };
  }
  if (!provider.enabled) {
    const refused = `provider "${provider.label}" is disabled — enable it or re-route this tier.`;
    recordUsage({ ok: false, refused, ts: new Date().toISOString(), }, opts?.store);
    return { ok: false, refused };
  }
  const keyStatus = providerKeyStatus(provider.id, provider.kind);
  if (keyStatus === "missing") {
    const refused = `provider "${provider.label}" has no API key set — add it in System → Model providers (BYOK; the key never enters the registry).`;
    recordUsage({ ok: false, refused, ts: new Date().toISOString(), }, opts?.store);
    return { ok: false, refused };
  }
  const t0 = Date.now();
  try {
    const r = await (opts?.caller ?? ipcCaller)({
      provider: provider.kind,
      base_url: provider.baseUrl,
      model: route.model || provider.defaultModel,
      messages: [{ role: "user", content: prompt }],
      system: PLANNER_SYSTEM,
      temperature: 0.2,
      secret_ref: keyRef(provider.id),
    });
    const text = String(r.content ?? "").trim();
    const durationMs = r.duration_ms || Date.now() - t0;
    if (!text) {
      const refused = `${provider.label}:${route.model} returned an empty answer — nothing is invented to fill it.`;
      recordUsage({ ok: false, refused, ts: new Date().toISOString(), providerId: provider.id, providerLabel: provider.label, kind: provider.kind, model: route.model, tier, durationMs, }, opts?.store);
      return { ok: false, refused };
    }
    recordUsage({ ok: true, ts: new Date().toISOString(), providerId: provider.id, providerLabel: provider.label, kind: provider.kind, model: r.model || route.model, tier, durationMs, tokensIn: r.usage?.input_tokens ?? 0, tokensOut: r.usage?.output_tokens ?? 0, }, opts?.store);
    return { ok: true, text, provider: provider.id, kind: provider.kind, model: r.model || route.model, tier, durationMs, tokensIn: r.usage?.input_tokens ?? 0, tokensOut: r.usage?.output_tokens ?? 0 };
  } catch (e) {
    const refused = `${provider.label}:${route.model} refused in words: ${String((e as Error)?.message ?? e)} — no fake answer is manufactured.`;
    recordUsage({ ok: false, refused, ts: new Date().toISOString(), providerId: provider.id, providerLabel: provider.label, kind: provider.kind, model: route.model, tier, durationMs: Date.now() - t0, }, opts?.store);
    return { ok: false, refused };
  }
}

/** Health check (MANAGE): a real 1-token round-trip, latency reported. */
export async function pingProvider(providerId: string, opts?: { caller?: LlmCaller; store?: Store }): Promise<{ ok: boolean; detail: string; latencyMs?: number }> {
  const provider = listProviders(opts?.store).find((x) => x.id === providerId);
  if (!provider) return { ok: false, detail: `unknown provider "${providerId}".` };
  const r = await chatStep("Reply with the single word: pong.", "cheap", { ...opts, prefs: { enabled: true, cheap: { providerId, model: provider.defaultModel } } });
  return r.ok ? { ok: true, detail: `${provider.label}:${r.model} answered in ${r.durationMs}ms`, latencyMs: r.durationMs } : { ok: false, detail: r.refused };
}

/* ── the usage ledger + summary (MONITOR) ─────────────────────────────────── */

export interface UsageRecord {
  ts: string;
  providerId?: string; providerLabel?: string; kind?: ProviderKind; model?: string; tier?: ModelTier;
  ok: boolean; durationMs?: number; tokensIn?: number; tokensOut?: number; refused?: string;
}
const USAGE_KEY = "vh.provider.usage";
const USAGE_CAP = 400;

export function recordUsage(r: UsageRecord, store: Store = defaultStore()): void {
  try {
    const list = listUsage(store);
    list.push(r);
    asKV(store).set(USAGE_KEY, JSON.stringify(list.slice(-USAGE_CAP)));
  } catch { /* non-persistent host */ }
}
export function listUsage(store: Store = defaultStore()): UsageRecord[] {
  try { return JSON.parse(asKV(store).get(USAGE_KEY) ?? "[]") as UsageRecord[]; } catch { return []; }
}
export function clearUsage(store: Store = defaultStore()): void { asKV(store).set(USAGE_KEY, "[]"); }

/** Rough public pricing (USD per 1M tokens, in/out) — ESTIMATES, labeled as such. */
const PRICE_TABLE: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /gpt-4o-mini/i, in: 0.15, out: 0.6 },
  { match: /gpt-4o(?!-mini)/i, in: 2.5, out: 10 },
  { match: /gpt-4\.1-mini/i, in: 0.4, out: 1.6 },
  { match: /gpt-4\.1(?!-mini)/i, in: 2, out: 8 },
  { match: /claude-.*haiku/i, in: 0.8, out: 4 },
  { match: /claude-.*sonnet/i, in: 3, out: 15 },
  { match: /claude-.*opus/i, in: 15, out: 75 },
  { match: /gemini-.*flash/i, in: 0.15, out: 0.6 },
  { match: /gemini-.*pro/i, in: 1.25, out: 10 },
  { match: /llama|mistral|qwen|phi|gemma/i, in: 0, out: 0 }, // local = ₹0
];
export function estCostUsd(model: string | undefined, tokensIn: number, tokensOut: number): number | null {
  if (!model) return null;
  const row = PRICE_TABLE.find((p) => p.match.test(model));
  if (!row) return null;
  return (tokensIn / 1e6) * row.in + (tokensOut / 1e6) * row.out;
}

export interface UsageSummary {
  total: number; ok: number; refused: number; okRate: number;
  avgLatencyMs: number | null; p95LatencyMs: number | null;
  tokensIn: number; tokensOut: number;
  estCostUsd: number | null; // null when no priced model was used (nothing estimated)
  perProvider: Array<{ provider: string; calls: number; ok: number; avgLatencyMs: number | null }>;
  recentRefusals: string[];
}

export function usageSummary(store: Store = defaultStore()): UsageSummary {
  const all = listUsage(store);
  const ok = all.filter((r) => r.ok);
  const latencies = ok.map((r) => r.durationMs ?? 0).sort((a, b) => a - b);
  const pick = (q: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] : null);
  const byProvider = new Map<string, { calls: number; ok: number; lat: number[] }>();
  for (const r of all) {
    const key = r.providerLabel ?? r.providerId ?? "(unrouted)";
    const rec = byProvider.get(key) ?? { calls: 0, ok: 0, lat: [] as number[] };
    rec.calls++;
    if (r.ok) { rec.ok++; rec.lat.push(r.durationMs ?? 0); }
    byProvider.set(key, rec);
  }
  let est = 0;
  let priced = false;
  for (const r of ok) {
    const c = estCostUsd(r.model, r.tokensIn ?? 0, r.tokensOut ?? 0);
    if (c != null) { est += c; priced = true; }
  }
  return {
    total: all.length,
    ok: ok.length,
    refused: all.length - ok.length,
    okRate: all.length ? ok.length / all.length : 0,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    p95LatencyMs: pick(0.95),
    tokensIn: ok.reduce((a, r) => a + (r.tokensIn ?? 0), 0),
    tokensOut: ok.reduce((a, r) => a + (r.tokensOut ?? 0), 0),
    estCostUsd: priced ? Math.round(est * 10000) / 10000 : null,
    perProvider: [...byProvider.entries()].map(([provider, v]) => ({ provider, calls: v.calls, ok: v.ok, avgLatencyMs: v.lat.length ? Math.round(v.lat.reduce((a, b) => a + b, 0) / v.lat.length) : null })),
    recentRefusals: all.filter((r) => !r.ok && r.refused).slice(-3).map((r) => r.refused as string),
  };
}

/* ── the brain wrapper ────────────────────────────────────────────────────── */

export function planFromModelText(text: string, max = 6): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 3).slice(0, max);
}

/**
 * Wrap a brain so the PLAN step rides the user's routed models (ChatGPT,
 * Claude, local…) when enabled. Refusals keep the base plan and say why.
 * IDENTITY IS TRUTHFUL: live getters — enabled names the hybrid, disabled
 * keeps the base identity.
 */
export function wrapModelBrain(base: import("./selfimpulse").SelfImpulseBrain, opts?: { prefs?: ModelPrefs; caller?: LlmCaller; store?: Store }): import("./selfimpulse").SelfImpulseBrain {
  const enabled = () => (opts?.prefs ?? modelPrefs(opts?.store)).enabled;
  return {
    get id() { return enabled() ? "simulated+model-plan" : base.id; },
    get label() {
      return enabled()
        ? "Simulated core + user-routed models (ChatGPT / Claude / Gemini / Groq / Ollama / custom) — cheap tier for routine steps, big tier for hard ones; refusals in words, never faked"
        : base.label;
    },
    async decide(input, ctx) {
      const plan = await base.decide(input, ctx);
      const prefs = opts?.prefs ?? modelPrefs(opts?.store);
      if (!prefs.enabled) return plan;
      const tier = tierFor(ctx.mode);
      const r = await chatStep(input.slice(0, 400), tier, opts);
      if (!r.ok) {
        return { ...plan, thoughts: [`model routing: ${r.refused}`, ...plan.thoughts] };
      }
      const steps = planFromModelText(r.text);
      if (steps.length === 0) {
        return { ...plan, thoughts: [`model routing: ${r.provider}:${r.model} answered but produced no parseable steps — the base plan stands.`, ...plan.thoughts] };
      }
      return {
        ...plan,
        thoughts: [`brain: REAL model — ${r.provider}:${r.model} (${r.tier} tier) answered in ${r.durationMs}ms · labeled, this run · still gated by the same human gate`, ...plan.thoughts],
        plan: steps,
        confidence: "medium",
      } satisfies SelfImpulsePlan;
    },
  };
}
