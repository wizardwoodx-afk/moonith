/**
 * §AUDIT SCRUB — secrets never reach the trail. SelfImpulse's lift from the
 * `claw-enterprise` audit package (`packages/audit`, MIT —
 * Copyright (c) 2026 OpenAI; licence text at `LICENSES/claw-enterprise-MIT.txt`).
 *
 * WHAT THE UPSTREAM PROVED, AND WHY WE CARE
 * claw-enterprise's audit sink scrubs EVERY event on its way into storage: a
 * key-shaped value in a free-text field, a `Bearer …` header quoted into a
 * reason, an object member literally named `accessToken`, a control character
 * smuggled into a log line, and a `__proto__` key riding into a parsed-back
 * audit document are all handled BEFORE the event is frozen and appended — not
 * by asking the caller to be careful. That is the posture we need for the same
 * reason: an auditor's trail is a secret store wearing a different hat.
 *
 * WHY THIS IS A RE-EXPRESSION AND NOT A LIFT
 * The upstream file is ~320 lines and the scrubber sits inside it bolted to
 * `AuditEvent`/`AuditEventFactory`/`AuditRecorder`/`InMemoryAuditSink`, whose
 * vocabulary (installationId, namespaceId, iamDriverId, admissionDecisionId,
 * service principals) is that product's multi-tenant server model. SelfImpulse
 * is local-first and has none of those types. Lifting the file would import a
 * shape we do not have. What was adopted is the CONTRACT — key-sensitivity,
 * value-shape scanning, depth/cycle/prototype guards, control-character
 * normalisation, error-reason suppression — written against OUR seams, and
 * extended in one place where upstream is weaker (see CREDENTIAL-BEARING URLS).
 *
 * WHAT ALREADY EXISTED HERE (so this file EXTENDS, never duplicates)
 *   - `src/security/actionGraph.ts` — `DecisionJournal` and the provenance
 *     graph's `detail` map, and the AIR guard trips whose `detail` is built
 *     straight out of a tool's own stdout. Those are the journal seam.
 *   - `src/mission/flightRecorder.ts` — `record()`, the ONE append path every
 *     governed mutation goes through (`reason`, `evidence[]`, `data`), persisted
 *     natively through the IPC layer and replayable by seq. That is the ledger
 *     seam.
 *   - `src/mission/approvals.ts` — gate decisions are flight events
 *     (`APPROVAL_GRANTED` / `APPROVAL_REJECTED`) carrying the human's typed
 *     reason and the ask's evidence lines, so gate text is covered by the
 *     recorder wire rather than by a second path here.
 *   - `src/security/approvalEvidence.ts` deliberately NOT wired. It hashes and
 *     retains the EXACT payload the human was shown; scrubbing what it stores
 *     would move the digest away from what was reviewed and destroy the
 *     drift-detection property that file exists to provide.
 *
 * THE HONESTY RULES
 *   - Scrub is BEST-EFFORT defence in depth, not a licence to log secrets. A
 *     value the shapes do not recognise can still pass. Callers must keep
 *     credentials out of audit text in the first place; this only stops the
 *     accidental and the model-echoed case.
 *   - Ordinary text is left ALONE. This is not a word filter: a reason, a
 *     router decision, a path, a diff stat or a check name reads the same after
 *     scrub as before, because an audit trail that rewrites plain sentences is
 *     worthless to the person reading it at 2am.
 *   - A redaction is visible. The marker says `[redacted]` in place of what was
 *     dropped, so a reader knows something was there rather than believing
 *     nothing was.
 */

/** What a dropped value is replaced with — present, named, and unmistakable. */
export const AUDIT_SCRUB_MARKER = "[redacted]";

/** Ceiling on nesting. A deeper document is refused into the marker rather than
 *  walked, so a pathological payload cannot make the scrubber recurse forever. */
export const AUDIT_SCRUB_MAX_DEPTH = 16;

/* An object member whose NAME says it holds a credential is collapsed whole,
 * however innocent its value looks. `token` and `secret` are in; bare `key` is
 * not, because `key` is what this codebase calls a seat's lookup key, and
 * blanking it would cost the trail its only indexable field.
 *
 * The SAFE-reference tail is upstream's exemption and it earns its keep here:
 * `tokenId`, `subjectId`, `apiKeyName`, `secretRef` are identifiers OF a secret,
 * not the secret, and an auditor needs them to find the row. */
const SENSITIVE_MEMBER =
  /(?:access[_-]?token|api[_-]?key|authorization|auth[_-]?header|bearer|client[_-]?secret|cookie|credential|password|passphrase|private[_-]?key|provider[_-]?(?:credential|token)|refresh[_-]?token|secret|session[_-]?(?:cookie|token)|token|wallet|x-api[-_])$/i;
const SAFE_REFERENCE_TAIL = /(?:ids?|refs?|references?|names?|kinds?|counts?|types?|prefixes)$/i;

/* A property name that must never be re-materialised on parse-back. Upstream
 * drops exactly these three and so do we — the audit document is JSON that a
 * later tool re-reads, and a stored `__proto__` member is a pollution primitive
 * wearing log-entry clothing. */
const UNSAFE_MEMBER = /^(?:__proto__|constructor|prototype)$/;

/* Credential SHAPES found inside free text. Every one of these was chosen
 * because it survives being quoted into a sentence: a human's denial reason, a
 * router's rationale, a tool's stderr tail. This is the class upstream handles
 * with `SENSITIVE_VALUE`, widened to the shapes the models this product talks
 * to actually emit. */
const SECRET_SHAPES: RegExp[] = [
  // any `Authorization`-shaped header line, with or without the header name
  /\bauthor(?:ization|isation)\s*:?\s*\S+|\bcookie\s*:\s*\S+/gi,
  // bearer / basic / digest schemes, quoted with or without their scheme word
  /\b(?:bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  // the long key idioms this product's providers actually issue
  /\b(?:sk|sa|pd|np|sk-proj|sk-svcacct)-[A-Za-z0-9_-]{8,}/gi,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{6,}/gi,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bya29\.[A-Za-z0-9_=-]{10,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  // a signed token, wherever it came from
  /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
  // an inline `key = value` / `token=value` assignment
  /\b(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|password|passwd|pwd|credential|auth[_-]?token)\s*[:=]\s*[^\s,;]{4,}/gi,
  // a PEM private key body
  /-----BEGIN (?:[A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]*)PRIVATE KEY-----/g,
];

/* CREDENTIAL-BEARING URL — `https://user:token@host/path`.
 *
 * Upstream does NOT handle this one, and it is the single most likely secret in
 * a local-first desktop product: the git remote, the model endpoint, the object
 * store DSN all put the credential in the URL, and the tool that failed prints
 * the whole thing into its stderr tail. Handled by name so the host and the
 * path survive — an auditor has to see WHICH remote was being dialled, and the
 * username is kept when there is a password to separate from it, because
 * "who" is an audit fact and "what they proved it with" is not. */
const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@'"]+):([^\s/@'"]+)@/gi;

/** Control characters collapse to a space. They are how one audit line becomes
 *  two in a grep, and how a terminal escape rides out of a tool's stdout into
 *  whatever a human later pipes the trail through. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Scrub one string of everything it may have picked up from an untrusted
 * source. Deterministic, idempotent, and leaves ordinary prose untouched.
 */
export function scrubAuditText(text: string): string {
  if (!text) return text;
  let out = text.replace(CREDENTIAL_URL, (_all, scheme: string, user: string) => `${scheme}${user}:${AUDIT_SCRUB_MARKER}@`);
  for (const shape of SECRET_SHAPES) out = out.replace(shape, AUDIT_SCRUB_MARKER);
  return out.replace(CONTROL_CHARACTER, " ");
}

/** True when a member name says the value under it is a credential. */
export function isSensitiveAuditMember(key: string): boolean {
  return SENSITIVE_MEMBER.test(key) && !SAFE_REFERENCE_TAIL.test(key);
}

/**
 * Scrub any audit-bearing value: a `Record`, an array of evidence lines, a
 * tool's parsed output object, a flight event's `data`.
 *
 * Structural rules, in order, all inherited from the upstream contract:
 *   - past the depth ceiling the value is the marker, not a truncated walk —
 *     a truncated one reads like a complete small object;
 *   - a string goes through `scrubAuditText`;
 *   - a cycle collapses to the marker rather than throwing (an audit event that
 *     cannot be recorded is worse than one recorded with a hole in it);
 *   - a `Date` becomes its ISO form so JSON round-trips keep the shape;
 *   - an `Error` keeps ONLY its name: an Error's message is the most common
 *     carrier of the URL or key that made the call fail;
 *   - a `bigint` is stringified rather than dropped, because the number is the
 *     audit fact and only its type is inconvenient;
 *   - members named after a credential are collapsed whole; unsafe prototype
 *     members are dropped, not scrubbed.
 */
export function scrubAuditValue(value: unknown, visited: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (depth > AUDIT_SCRUB_MAX_DEPTH) return AUDIT_SCRUB_MARKER;
  if (typeof value === "string") return scrubAuditText(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (visited.has(value)) return AUDIT_SCRUB_MARKER;
  visited.add(value);

  if (Array.isArray(value)) return value.map((entry) => scrubAuditValue(entry, visited, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, reason: AUDIT_SCRUB_MARKER };
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value].map(([k, v]) => [String(k), isSensitiveAuditMember(String(k)) ? AUDIT_SCRUB_MARKER : scrubAuditValue(v, visited, depth + 1)]),
    );
  }
  if (value instanceof Set) return [...value].map((v) => scrubAuditValue(v, visited, depth + 1));

  const scrubbed: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (UNSAFE_MEMBER.test(key)) continue;
    scrubbed[key] = isSensitiveAuditMember(key) ? AUDIT_SCRUB_MARKER : scrubAuditValue(entry, visited, depth + 1);
  }
  return scrubbed;
}

/** A `Record<string, string | number | boolean>` scrubbed in place — the shape
 *  `HitlRequest.evidence` and `JournalEntry.evidence` carry. */
export function scrubAuditRecord(evidence: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(evidence)) {
    if (UNSAFE_MEMBER.test(key)) continue;
    out[key] = isSensitiveAuditMember(key)
      ? AUDIT_SCRUB_MARKER
      : typeof entry === "string"
        ? scrubAuditText(entry)
        : entry;
  }
  return out;
}

/** Evidence lines, scrubbed line by line. */
export function scrubAuditLines(lines: readonly string[] | undefined): string[] {
  return (lines ?? []).map(scrubAuditText);
}
