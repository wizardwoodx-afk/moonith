/**
 * §33 Security boundaries.
 *
 * Mission-level permissions constrain everything an agent in that mission may do. The rule
 * enforced here: an agent inherits only what is explicitly granted, and a grant is always the
 * intersection of the mission boundary and the role's actual need.
 *
 * Path checks are conservative. When a path cannot be resolved to something inside an allowed
 * prefix, it is denied — not assumed safe.
 */

import type { GrantedPermissions, SecurityBoundary } from "./types";

export type BoundaryCapability =
  | "filesystemRead"
  | "filesystemWrite"
  | "shell"
  | "network"
  | "browser"
  | "mcp"
  | "credentials";

export interface BoundaryCheck {
  allowed: boolean;
  reason: string;
  capability: BoundaryCapability | "path";
}

export function checkCapability(boundary: SecurityBoundary, capability: BoundaryCapability, action: string): BoundaryCheck {
  if (!boundary[capability]) {
    return {
      allowed: false,
      capability,
      reason: `Mission boundary denies \`${capability}\`. Action refused: ${action}`,
    };
  }
  return { allowed: true, capability, reason: `${capability} granted by the mission boundary.` };
}

/** Normalise without touching the filesystem: lexical only, so it cannot be fooled by I/O. */
export function normalisePath(p: string): string {
  const isAbsolute = p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
  const parts: string[] = [];
  for (const raw of p.split(/[\\/]/)) {
    if (!raw || raw === ".") continue;
    if (raw === "..") parts.pop();
    else parts.push(raw);
  }
  const joined = parts.join("/");
  return isAbsolute ? `/${joined}` : joined;
}

export function checkPath(boundary: SecurityBoundary, path: string, write: boolean): BoundaryCheck {
  const cap: BoundaryCapability = write ? "filesystemWrite" : "filesystemRead";
  const capCheck = checkCapability(boundary, cap, `${write ? "write" : "read"} ${path}`);
  if (!capCheck.allowed) return capCheck;

  const target = normalisePath(path);

  for (const denied of boundary.deniedPaths) {
    const d = normalisePath(denied);
    if (target === d || target.startsWith(`${d}/`)) {
      return { allowed: false, capability: "path", reason: `${path} is inside denied path ${denied}.` };
    }
  }

  if (boundary.allowedPaths.length) {
    const inside = boundary.allowedPaths.some((a) => {
      const n = normalisePath(a);
      return target === n || target.startsWith(`${n}/`);
    });
    if (!inside) {
      return {
        allowed: false,
        capability: "path",
        reason: `${path} is outside every allowed path (${boundary.allowedPaths.join(", ")}).`,
      };
    }
  }

  return { allowed: true, capability: "path", reason: `${path} is within the mission workspace.` };
}

/** Filter a granted permission set down to what the boundary still supports. */
export function intersectWithBoundary(granted: GrantedPermissions, boundary: SecurityBoundary): { permissions: GrantedPermissions; revoked: Array<keyof GrantedPermissions> } {
  const map: Array<[keyof GrantedPermissions, BoundaryCapability]> = [
    ["filesystemRead", "filesystemRead"],
    ["filesystemWrite", "filesystemWrite"],
    ["shell", "shell"],
    ["network", "network"],
    ["browser", "browser"],
    ["mcp", "mcp"],
    ["credentials", "credentials"],
  ];
  const permissions = { ...granted };
  const revoked: Array<keyof GrantedPermissions> = [];
  for (const [perm, cap] of map) {
    if (permissions[perm] && !boundary[cap]) {
      permissions[perm] = false;
      revoked.push(perm);
    }
  }
  return { permissions, revoked };
}

/**
 * The policy table the UI shows, so a user can see exactly what a mission may do before
 * running it. Never inferred at run time from what an agent asked for.
 */
export function describeBoundary(boundary: SecurityBoundary): Array<{ capability: string; allowed: boolean; note: string }> {
  const rows: Array<[BoundaryCapability, string]> = [
    ["filesystemRead", "Read files inside the allowed paths"],
    ["filesystemWrite", "Write files inside the allowed paths"],
    ["shell", "Execute commands"],
    ["network", "Make network calls"],
    ["browser", "Drive a browser session"],
    ["mcp", "Call MCP servers"],
    ["credentials", "Resolve stored credentials"],
  ];
  return rows.map(([cap, note]) => ({
    capability: cap,
    allowed: boundary[cap],
    note: boundary[cap] ? note : `${note} — DENIED by this mission`,
  }));
}

/** Render for the mission header / approval dialog. */
export function renderBoundary(boundary: SecurityBoundary): string {
  const lines = describeBoundary(boundary).map((r) => `${r.allowed ? "allow" : "DENY "} ${r.capability}`);
  if (boundary.allowedPaths.length) lines.push(`allowed paths: ${boundary.allowedPaths.join(", ")}`);
  if (boundary.deniedPaths.length) lines.push(`denied paths: ${boundary.deniedPaths.join(", ")}`);
  if (boundary.repositories.length) lines.push(`repositories: ${boundary.repositories.join(", ")}`);
  if (boundary.deploymentTargets.length) lines.push(`deployment targets: ${boundary.deploymentTargets.join(", ")}`);
  return lines.join("\n");
}

/**
 * Sanity-check a boundary before a mission runs. A boundary that grants credentials without
 * any deployment target, or that allows writes with no allowed path, is usually a mistake.
 */
export function auditBoundary(boundary: SecurityBoundary): string[] {
  const warnings: string[] = [];
  if (boundary.credentials && !boundary.deploymentTargets.length) {
    warnings.push("Credentials are granted but no deployment target is declared. Narrow this unless the mission really needs secrets.");
  }
  if (boundary.filesystemWrite && !boundary.allowedPaths.length && !boundary.deniedPaths.length) {
    warnings.push("Filesystem writes are allowed with no path scoping. Set allowedPaths to the workspace.");
  }
  if (boundary.shell && boundary.network && boundary.credentials) {
    warnings.push("Shell + network + credentials together allow exfiltration. Confirm the mission needs all three.");
  }
  return warnings;
}
