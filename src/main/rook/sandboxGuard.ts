import * as path from 'node:path'

export class ResourceSandboxGuard {
  private workspaceRoot: string;
  private credentialVault: Map<string, string> = new Map();

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public storeCredential(key: string, secretValue: string): void {
    this.credentialVault.set(key, secretValue);
  }

  public redactSecrets(content: string): string {
    let sanitized = content;
    for (const [key, secret] of this.credentialVault.entries()) {
      if (secret && secret.length > 3) {
        sanitized = sanitized.split(secret).join(`[REDACTED_SECRET_${key.toUpperCase()}]`);
      }
    }
    // Also redact standard token patterns
    sanitized = sanitized.replace(/(sk-[a-zA-Z0-9_-]{20,})/g, '[REDACTED_API_KEY]');
    sanitized = sanitized.replace(/(ghp_[a-zA-Z0-9]{30,})/g, '[REDACTED_GITHUB_TOKEN]');
    return sanitized;
  }

  public assertWithinWorkspace(targetPath: string): string {
    const resolved = path.resolve(this.workspaceRoot, targetPath);
    const rel = path.relative(this.workspaceRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Security Violation: Path '${targetPath}' escapes sandbox boundary '${this.workspaceRoot}'`);
    }
    return resolved;
  }
}
