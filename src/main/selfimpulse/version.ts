/**
 * Build identity — single source of truth for BOTH release numbers.
 *
 *   PRODUCT release — every product manifest carries it (package.json,
 *     Cargo.toml, tauri.conf.json, VERSION.txt, the installer metadata).
 *   ENGINE release — the MJ engine lineage; carried by engine manifests,
 *     receipts and the verify bundles.
 *
 * The PRODUCT name lives in src/brand.ts. Current-facing docs show no numbers
 * except on lines labelled "Version of record" (docs/VERSIONING.md is the
 * policy). `probe/versionDrift.test.ts` enforces every site against these.
 */
export const PRODUCT_VERSION = "1.9.2";
export const ENGINE_VERSION = "19.7.16";
export const ENGINE_SHORT = "19.7";
export const ENGINE_CODENAME = "SelfImpulse";
export const PRODUCT_TITLE = `SelfImpulse (engine MJ ${ENGINE_SHORT} \"${ENGINE_CODENAME}\")`;
export const TAGLINE = "Intelligence Meets Collaboration";
