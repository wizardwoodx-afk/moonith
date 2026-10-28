import fs from 'node:fs'
import path from 'node:path'
import type { CodeFileOperation } from './types'

export interface FileActionResult {
  success: boolean;
  path: string;
  content?: string;
  linesModified?: number;
  error?: string;
}

export class CodeFileEngine {
  private workspaceRoot: string;
  private modifiedFiles: Set<string> = new Set();

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || process.cwd();
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public getModifiedFiles(): string[] {
    return Array.from(this.modifiedFiles);
  }

  public resolvePath(targetPath: string): string {
    if (path.isAbsolute(targetPath)) return targetPath;
    return path.join(this.workspaceRoot, targetPath);
  }

  public async readFile(targetPath: string, startLine?: number, endLine?: number): Promise<FileActionResult> {
    try {
      const full = this.resolvePath(targetPath);
      if (!fs.existsSync(full)) {
        return { success: false, path: targetPath, error: 'File does not exist' };
      }

      const raw = fs.readFileSync(full, 'utf8');
      if (startLine !== undefined || endLine !== undefined) {
        const lines = raw.split('\n');
        const s = Math.max(0, (startLine ?? 1) - 1);
        const e = Math.min(lines.length, endLine ?? lines.length);
        const slice = lines.slice(s, e).join('\n');
        return { success: true, path: targetPath, content: slice };
      }

      return { success: true, path: targetPath, content: raw };
    } catch (err: unknown) {
      return { success: false, path: targetPath, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async writeFile(targetPath: string, content: string): Promise<FileActionResult> {
    try {
      const full = this.resolvePath(targetPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      this.modifiedFiles.add(targetPath);
      return { success: true, path: targetPath, linesModified: content.split('\n').length };
    } catch (err: unknown) {
      return { success: false, path: targetPath, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async applyPatch(targetPath: string, targetSubstring: string, replacement: string): Promise<FileActionResult> {
    try {
      const full = this.resolvePath(targetPath);
      if (!fs.existsSync(full)) {
        return { success: false, path: targetPath, error: 'File not found for patch' };
      }

      const existing = fs.readFileSync(full, 'utf8');
      if (!existing.includes(targetSubstring)) {
        return { success: false, path: targetPath, error: 'Target block not found in file' };
      }

      const updated = existing.replace(targetSubstring, replacement);
      fs.writeFileSync(full, updated, 'utf8');
      this.modifiedFiles.add(targetPath);
      return { success: true, path: targetPath, linesModified: replacement.split('\n').length };
    } catch (err: unknown) {
      return { success: false, path: targetPath, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async executeOperation(op: CodeFileOperation): Promise<FileActionResult> {
    switch (op.action) {
      case 'read':
        return this.readFile(op.path, op.startLine, op.endLine);
      case 'write':
        return this.writeFile(op.path, op.content || '');
      case 'patch':
        if (op.targetSubstring && op.replacement !== undefined) {
          return this.applyPatch(op.path, op.targetSubstring, op.replacement);
        }
        if (!op.patchDiff) return { success: false, path: op.path, error: 'Missing patch content' };
        return this.writeFile(op.path, op.patchDiff);
      default:
        return { success: false, path: op.path, error: `Unsupported file action: ${op.action}` };
    }
  }
}
