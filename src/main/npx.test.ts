import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { npxInvocation, resolveNpxCli, runNpx } from './npx'

let directory = ''
let previousOverride: string | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'selfimpulse-npx-'))
  previousOverride = process.env.SELFIMPULSE_NPX_CLI
})

afterEach(async () => {
  if (previousOverride === undefined) delete process.env.SELFIMPULSE_NPX_CLI
  else process.env.SELFIMPULSE_NPX_CLI = previousOverride
  await rm(directory, { recursive: true, force: true })
})

describe('shell-free npx execution', () => {
  it('passes metacharacters as one literal argument without a command shell', async () => {
    const cli = join(directory, 'npx-cli.js')
    await writeFile(cli, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))', 'utf8')
    process.env.SELFIMPULSE_NPX_CLI = cli
    const hostile = 'value & calc && whoami'
    const result = await runNpx('fixture@latest', ['--prompt', hostile])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['-y', 'fixture@latest', '--prompt', hostile])
    expect(result.stderr).toBe('')
  })

  it('resolves an explicit npm JavaScript entrypoint on Windows without npx.cmd', () => {
    const cli = join(directory, 'npx-cli.js')
    return writeFile(cli, '', 'utf8').then(() => {
      expect(resolveNpxCli({ SELFIMPULSE_NPX_CLI: cli, PATH: '' }, 'win32')).toBe(cli)
      expect(npxInvocation(cli, 'pkg', ['literal']).args).toEqual([cli, '-y', 'pkg', 'literal'])
      expect(() => npxInvocation(cli, 'pkg', ['bad\0arg'])).toThrow('Invalid npx invocation')
    })
  })
})
