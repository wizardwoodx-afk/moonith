/**
 * §WEB EVIDENCE — the mission side's import path for ONE web-search module.
 *
 * THIS FILE USED TO BE A SECOND COPY. It carried the same ten exports, the same
 * provider table and the same pure core as `src/selfimpulse/engine/webSearch.ts`,
 * and it was written down from an older revision of it — which is the whole of the
 * defect (audit M-1). The control-plane copy had been hardened in 19.7.16 and this
 * one had not been touched:
 *
 *   · `opts.searxngRoot` was interpolated straight into the request URL with no
 *     `checkEgressUrl` on it at all, so a SearXNG root pointed at
 *     `http://169.254.169.254/` was a supported configuration;
 *   · the request went out on the raw global `fetch` with the platform's default
 *     redirect policy, so even a vetted host could answer 302 and walk the client
 *     to a link-local address without ever coming back through a policy;
 *   · no address resolution, so the DNS-rebinding window (a name that is public at
 *     check time and private at connect time) was open on the one provider whose
 *     host the operator types.
 *
 * And that was the reachable one: `src/mission/teamExecutor.ts` imports `./webSearch`,
 * so every planner and reviewer run in a team mission used the UNHARDENED copy while
 * the hardened copy served the control plane. Hardening a module twice and fixing it
 * once is how drift like this survives review — two copies of one module are not a
 * redundancy, they are a defect with a second place to be wrong.
 *
 * THE FIX IS ONE IMPLEMENTATION. This file is now a re-export, not a copy, and it
 * deliberately uses `export *` rather than a hand-written symbol list: a named list is
 * a second thing to keep in sync, and the failure mode of a stale list is a silently
 * missing export. Both import paths
 * (`src/mission/*` and `src/selfimpulse/engine/*`) resolve to the same functions, the
 * same provider table and the same egress path, and the hardening is unconditional
 * because there is no second implementation left to skip it.
 *
 * If a future change genuinely needs a mission-only variant — different providers,
 * different budget — it belongs in a new module with its own name and its own probe,
 * NOT in a copy of this one.
 *
 * Provenance of the hardening this re-export now carries: `checkEgressUrl`
 * (`src/security/guardrail.ts`, first-party) and `safeEgressFetch`
 * (`src/security/egressNet.ts`, first-party; its OWASP-shaped resolve/pin/
 * manual-redirect design is documented there). Re-anchor 19.7.16 = the egress work;
 * re-anchor M-1 = this consolidation, which deleted the copy rather than patching it.
 *
 * Read the real module — and its EGRESS section explaining the browser trade-off — at
 * `src/selfimpulse/engine/webSearch.ts`.
 */

export * from "../selfimpulse/engine/webSearch";
