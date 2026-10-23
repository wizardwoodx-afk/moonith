# Build and release

## Prerequisites

- Node.js 22 or newer.
- `npm install` once after cloning, and again after any dependency change.

## Commands

- `npm run build` — compiles main, preload and renderer into `out/`. This is the
  step that produces the code electron-builder packages.
- `npm run typecheck` — runs `tsc --noEmit` over both the Node and the web
  tsconfig. Run it before releasing; the build itself does not type-check.
- `npm test` — runs the vitest suite.
- `npm run dist:win` — `npm run build` followed by
  `electron-builder --win nsis`. Produces the Windows installer.

## Build script note

`scripts/build.mjs` builds main and renderer in two separate processes. A
single-process `electron-vite build` peaks above this machine's memory commit
limit once the vendored runtime is part of the main bundle, and fails with a
native out-of-memory instead of a useful error. Two processes release the first
target's memory before the second starts. For the same reason the script sets
`RAYON_NUM_THREADS=2`, because Rolldown's thread pool is the allocation that
fails first on a full page file. Do not raise it without checking free commit.

## Output

Everything is written to `release/`:

- `release/SelfImpulse-Setup-<version>.exe` — the NSIS installer to ship.
- `release/win-unpacked/` — the unpacked application directory.
- `release/app.asar` and build metadata.

## Release checklist

1. Bump `version` in `package.json`.
2. `npm run typecheck && npm test`.
3. `npm run dist:win`.
4. Copy the installer out of `release/`.
5. Delete `release/win-unpacked/` and the unpacked `app.asar`.

Step 5 matters: `win-unpacked` is a full duplicate of the installed app, about
536 MB. Leaving it in place means shipping the same binaries twice and inflates
any archive of the release folder.

## Caveats

- The build is unsigned. Windows SmartScreen will show a warning on first run
  until the binary earns reputation or is code-signed.
- There is no auto-updater. Users must download and run the installer to move
  between versions.
