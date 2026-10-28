import { exec } from 'node:child_process'
import type { ShellExecutionRequest, ShellExecutionResult } from './types'

export class ShellExecutor {
  private cwd: string;

  constructor(defaultCwd?: string) {
    this.cwd = defaultCwd || process.cwd();
  }

  public setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  public setWorkspaceRoot(root: string): void {
    this.cwd = root;
  }

  public getCwd(): string {
    return this.cwd;
  }

  public async executeCommand(req: ShellExecutionRequest): Promise<ShellExecutionResult> {
    const startTime = Date.now();
    const targetCwd = req.cwd || this.cwd;
    const timeout = req.timeoutMs || 30000;

    return new Promise((resolve) => {
      exec(
        req.command,
        {
          cwd: targetCwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const exitCode = error ? (error.code ?? 1) : 0;

          resolve({
            command: req.command,
            exitCode: typeof exitCode === 'number' ? exitCode : 1,
            stdout: stdout.toString(),
            stderr: stderr.toString() || (error ? error.message : ''),
            durationMs
          });
        }
      );
    });
  }
}
