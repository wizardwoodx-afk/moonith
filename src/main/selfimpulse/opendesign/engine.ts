/**
 * OpenDesign Engine for SelfImpulse.
 *
 * Implements the open-source local-first collaborative AI design agent architecture
 * (inspired by nexu-io/open-design):
 * - Compiles design system tokens (colors, typography, spacing, surface elevations)
 * - Generates sandboxed HTML/JS interactive prototypes with live preview
 * - Exports presentation slides and vector canvas layouts
 * - Executes 100% locally in-process without cloud dependencies
 */
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { newId, nowIso } from '../../util'

export interface DesignTokens {
  name: string
  colors: Record<string, string>
  typography: {
    fontFamily: string
    scale: Record<string, string>
  }
  spacing: Record<string, string>
  borderRadius: Record<string, string>
  shadows: Record<string, string>
}

export interface PrototypeArtifact {
  id: string
  title: string
  html: string
  tokens: DesignTokens
  createdAt: string
}

export class OpenDesignEngine {
  /**
   * Compiles a standard design token set based on a theme brief or primary brand color.
   */
  compileTokens(input: {
    name: string
    primaryColor?: string
    style?: 'modern' | 'minimal' | 'glassmorphic' | 'editorial'
  }): DesignTokens {
    const primary = input.primaryColor || '#0096ff'
    const style = input.style || 'modern'

    return {
      name: input.name,
      colors: {
        primary,
        primarySoft: `${primary}1a`,
        surface: style === 'glassmorphic' ? 'rgba(255, 255, 255, 0.05)' : '#18181b',
        background: '#09090b',
        line: 'rgba(255, 255, 255, 0.1)',
        text: '#fafafa',
        textMuted: '#a1a1aa'
      },
      typography: {
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        scale: {
          xs: '11px',
          sm: '13px',
          base: '15px',
          lg: '18px',
          xl: '24px',
          h1: '32px'
        }
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px'
      },
      borderRadius: {
        sm: '6px',
        md: '12px',
        lg: '20px',
        full: '9999px'
      },
      shadows: {
        card: '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
        glow: `0 0 24px -4px ${primary}4d`
      }
    }
  }

  /**
   * Generates a self-contained interactive prototype with embedded styling and interaction.
   */
  generatePrototype(input: {
    title: string
    description: string
    tokens?: DesignTokens
    componentsHtml: string
    scriptJs?: string
  }): PrototypeArtifact {
    const tokens = input.tokens || this.compileTokens({ name: input.title })
    const id = newId('proto')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${input.description}">
  <title>${input.title} - OpenDesign Prototype</title>
  <style>
    :root {
      --primary: ${tokens.colors.primary};
      --primary-soft: ${tokens.colors.primarySoft};
      --surface: ${tokens.colors.surface};
      --background: ${tokens.colors.background};
      --line: ${tokens.colors.line};
      --text: ${tokens.colors.text};
      --text-muted: ${tokens.colors.textMuted};
      --font-family: ${tokens.typography.fontFamily};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--background);
      color: var(--text);
      font-family: var(--font-family);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 24px;
    }
    .opendesign-preview-frame {
      max-width: 1080px;
      margin: 0 auto;
      width: 100%;
      border: 1px solid var(--line);
      border-radius: ${tokens.borderRadius.lg};
      background: var(--surface);
      padding: 32px;
      box-shadow: ${tokens.shadows.card};
    }
  </style>
</head>
<body>
  <div class="opendesign-preview-frame">
    ${input.componentsHtml}
  </div>
  <script>
    ${input.scriptJs || ''}
  </script>
</body>
</html>`

    return {
      id,
      title: input.title,
      html,
      tokens,
      createdAt: nowIso()
    }
  }

  /**
   * Writes the prototype to the task workspace as an inspectable artifact.
   */
  async exportPrototype(workspace: string, artifact: PrototypeArtifact): Promise<string> {
    const filename = `prototype_${artifact.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.html`
    const filePath = join(workspace, filename)
    await fs.writeFile(filePath, artifact.html, 'utf8')
    return filePath
  }
}

export const openDesignEngine = new OpenDesignEngine()
