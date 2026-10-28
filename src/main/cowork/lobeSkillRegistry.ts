import fs from 'node:fs'
import path from 'node:path'

export interface CoworkSkillDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  source: 'marketplace' | 'builtin' | 'community';
  modality: 'tool' | 'cognitive' | 'kinetic' | 'perception';
  manifestUrl?: string | null;
  toolSchema?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface SkillSearchResult {
  skill: CoworkSkillDefinition;
  matchScore: number;
}

export class LobeSkillRegistry {
  private skillsMap: Map<string, CoworkSkillDefinition> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  constructor() {
    this.initializeBuiltinSkills();
    this.loadCatalog();
  }

  public loadCatalog(customPath?: string): number {
    try {
      let catalogPath = customPath;
      if (!catalogPath) {
        catalogPath = path.join(__dirname, 'skills-catalog.json');
      }

      if (fs.existsSync(catalogPath)) {
        const content = fs.readFileSync(catalogPath, 'utf8');
        const data = JSON.parse(content);
        if (Array.isArray(data.skills)) {
          for (const item of data.skills) {
            this.registerSkill(item);
          }
        }
      }
    } catch {
      // Catalog fallback to builtins
    }

    return this.skillsMap.size;
  }

  public registerSkill(skill: CoworkSkillDefinition): void {
    const idKey = skill.id.toLowerCase();
    this.skillsMap.set(idKey, skill);

    const cat = (skill.category || 'general').toLowerCase();
    if (!this.categoryIndex.has(cat)) {
      this.categoryIndex.set(cat, new Set());
    }
    this.categoryIndex.get(cat)!.add(idKey);

    if (Array.isArray(skill.tags)) {
      for (const t of skill.tags) {
        const tagKey = t.toLowerCase();
        if (!this.tagIndex.has(tagKey)) {
          this.tagIndex.set(tagKey, new Set());
        }
        this.tagIndex.get(tagKey)!.add(idKey);
      }
    }
  }

  public getSkill(id: string): CoworkSkillDefinition | undefined {
    return this.skillsMap.get(id.toLowerCase());
  }

  public searchSkills(query: string, maxResults: number = 15): SkillSearchResult[] {
    const q = query.toLowerCase().trim();
    const results: SkillSearchResult[] = [];

    for (const skill of this.skillsMap.values()) {
      let score = 0;

      if (skill.name.toLowerCase() === q) {
        score += 100;
      } else if (skill.name.toLowerCase().includes(q)) {
        score += 50;
      }

      if (skill.tags.some(t => t.toLowerCase() === q)) {
        score += 40;
      } else if (skill.tags.some(t => t.toLowerCase().includes(q))) {
        score += 20;
      }

      if (skill.description.toLowerCase().includes(q)) {
        score += 15;
      }

      if (skill.category.toLowerCase().includes(q)) {
        score += 10;
      }

      if (score > 0) {
        results.push({ skill, matchScore: score });
      }
    }

    return results
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, maxResults);
  }

  public getSkillsByCategory(category: string): CoworkSkillDefinition[] {
    const ids = this.categoryIndex.get(category.toLowerCase());
    if (!ids) return [];
    return Array.from(ids).map(id => this.skillsMap.get(id)!).filter(Boolean);
  }

  public listCategories(): string[] {
    return Array.from(this.categoryIndex.keys()).sort();
  }

  public getTotalSkillCount(): number {
    return this.skillsMap.size;
  }

  public resolveToolSchema(skillId: string): Record<string, unknown> | null {
    const skill = this.getSkill(skillId);
    if (!skill) return null;

    if (skill.toolSchema) {
      return {
        type: 'function',
        function: {
          name: skill.toolSchema.name,
          description: skill.toolSchema.description,
          parameters: skill.toolSchema.parameters
        }
      };
    }

    const sanitizedName = skill.id.replace(/[^a-zA-Z0-9_]/g, '_');
    return {
      type: 'function',
      function: {
        name: sanitizedName,
        description: `${skill.name}: ${skill.description}`,
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'string',
              description: `Parameters or prompt for ${skill.name}`
            }
          },
          required: ['input']
        }
      }
    };
  }

  private initializeBuiltinSkills(): void {
    const builtins: CoworkSkillDefinition[] = [
      {
        id: 'skill_builtin_code_interpreter',
        name: 'Sandboxed Code Interpreter',
        description: 'Executes JavaScript, TypeScript, Python, and shell commands in an isolated memory container.',
        category: 'development',
        tags: ['code', 'python', 'javascript', 'exec'],
        source: 'builtin',
        modality: 'tool'
      },
      {
        id: 'skill_builtin_dom_inspection',
        name: 'Perception DOM Inspector',
        description: 'Parses live web browser pages into accessibility trees and locates clickable elements.',
        category: 'automation',
        tags: ['browser', 'dom', 'crawler', 'scraping'],
        source: 'builtin',
        modality: 'perception'
      },
      {
        id: 'skill_builtin_kinetic_input',
        name: 'OS Kinetic Actuation',
        description: 'Performs natural human-like mouse trajectories, clicks, keyboard entries, and window focus.',
        category: 'system',
        tags: ['mouse', 'keyboard', 'os', 'computer-use'],
        source: 'builtin',
        modality: 'kinetic'
      },
      {
        id: 'skill_builtin_generative_surface',
        name: 'Generative UI Surface Streamer',
        description: 'Streams real-time dynamic UI components, approval dialogues, and data grids.',
        category: 'interface',
        tags: ['ui', 'streaming', 'ag-ui', 'cards'],
        source: 'builtin',
        modality: 'tool'
      }
    ];

    for (const b of builtins) {
      this.registerSkill(b);
    }
  }
}
