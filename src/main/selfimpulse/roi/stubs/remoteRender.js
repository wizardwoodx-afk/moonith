/**
 * A stand-in for a remote image renderer.
 *
 * WHY THIS EXISTS
 * ---------------
 * SelfImpulse could draw a graph as an image by sending the graph's own
 * contents to mermaid.ink, a third-party service. A product whose runs are
 * receipted, whose egress is guarded, and whose missions are meant to be
 * verifiable offline cannot quietly post a mission's structure to somebody
 * else's server — and it does not need to: the mermaid TEXT is still
 * available and can be rendered locally by whatever draws diagrams.
 *
 * So this refuses in words.
 */
export async function refuseRemoteRender(url) {
  throw new Error(
    `rendering a diagram through a remote service is not available in SelfImpulse — it would post this run's own contents to a third party (asked for "${url}"). The diagram's text form is available and can be rendered locally.`,
  );
}

export default { refuseRemoteRender };
