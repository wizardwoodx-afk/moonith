/**
 * VH 16.10.0 — FEATURE 3: THE SKILL STORE (imported skills re-prove themselves).
 *
 * The 16.8 capability genome already has the ladder (OBSERVED → … → ACTIVE) —
 * and since 16.10.1 an import MUTATES a real GenomeRegistry (persisted), not just a return label:
 * four hard gates, auto-rollback and signed portable packages. What it lacked:
 * a place to GET packages from and an import path. This module is both:
 *
 *   - a SMALL SIGNED CATALOG format (`si-skill-catalog/1`) — entries carry the
 *     signed capability package + provenance (mission id, verifying seats);
 *   - `importFromCatalog` — verifies the catalog signature AND the package
 *     digest, then lands the skill in a NON-ACTIVE state (trust is re-earned
 *     on this machine: shadow first, small trial, auto-rollback — the
 *     genome's own law). A tampered catalog is refused in words.
 *
 * Signing rides the SAME Ed25519 issuer keychain as receipts; the unsigned
 * path is stated, never faked.
 */
import { signHexDigest, verifyIssuerSignature, type IssuerSignature } from "./signing";
import { GenomeRegistry, GenomeStatus, CapabilityGenome, newGenome, registerGenome, latestVersion } from "./genome";
import { localDb } from "../../ipc/localDb";
import { ENGINE_VERSION } from "../../version";

export interface CatalogSkill {
  id: string;
  title: string;
  /** What it does, in words. */
  objective: string;
  /** Trigger pattern (the genome's replay-gate text). */
  when: string;
  /** The genome's procedure steps. */
  steps: string[];
  /** Real provenance: the mission that proved it + verifying seats. */
  provenance: { missionId: string; verifiedSeats: string[]; version: string };
}

export interface SkillCatalog {
  format: "si-skill-catalog/1";
  issuedAt: string;
  skills: CatalogSkill[];
  digest: string; // sha256 over the canonical skills array
  signature: IssuerSignature | null; // stated when the issuing host had no key
}

const te = new TextEncoder();
export async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", te.encode(s) as unknown as BufferSource);
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function buildCatalog(skills: CatalogSkill[]): Promise<SkillCatalog> {
  const digest = await sha256hex(JSON.stringify(skills));
  let signature: IssuerSignature | null = null;
  try { signature = await signHexDigest(digest); } catch { signature = null; }
  return { format: "si-skill-catalog/1", issuedAt: new Date().toISOString(), skills, digest, signature };
}

export type CatalogImport =
  | { ok: true; skill: CatalogSkill; landedAs: GenomeStatus; note: string }
  | { ok: false; refused: string };

/** Import: verify EVERYTHING, then land non-ACTIVE — trust is re-earned here. */
/* ── 16.10.1: imports mutate a REAL genome registry, persisted locally ───── */

/** This host's imported-skill genome: rehydrated from the local store. */
export function importedGenomeRegistry(): GenomeRegistry {
  const reg: GenomeRegistry = { genomes: new Map() };
  for (const row of localDb.importedGenomesList()) {
    const g = row.genome as unknown as CapabilityGenome;
    reg.genomes.set(`${g.id}@${g.version}`, g);
  }
  return reg;
}

function persistGenomeRegistry(reg: GenomeRegistry): void {
  const rows = [...reg.genomes.values()].map((g) => ({
    genome: g as unknown as Record<string, unknown>,
    missionId: String((g as { provenance?: { originReceiptId?: string } }).provenance?.originReceiptId ?? ""),
    importedAt: new Date().toISOString(),
  }));
  localDb.importedGenomesSave(rows);
}

export async function importFromCatalog(catalog: SkillCatalog, skillId: string, publicKeyHex?: string, genome?: { registry?: GenomeRegistry; now?: string }): Promise<CatalogImport> {
  if (catalog.format !== "si-skill-catalog/1") return { ok: false, refused: `unknown catalog format "${catalog.format}" — refused.` };
  const digest = await sha256hex(JSON.stringify(catalog.skills));
  if (digest !== catalog.digest) return { ok: false, refused: "catalog digest mismatch — it was modified after issuance; refused in words." };
  if (catalog.signature) {
    if (!publicKeyHex) return { ok: false, refused: "catalog is signed but no issuer public key was supplied — supply it out-of-band to authenticate; refusing to trust a self-reported key." };
    const okSig = await verifyIssuerSignature(catalog.digest, catalog.signature.sigHex, publicKeyHex);
    if (!okSig) return { ok: false, refused: "catalog signature does NOT verify — refused." };
  } else {
    return { ok: false, refused: "catalog is UNSIGNED — an import nobody attests for is refused; the issuer must sign or state why." };
  }
  const skill = catalog.skills.find((s) => s.id === skillId);
  if (!skill) return { ok: false, refused: `skill "${skillId}" is not in this catalog.` };
  if (!skill.provenance.missionId || skill.provenance.verifiedSeats.length === 0) return { ok: false, refused: `skill "${skillId}" carries no real provenance (mission + verified seats) — refused.` };
  // THE GENOME'S LAW: an imported skill lands UNDER_EVALUATION on this host —
  // shadow first, small trial, auto-rollback. It is never imported to ACTIVE.
  // 16.10.1: this is now a REAL registry mutation (persisted locally), not a
  // label — the same entry semantics as governorReopen: UNDER_EVALUATION is
  // the genome's designed "re-prove everything on this host" state. promote()
  // is deliberately NOT called: its hard gates demand shadow evidence an
  // import has not earned yet, and fabricating it is exactly what this
  // product refuses to do.
  const reg = genome?.registry ?? importedGenomeRegistry();
  const gid = `skill.${skill.id}`;
  const now = genome?.now ?? new Date().toISOString();
  if (!latestVersion(reg, gid)) {
    const g = newGenome({
      id: gid,
      objective: { current: skill.objective, improve: `proven reliable on THIS host (imported from mission ${skill.provenance.missionId})` },
      trigger: skill.when,
      procedure: skill.steps,
      inputs: [],
      outputs: [],
      dependencies: [],
      resourceLimits: {},
      failureModes: ["imported skill misfires on this host — shadow and trial catch it before ACTIVE"],
      evaluation: { required: true, gate: "soft" },
      safety: { permissionClass: "read-local", externalSideEffects: false },
      provenance: { originType: "derived", originReceiptId: `mission:${skill.provenance.missionId}`, verifiedSeats: skill.provenance.verifiedSeats.length },
    }, now);
    g.status = "UNDER_EVALUATION";
    g.history.push({ ts: now, from: "OBSERVED", to: "UNDER_EVALUATION", by: "skill-store", reason: `imported from signed catalog (mission ${skill.provenance.missionId}, ${skill.provenance.verifiedSeats.length} verified seat(s)) — full re-proof required on this host` });
    registerGenome(reg, g);
  }
  persistGenomeRegistry(reg);
  const landedStatus: GenomeStatus = latestVersion(reg, gid)?.status ?? "UNDER_EVALUATION";
  return {
    ok: true,
    skill,
    landedAs: landedStatus,
    note: `imported "${skill.title}" from mission ${skill.provenance.missionId} (${skill.provenance.verifiedSeats.length} verified seat(s), v${skill.provenance.version}) — landed UNDER_EVALUATION: it re-proves itself on THIS machine before shadow, canary, active. SelfImpulse ${ENGINE_VERSION}.`,
  };
}
