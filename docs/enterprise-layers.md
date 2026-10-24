# The enterprise layers

Three layers sit under the SelfImpulse agent brain. Each has one job, one
name, one place to look, and an honest list of what it does not claim.

| Layer | Name | Path | Job |
| --- | --- | --- | --- |
| Governance | Nomos (νόμος, "law") | `src/main/nomos/` | decide whether an action may run |
| Receipts | Sphragis (σφραγίς, "seal") | `src/main/sphragis/` | attest what was authorized, and what became of it |
| Durable missions | Aion (αἰών, "enduring time") | `src/main/aion/` | keep long-running work survivable |

The governed-action contract — one proposed side effect with everything
needed to judge it and to run it only if judged allowed — is
`GovernedAction` in `src/shared/enterprise.ts`. The agent runtime and the
mission runner both execute through it via `src/main/agent/governed.ts`.
The layer designs are attributed in `THIRD-PARTY-NOTICES.md`; all three
are clean-room reimplementations under their own names.

## The three layers

### Nomos — the governance gate (`src/main/nomos/`)

The one function every effectful path crosses: `govern()` in `gate.ts`.
The Captain loop, Crew sub-agents, durable mission steps, MCP tools,
connectors and computer use all cross the same gate, so "who is acting,
under whose authority, with which capability, and what was decided" has
exactly one answer, recorded the same way everywhere.

It guarantees:

- **Deterministic, fail-closed policy** (`policy.ts`). Ordered pure rules;
  the kill switch and identity speak before anything else, high-risk
  outranks trust. A rule that throws or returns a malformed verdict
  denies — a governance layer that fails open grants authority precisely
  when its own machinery is broken.
- **Identity with scoped capabilities** (`identity.ts`). Agents act under
  a principal (the local owner, or an organisation) and never on their
  own authority. Delegation is subset-only: a Crew seat can be narrower
  than its parent, never wider; re-delegation varies within the original
  ceiling, never past it. Revocation is immediate and total.
- **Decision records** (`journal.ts`). Append-only JSONL under the app
  profile; approval and outcome are annotations, never rewrites.
- **A persisted kill switch** (`kill.ts`). Engaged means every action is
  denied, for every agent, until released; engaging survives a restart.

It does **not** claim that trust is an authority. The score in `trust.ts`
is a signal only: it can escalate scrutiny (a low-trust agent is steered
to a human) but no score auto-authorises a high-risk action, and the hard
rules — identity, capability, kill switch, malformed policy — never
consult it.

### Sphragis — the signed receipts (`src/main/sphragis/`)

Two receipts bracket every high-impact action: an **intent** written
before the side effect, and a **result** written after. The service
(`service.ts`) is the only writer; the verifier (`verify.ts`) is
independent of everything that minted the receipts — a successful mint
is not proof that the chain verifies.

It guarantees:

- **Ed25519 signatures** with the private key sealed in the OS keychain
  (`signer.ts`); the renderer receives verification results and key ids,
  never key material, and the model never sees a signing operation.
- **Pairing.** A result without a preceding intent is refused — a result
  without an authorization is exactly the artefact an auditor must never
  see.
- **Hash chaining and digests.** Receipts link prev-to-hash from the zero
  hash; arguments and results enter as SHA-256 digests, never raw
  content, so a receipt is safe to hand to an auditor or a SIEM.

It does **not** claim external truth. A receipt attests an authorization
and a recorded outcome: that the gate allowed the action, who approved
it, and what the tool reported. It cannot prove the outside world
changed as claimed. When the OS keychain is unavailable the chain is
still tamper-evident but unsigned, and the receipt says so
(`UNSIGNED_NOTE`).

### Aion — durable missions (`src/main/aion/`)

A mission is a bounded, long-running workflow. Aion makes it survivable:
every transition is appended to a per-mission journal on disk before it
takes effect.

It guarantees:

- **The journal is the state.** Status, completed steps, pending
  approvals, armed timers and waiting signals are all derived from
  appended records; every append is awaited, so a transition is durable
  before the code that caused it moves on.
- **Waits are durable.** An approval wait, a timer or a signal re-arms
  from the journal, the timer's remaining time recomputed from its
  recorded due time.
- **Explicit recovery.** A step that started but never recorded a result
  is `needs-reconciliation`, not retried: the workflow's reconcile hook
  asks what actually happened out there, and only a confirmed success is
  treated as done.

It does **not** claim exactly-once external effects. Idempotency keys
are the caller's contract to keep; Aion never assumes. And the local
journal is evidence — only the Sphragis verifier attests integrity.

## The single execution path

Every effectful action crosses the same eleven steps, in order:

1. **Plan.** Ids are minted: `runId`, `taskId`, `actionId`, `agentId`,
   `principalId` — the one stable schema (`ActionIds`, `nomos/types.ts`)
   that lets a decision, an approval, a result and a receipt be joined.
2. **Validate.** The tool's zod schema checks the arguments; the input
   digest is computed here and travels with the action.
3. **Govern.** Nomos resolves identity, capability and the hard rules,
   with trust as a signal only. The runtime uses `governAwait()`, so the
   decision is on disk before the side effect happens.
4. **Approve.** When the decision is `steer`, a human decides; who
   approved and when is annotated onto the decision record.
5. **Persist intent.** The governance decision is journaled.
6. **Pre-action receipt.** For high-impact actions (`requiresReceipt`:
   it executes, or it is high-risk) Sphragis mints the intent receipt.
7. **Execute once.** The existing tool adapter runs the effect — only
   after the gate allows — with idempotency keys where the tool supports
   them.
8. **Verify outcome.** Exit status, file hash, API response: a measured
   fact, never "returned a string".
9. **Persist outcome.** The outcome is annotated onto the decision
   record; a measured success or failure moves the trust signal.
10. **Final receipt and audit.** Sphragis mints the result receipt; the
    decision, approval, result and receipt are joined by `actionId`.
11. **Recover.** An action started without a result is marked
    needs-reconciliation. The step's own `reconcile` hook checks the
    external system where it knows how; where it does not, the human says
    whether the effect landed. Nothing is retried or compensated before
    that answer. Nothing replays blind.

## Responsibility ownership

| Question | Owner |
| --- | --- |
| Who decides whether an action is allowed? | **Nomos** — one shared enforcement point. `govern()` in `src/main/nomos/gate.ts`; no other code path may decide. |
| Who owns long-running mission state? | **Aion's journal** — the append-only per-mission JSONL. A correlated local audit journal (the governance records) is kept alongside it. |
| Who proves receipt integrity? | **The Sphragis verifier** — `verifyReceiptChain` in `src/main/sphragis/verify.ts`. The local SHA-256 journal and the HMAC-sealed audit export are useful but not substitutes. |
| Who decides what to do next? | **The SelfImpulse agent brain**, with the vendored graph runtime (`src/main/vendor/graphruntime/`) for complex missions. |
| Who runs an ordinary local tool? | **The existing tool adapter** (`src/main/agent/tools/`) — and only after the gate authorises it. |

## What was deliberately NOT adopted

- **Mastra and VoltAgent.** They overlap the existing custom agent loop,
  tools, memory and sub-agents. Revisit only against a demonstrated gap,
  and then as a narrow branch proof-of-concept — never a rewrite.
- **Temporal.** It is an alternative to the Aion approach, not an
  addition to it. Reconsider only if SelfImpulse becomes a distributed
  service with many worker types. Never run both in the same
  orchestration role.

## The bounded durable mission

The repository-scan mission is the one workflow ported onto Aion:
**scan → propose → approval → apply → test → report**. The scan and the
proposal are journalled action steps, safe to retry because they only
read. The approval is a durable wait that survives a restart. `apply` is
the one effectful step, and it carries the full set of guarantees: an
idempotency key, no retry (a second attempt could double the effect), a
`compensate` hook that removes the artefact it wrote, and a `reconcile`
hook that settles a crash by looking for that artefact. `test` retries,
because running a check twice is harmless. The report closes the mission.

What makes this durable is the journal discipline, not the step kinds:
each step's start is appended before its effect, each result after; the
approval wait re-arms from the journal; and a crash mid-step leaves the
mission in `needs-reconciliation` rather than replaying. Two things then
have to be true, and both are:

- **The bindings come back.** A journal is JSON, so it keeps the mission's
  data (`root`) and never its functions (the gate, the tools). The
  orchestrator's `resolveInput` hook re-attaches them when the mission is
  adopted — which is what lets a mission that parked at its approval take
  another step after the app restarts.
- **The interrupted step can answer for itself.** `apply`'s `reconcile`
  hook looks for the mission's review artefact: present means the effect
  landed and the mission continues from `test`, with the result the step
  would have returned reconstructed from the proposal; absent means it did
  not. A step with no hook, or one that answers `unknown`, leaves the
  mission parked for the human, who settles it from the Audit pane with
  "It landed" or "It didn't". Nothing is retried on a guess.

Only that mission was ported, deliberately. It is the bounded case that
exercises every Aion primitive — action, approval, retry, idempotency,
compensation and reconciliation — and the desktop tools are not all
ported yet. Aion earns wider adoption one demonstrated mission at a time.

## Verification

An auditor checks the artefact, not the app. Run the Sphragis verifier
over the receipt journal (`sphragis:verify`; the audit pane surfaces the
result): format, hash, chain, signature and intent/result pairing, each
failure named by what broke.

What a failure looks like:

- **A tampered field** — the receipt's bytes no longer hash to its
  recorded hash: "modified after signing".
- **A stripped signature** — the receipt carries no issuer signature:
  tamper-evident, but authorship unattested.
- **A deleted intent** — the chain breaks at the gap, or a result
  appears with no preceding intent.
- **An unclosed intent after a crash** — reported as an intent with no
  result, with the instruction to reconcile before retrying.

What remains out of scope: there is no remote attestation. The OS
keychain is the trust anchor for signing — if it is unavailable the
receipts honestly say they are unsigned, and nothing in the system
pretends otherwise.
