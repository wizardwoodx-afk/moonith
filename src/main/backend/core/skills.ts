/**
 * ImpulseCore agent — the skill manager.
 *
 * Skills are bundles in the agentskills.io format: a SKILL.md with frontmatter.
 * The manager enforces the contract on every write, because the system-prompt
 * skill index truncates descriptions and a bad description silently never routes.
 */
import { SKILL_AUTHOR, SKILL_VERSION, validateSkill, type SkillValidation } from "./learning";
import type { ImpulsePorts, SkillBundle } from "./types";

export interface SkillWriteResult {
  ok: boolean;
  bundle?: SkillBundle;
  validation: SkillValidation;
}

export class SkillManager {
  constructor(private ports: ImpulsePorts) {}

  async list(): Promise<SkillBundle[]> {
    const skills = await this.ports.skills.list();
    return [...skills].sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
  }

  /** The index the system prompt carries: name + truncated description. */
  async index(limit = 40): Promise<string> {
    const skills = (await this.list()).filter((s) => !s.archived);
    if (!skills.length) return "(no skills installed)";
    return skills
      .slice(0, limit)
      .map((s) => `- ${s.name}: ${s.description.slice(0, 60)}`)
      .join("\n");
  }

  /**
   * Write a skill. The contract is enforced here, not in the prompt, so a
   * mis-behaving model cannot ship a skill that will never route.
   */
  async write(input: {
    name: string;
    description: string;
    body: string;
    platforms?: string[];
    tags?: string[];
    id?: string;
  }): Promise<SkillWriteResult> {
    const now = this.ports.now();
    const existing = input.id ? await this.ports.skills.read(input.id) : null;
    const candidate: SkillBundle = {
      id: input.id || `skill_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: input.name.trim(),
      description: input.description.trim(),
      body: input.body,
      version: existing?.version || SKILL_VERSION,
      // the author is never taken from the host environment
      author: SKILL_AUTHOR,
      platforms: input.platforms ?? existing?.platforms ?? [],
      tags: input.tags ?? existing?.tags ?? [],
      path: existing?.path,
      pinned: existing?.pinned ?? false,
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      useCount: existing?.useCount ?? 0,
      lastUsedAt: existing?.lastUsedAt,
    };

    const validation = validateSkill(candidate);
    if (!validation.ok) return { ok: false, validation };

    const saved = await this.ports.skills.write(candidate);
    this.ports.emit("agent:skill_written", { id: saved.id, name: saved.name });
    return { ok: true, bundle: saved, validation };
  }

  /** Improve an existing skill in place — the "self-improvement during use" path. */
  async patch(id: string, changes: Partial<Pick<SkillBundle, "description" | "body" | "platforms" | "tags">>): Promise<SkillWriteResult> {
    const existing = await this.ports.skills.read(id);
    if (!existing) return { ok: false, validation: { ok: false, errors: ["skill not found"] } };
    return this.write({ ...existing, ...changes, id });
  }

  /** Never delete — only archive, and archiving is recoverable. */
  async archive(id: string): Promise<boolean> {
    const existing = await this.ports.skills.read(id);
    if (!existing) return false;
    await this.ports.skills.write({ ...existing, archived: true, updatedAt: this.ports.now() });
    this.ports.emit("agent:skill_archived", { id, name: existing.name });
    return true;
  }

  async restore(id: string): Promise<boolean> {
    const existing = await this.ports.skills.read(id);
    if (!existing) return false;
    await this.ports.skills.write({ ...existing, archived: false, updatedAt: this.ports.now() });
    return true;
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.ports.skills.setPinned(id, pinned);
  }

  async remove(id: string): Promise<boolean> {
    return this.ports.skills.remove(id);
  }
}
