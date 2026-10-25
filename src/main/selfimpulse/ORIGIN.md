# SelfImpulse engine origin

These files are the headless SelfImpulse engine, originally copied from the
SelfImpulse repository (branch `feat/engine-only`) so the desktop application
can run it in the main process. They are now maintained as part of this
integrated product rather than as a separate host module.

The original closure contained 456 files (engine, mission core, security,
domain, graph, persistence, and host client), plus the graph runtime. That
runtime is now the targeted SELF-ΡΟΗ integration at `src/main/selfimpulse/roi`;
its separate upstream attribution is recorded in `PROVENANCE.json` and the
repository-wide third-party notices.

Copyright (c) 2024-2026 K.S. / SelfImpulse. All Rights Reserved.
