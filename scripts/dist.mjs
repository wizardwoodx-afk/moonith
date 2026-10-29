/**
 * Builds the distributable.
 *
 * Code signing needs the certificate password, which is deliberately not
 * stored in the repository. When the password is present the installer is
 * signed; when it is absent the build still runs, unsigned, so a package can
 * always be produced. The engine stays out of signing either way — see
 * `signExts` in electron-builder.yml and the afterPack guard.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(root, 'node_modules', 'electron-builder', 'cli.js')

const password = process.env.CSC_KEY_PASSWORD || process.env.WIN_CSC_KEY_PASSWORD
const args = process.argv.slice(2)
const flags = []
const env = { ...process.env }

// The certificate is opened with the password, so a build without one must not
// point electron-builder at it: the PFX fails its integrity check and the
// whole package dies before the installer is written.
if (password) {
  flags.push('-c.win.cscLink=resources/selfimpulse.pfx')
} else {
  flags.push('-c.win.signExecutable=false')
  delete env.CSC_LINK
  delete env.WIN_CSC_LINK
  console.log(
    '• no certificate password in the environment, building unsigned\n' +
      '  set CSC_KEY_PASSWORD to sign the installer'
  )
}

const result = spawnSync(process.execPath, [cli, ...args, ...flags], {
  cwd: root,
  stdio: 'inherit',
  env
})
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 0)
