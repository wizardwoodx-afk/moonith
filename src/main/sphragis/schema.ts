/**
 * Sphragis (σφραγίς, "seal") — the signed action-receipt layer.
 *
 * A receipt is evidence, not authority. It records that an action was
 * attempted, under which authorization, with what outcome — signed by a key
 * the renderer and the model never see. Two receipts bracket every
 * high-impact action:
 *
 *   intent  — written BEFORE the side effect: who asked, under which
 *             governance decision, with which approval, and a digest of the
 *             arguments. An intent records an AUTHORIZATION, never a result.
 *   result  — written AFTER: the measured outcome and a digest of the
 *             result. A result without a preceding intent is refused.
 *
 * RAW CONTENT NEVER ENTERS A RECEIPT. Arguments and results are reduced to
 * SHA-256 digests at the boundary; the receipt carries hashes, ids and
 * outcomes. That is what makes a receipt safe to hand to an auditor or a
 * SIEM without shipping the user's work along with it.
 *
 * The chain links every receipt to the one before it (prev/hash), and each
 * receipt carries its own issuer public key, so verification needs nothing
 * but the file. A stripped signature, an edited field, a reordered line or
 * a missing intent all fail verification, each with the reason it failed.
 *
 * The design reference (Agent Receipts / Obsigna, MIT) is recorded in
 * THIRD-PARTY-NOTICES.md; no upstream code is used.
 */
import { createHash } from 'node:crypto'
import type { ActionIds } from '../nomos/types'

export const RECEIPT_FORMAT = 'si-action-receipt/1'

export type ReceiptKind = 'intent' | 'result'

export type ReceiptOutcome = 'success' | 'failure' | 'denied' | 'unknown'

export type Reversibility = 'reversible' | 'compensating' | 'irreversible'

/** The authorization a receipt attests to — the governance decision, plus
 *  the human approval when a steered action was approved. */
export interface ReceiptAuthorization {
  decision: 'allow' | 'steer' | 'deny'
  rule: string
  reason: string
  approvedBy: string | null
  approvedAt: string | null
}

export interface ActionReceipt {
  format: typeof RECEIPT_FORMAT
  kind: ReceiptKind
  /** Position in this journal's chain. */
  seq: number
  ts: string
  ids: ActionIds
  /** The action class (the capability the gate resolved). */
  action: string
  /** The tool name as the caller knows it. */
  tool: string
  /** SHA-256 of the canonical arguments. Never the arguments themselves. */
  inputDigest: string
  authorization: ReceiptAuthorization
  /** Result receipts only. */
  outcome?: ReceiptOutcome
  resultDigest?: string | null
  reversibility?: Reversibility | null
  prev: string
  hash: string
  /** Hex Ed25519 signature over `hash`; null when this runtime cannot sign. */
  signature: string | null
  /** Present exactly when signature is null: what happened, honestly. */
  signatureNote?: string | null
  /** The issuer's identity — carried on every receipt so the chain can be
   *  verified with the file alone. */
  issuer: { keyId: string; publicKeyHex: string } | null
}

/** Deterministic canonical form: keys sorted recursively. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

/** The digest of any JSON-able value — how arguments and results enter a
 *  receipt: hashed, never stored. */
export function digestOfValue(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

/** The fields the hash covers: everything that identifies and describes the
 *  action, chained to the previous receipt. `hash`, `signature` and the
 *  signature note are excluded — they ARE the cover. */
export function receiptBody(receipt: ActionReceipt): Omit<ActionReceipt, 'hash' | 'signature' | 'signatureNote'> {
  const {
    hash: _hash,
    signature: _signature,
    signatureNote: _note,
    ...body
  } = receipt
  return body
}

export function receiptHash(receipt: ActionReceipt): string {
  return createHash('sha256').update(canonicalJson(receiptBody(receipt)), 'utf8').digest('hex')
}

/** Which actions carry a receipt barrier. High-impact means: it executes
 *  something, or it is high-risk (recursive delete and friends). Everything
 *  else is journaled by the governance record alone — a receipt for every
 *  read would be noise, and noise is how audit trails get ignored. */
export function requiresReceipt(input: {
  sideEffect: 'none' | 'read' | 'write' | 'execute' | 'network'
  risk: 'low' | 'medium' | 'high'
}): boolean {
  return input.sideEffect === 'execute' || input.risk === 'high'
}

export const UNSIGNED_NOTE =
  'This runtime could not sign receipts (the OS keychain is unavailable). The chain is still tamper-evident, but authorship is not attested.'
