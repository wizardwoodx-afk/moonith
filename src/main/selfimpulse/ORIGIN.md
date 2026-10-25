# Vendored SelfImpulse engine

These files are the headless SelfImpulse engine, copied from the SelfImpulse
repository (branch feat/engine-only) so SelfImpulse can run it in the main
process. Nothing here is a host module: keep edits upstream and re-vendor.

Copied closure: 456 files (engine, mission core, security, domain, graph,
persist, host client) plus the vendored graph runtime at
src/main/selfimpulse/roi, whose upstream attribution is recorded in
src/main/selfimpulse/roi/PROVENANCE.json.

Copyright (c) 2024-2026 K.S. / SelfImpulse. All Rights Reserved.
