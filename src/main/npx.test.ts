import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { npxEnvironment, npxInvocation, resolveNpxCli, runNpx } from './npx'

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
  it('scrubs credentials and loader hooks while retaining ordinary configuration', () => {
    const env = npxEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/test',
      OPENAI_API_KEY: 'do-not-leak',
      AWS_SECRET_ACCESS_KEY: 'do-not-leak',
      TELEGRAM_BOT_TOKEN: 'do-not-leak',
      NODE_OPTIONS: '--require malicious.js',
      npm_config_color: 'always'
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/test')
    expect(env.npm_config_color).toBe('always')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.npm_config_ignore_scripts).toBe('true')
  })

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
