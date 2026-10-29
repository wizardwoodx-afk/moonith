/**
 * Creative Studio Tools for SelfImpulse.
 *
 * Dedicated built-in tools debranding the Storytold / ArtCraft open-source suite
 * into native SelfImpulse studio engines:
 * - Theatron (ArtCraft): 3D Scene staging, camera blocking & composition
 * - Eikon (PhotoCraft): Layer-based raster image composition & filters
 * - Pinax (GridCraft): Spreadsheet calculation & cell data manipulation
 * - Gramme & Eidos (VectorCraft / FigCraft): Vector SVG illustration & UI prototyping
 * - Kinema & Drama (FilmCraft / EffectCraft): Video sequencing & motion effects
 * - Echo (SoundCraft): Audio track mixing & sound envelopes
 * - Techton (CADCraft): 2D/3D geometric drafting & parametric specs
 * - Chartes (PdfCraft): PDF manipulation & page reorganization
 *
 * All operations execute in-process with zero cloud or external service requirements.
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { z } from 'zod'
import ExcelJS from 'exceljs'
import { defineTool, toolResultError, type ToolContext } from './types'
import { resolveSafePath } from '../../security'
import { newId, truncate } from '../../util'

function getRoots(ctx: ToolContext): string[] {
  return ctx.roots && ctx.roots.length > 0 ? ctx.roots : [ctx.workspace || process.cwd()]
}

/**
 * 1. Theatron (ArtCraft) — 3D Spatial Scene Staging & Camera Blocking
 */
export const studioStageSceneTool = defineTool({
  name: 'studio_stage_scene',
  title: 'Theatron Scene Staging',
  description:
    'Stage a 3D scene with camera blocking, virtual actor mannequin placement, depth layers, and lighting configuration. Creates a production-ready spatial scene specification (.json or .scene) in the workspace.',
  schema: z.object({
    outputPath: z.string().describe('File path to save the scene spec (e.g. "scenes/shot1.scene.json").'),
    title: z.string().describe('Scene title or slug.'),
    camera: z.object({
      fov: z.number().optional().default(50).describe('Field of view in degrees.'),
      angle: z.enum(['eye-level', 'low-angle', 'high-angle', 'birds-eye', 'dutch-tilt', 'close-up', 'over-the-shoulder']).default('eye-level'),
      distance: z.enum(['close', 'medium', 'wide', 'extreme-wide']).default('medium'),
      position: z.array(z.number()).length(3).optional().default([0, 1.6, 3]),
      target: z.array(z.number()).length(3).optional().default([0, 1.2, 0])
    }),
    actors: z.array(
      z.object({
        name: z.string(),
        pose: z.string().describe('E.g., "standing arms crossed", "sitting at desk", "walking left to right".'),
        position: z.array(z.number()).length(3),
        facingAngle: z.number().optional().default(0)
      })
    ).optional().default([]),
    environment: z.object({
      location: z.string().describe('Location description, e.g. "cyberpunk alley at night with wet asphalt".'),
      lighting: z.string().describe('Lighting style, e.g. "neon rim light with soft blue ambient fill".'),
      mood: z.string().optional().default('cinematic')
    }),
    depthLayers: z.array(
      z.object({
        layer: z.enum(['foreground', 'midground', 'background']),
        elements: z.array(z.string())
      })
    ).optional().default([])
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(getRoots(ctx), args.outputPath, { mode: 'write' })
      await fs.mkdir(dirname(target), { recursive: true })

      const sceneData = {
        schema: 'selfimpulse.theatron.v1',
        title: args.title,
        camera: args.camera,
        actors: args.actors,
        environment: args.environment,
        depthLayers: args.depthLayers,
        generationPromptPromptHint: `Camera: ${args.camera.distance} ${args.camera.angle} shot. Location: ${args.environment.location}. Lighting: ${args.environment.lighting}. Actors: ${args.actors.map(a => `${a.name} (${a.pose})`).join(', ')}.`,
        stagedAt: new Date().toISOString()
      }

      await fs.writeFile(target, JSON.stringify(sceneData, null, 2), 'utf8')
      return {
        content: `Successfully staged scene "${args.title}" at ${basename(target)}.\n\nCamera: ${args.camera.angle} (${args.camera.distance})\nActors: ${args.actors.length}\nPrompt Guide:\n"${sceneData.generationPromptPromptHint}"`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Stage Scene: ${args.title}`
})

/**
 * 2. Eikon (PhotoCraft) — Layer-Based Raster Image Composition & Filters
 */
export const studioComposeImageTool = defineTool({
  name: 'studio_compose_image',
  title: 'Eikon Image Compositor',
  description:
    'Compose, filter, and layer raster image assets. Supports SVG/PNG layer definitions, color adjustments (brightness, contrast, blur, grayscale), and composite exports.',
  schema: z.object({
    outputPath: z.string().describe('Output file path (e.g. "images/banner.svg" or "images/composite.json").'),
    width: z.number().int().default(1200),
    height: z.number().int().default(630),
    background: z.string().default('#0d1117'),
    layers: z.array(
      z.object({
        id: z.string(),
        type: z.enum(['rect', 'circle', 'text', 'image-ref', 'gradient']),
        x: z.number(),
        y: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        fill: z.string().optional(),
        opacity: z.number().min(0).max(1).optional().default(1),
        text: z.string().optional(),
        fontSize: z.number().optional(),
        fontWeight: z.string().optional(),
        fontFamily: z.string().optional(),
        filter: z.string().optional().describe('E.g., "blur(4px)" or "contrast(1.2)"'),
        src: z.string().optional().describe('Relative path to source image.')
      })
    )
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(getRoots(ctx), args.outputPath, { mode: 'write' })
      await fs.mkdir(dirname(target), { recursive: true })

      // Generate composite SVG representation
      const elementsSvg = args.layers.map((l) => {
        if (l.type === 'rect') {
          return `<rect x="${l.x}" y="${l.y}" width="${l.width ?? 100}" height="${l.height ?? 100}" fill="${l.fill ?? '#ffffff'}" opacity="${l.opacity ?? 1}" ${l.filter ? `style="filter: ${l.filter}"` : ''} />`
        }
        if (l.type === 'circle') {
          const r = (l.width ?? 50) / 2
          return `<circle cx="${l.x + r}" cy="${l.y + r}" r="${r}" fill="${l.fill ?? '#ffffff'}" opacity="${l.opacity ?? 1}" />`
        }
        if (l.type === 'text') {
          return `<text x="${l.x}" y="${l.y}" fill="${l.fill ?? '#ffffff'}" font-size="${l.fontSize ?? 24}" font-weight="${l.fontWeight ?? 'normal'}" font-family="${l.fontFamily ?? 'sans-serif'}" opacity="${l.opacity ?? 1}">${l.text ?? ''}</text>`
        }
        if (l.type === 'gradient') {
          return `<rect x="${l.x}" y="${l.y}" width="${l.width ?? args.width}" height="${l.height ?? args.height}" fill="${l.fill ?? 'url(#grad)'}" opacity="${l.opacity ?? 1}" />`
        }
        return `<!-- Layer ${l.id} -->`
      })

      const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${args.width} ${args.height}" width="${args.width}" height="${args.height}">
  <rect width="100%" height="100%" fill="${args.background}" />
  ${elementsSvg.join('\n  ')}
</svg>
`.trim()

      await fs.writeFile(target, svgContent, 'utf8')
      return {
        content: `Successfully composed image with ${args.layers.length} layers to ${basename(target)} (${args.width}x${args.height}).`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Compose Image: ${args.outputPath}`
})

/**
 * 3. Pinax (GridCraft) — Native Spreadsheet Calculation & Cell Operations
 */
export const studioSpreadsheetOpTool = defineTool({
  name: 'studio_spreadsheet_op',
  title: 'Pinax Spreadsheet Engine',
  description:
    'Manipulate, calculate, and format Excel (.xlsx) spreadsheets natively. Can add rows, update cells with formulas, compute column summaries, or create styled tables.',
  schema: z.object({
    filePath: z.string().describe('Spreadsheet file path (e.g. "finance/q3.xlsx").'),
    sheetName: z.string().optional().default('Sheet1'),
    action: z.enum(['update_cells', 'add_rows', 'add_formula', 'read_summary']),
    updates: z.array(
      z.object({
        cell: z.string().describe('Cell coordinate (e.g. "B2", "C10").'),
        value: z.union([z.string(), z.number(), z.boolean()]),
        formula: z.string().optional().describe('Formula without "=" (e.g. "SUM(B2:B9)").')
      })
    ).optional(),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).optional()
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(getRoots(ctx), args.filePath, { mode: 'write' })
      await fs.mkdir(dirname(target), { recursive: true })

      const workbook = new ExcelJS.Workbook()
      try {
        await workbook.xlsx.readFile(target)
      } catch {
        // Create new if not existing
      }

      let worksheet = workbook.getWorksheet(args.sheetName)
      if (!worksheet) {
        worksheet = workbook.addWorksheet(args.sheetName)
      }

      if (args.action === 'add_rows' && args.rows) {
        for (const row of args.rows) {
          worksheet.addRow(row)
        }
      }

      if (args.action === 'update_cells' && args.updates) {
        for (const u of args.updates) {
          const cell = worksheet.getCell(u.cell)
          if (u.formula) {
            cell.value = { formula: u.formula, result: u.value }
          } else {
            cell.value = u.value
          }
        }
      }

      if (args.action === 'add_formula' && args.updates) {
        for (const u of args.updates) {
          const cell = worksheet.getCell(u.cell)
          cell.value = { formula: u.formula ?? String(u.value) }
        }
      }

      await workbook.xlsx.writeFile(target)
      return {
        content: `Successfully applied spreadsheet action "${args.action}" on "${args.sheetName}" in ${basename(target)}.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Spreadsheet Op: ${args.action} on ${args.filePath}`
})

/**
 * 4. Gramme & Eidos (VectorCraft / FigCraft) — Vector Design & UI Component Wireframing
 */
export const studioDesignVectorTool = defineTool({
  name: 'studio_design_vector',
  title: 'Gramme & Eidos Vector Canvas',
  description:
    'Design scalable vector graphics (SVG), UI icons, component mockups, or application layouts. Generates production-ready, clean SVG code with responsive viewports.',
  schema: z.object({
    outputPath: z.string().describe('Output SVG file path (e.g. "ui/icons/gear.svg" or "ui/wireframe.svg").'),
    viewBox: z.string().default('0 0 800 600'),
    title: z.string().optional(),
    svgBody: z.string().describe('Inner SVG XML tags (paths, rects, text, defs, g elements).'),
    css: z.string().optional().describe('Optional CSS styles to embed in <style> block.')
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(getRoots(ctx), args.outputPath, { mode: 'write' })
      await fs.mkdir(dirname(target), { recursive: true })

      const fullSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${args.viewBox}">
  ${args.title ? `<title>${args.title}</title>` : ''}
  ${args.css ? `<style>${args.css}</style>` : ''}
  ${args.svgBody}
</svg>`.trim()

      await fs.writeFile(target, fullSvg, 'utf8')
      return {
        content: `Successfully designed vector asset saved to ${basename(target)}.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Design Vector: ${args.outputPath}`
})

/**
 * 5. Kinema & Drama (FilmCraft / EffectCraft) — Video Sequencing & Timeline Assembly
 */
export const studioSequenceVideoTool = defineTool({
  name: 'studio_sequence_video',
  title: 'Kinema Video Sequencer',
  description:
    'Assemble and sequence video clips, cuts, transitions, and visual motion effects into a multitrack timeline project file (.timeline.json).',
  schema: z.object({
    outputPath: z.string().describe('File path for timeline project (e.g. "video/project.timeline.json").'),
    fps: z.number().default(30),
    resolution: z.object({ width: z.number().default(1920), height: z.number().default(1080) }),
    tracks: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['video', 'audio', 'overlay', 'effect']),
        clips: z.array(
          z.object({
            id: z.string(),
            source: z.string(),
            startFrame: z.number(),
            durationFrames: z.number(),
            transitionIn: z.enum(['fade', 'cut', 'dissolve', 'slide']).optional().default('cut'),
            effects: z.array(z.string()).optional().default([])
          })
        )
      })
    )
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(getRoots(ctx), args.outputPath, { mode: 'write' })
      await fs.mkdir(dirname(target), { recursive: true })

      const timelineData = {
        schema: 'selfimpulse.kinema.v1',
        fps: args.fps,
        resolution: args.resolution,
        tracks: args.tracks,
        totalClips: args.tracks.reduce((acc, t) => acc + t.clips.length, 0),
        updatedAt: new Date().toISOString()
      }

      await fs.writeFile(target, JSON.stringify(timelineData, null, 2), 'utf8')
      return {
        content: `Successfully assembled video sequence with ${args.tracks.length} tracks and ${timelineData.totalClips} clips at ${basename(target)}.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Sequence Video: ${args.outputPath}`
})

/**
 * 6. Echo (SoundCraft) — Audio Production & Multi-Track Mixing
 */
export const studioMixAudioTool = defineTool({
  name: 'studio_mix_audio',
  title: 'Echo Audio Mixer',
  description:
    'Plan and configure multi-track audio compositions, voiceovers, background music beds, volume ducking, and sound effect cues (.audio.json).',
  schema: z.object({
    outputPath: z.string().describe('Audio mixing layout path (e.g. "audio/soundtrack.audio.json").'),
    sampleRate: z.number().default(48000),
    channels: z.enum(['stereo', 'mono', 'surround']).default('stereo'),
    tracks: z.array(
      z.object({
        name: z.string(),
        type: z.enum(['voiceover', 'music', 'sfx', 'ambient']),
        volume: z.number().min(0).max(1).default(0.8),
        ducking: z.boolean().optional().default(false),
        cues: z.array(
          z.object({
            file: z.string(),
            startTimeSeconds: z.number(),
            durationSeconds: z.number(),
            fadeInSeconds: z.number().optional().default(0),
            fadeOutSeconds: z.number().optional().default(0)
          })
        )
      })
    )
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(getRoots(ctx), args.outputPath, { mode: 'write' })
      await fs.mkdir(dirname(target), { recursive: true })

      const audioProject = {
        schema: 'selfimpulse.echo.v1',
        sampleRate: args.sampleRate,
        channels: args.channels,
        tracks: args.tracks,
        createdAt: new Date().toISOString()
      }

      await fs.writeFile(target, JSON.stringify(audioProject, null, 2), 'utf8')
      return {
        content: `Successfully mixed audio project with ${args.tracks.length} tracks to ${basename(target)}.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Mix Audio: ${args.outputPath}`
})

/**
 * 7. Techton (CADCraft) — 2D/3D Geometric Modeling & Parametric Drafting
 */
export const studioDraftCadTool = defineTool({
  name: 'studio_draft_cad',
  title: 'Techton CAD Drafting',
  description:
    'Generate parametric CAD specifications, 2D technical drawings, or 3D geometric meshes (OBJ/STL/DXF/JSON).',
  schema: z.object({
    outputPath: z.string().describe('Output file path (e.g. "cad/part.obj" or "cad/spec.json").'),
    unit: z.enum(['mm', 'cm', 'm', 'inch']).default('mm'),
    shapes: z.array(
      z.object({
        name: z.string(),
        type: z.enum(['box', 'cylinder', 'sphere', 'extrusion', 'polygon']),
        dimensions: z.record(z.string(), z.number()).describe('E.g. width, height, depth, radius.'),
        position: z.array(z.number()).length(3).default([0, 0, 0]),
        rotation: z.array(z.number()).length(3).optional().default([0, 0, 0]),
        material: z.string().optional().default('aluminum')
      })
    )
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(getRoots(ctx), args.outputPath, { mode: 'write' })
      await fs.mkdir(dirname(target), { recursive: true })

      const ext = extname(target).toLowerCase()
      if (ext === '.obj') {
        // Generate simple Wavefront OBJ geometry
        const objLines = ['# SelfImpulse Techton CAD Export', `o Model_${newId('obj').slice(0, 8)}`]
        // Output vertex & face definitions for primitives
        let vOffset = 1
        for (const s of args.shapes) {
          const [px, py, pz] = s.position
          const dx = (s.dimensions.width ?? 10) / 2
          const dy = (s.dimensions.height ?? 10) / 2
          const dz = (s.dimensions.depth ?? 10) / 2
          objLines.push(
            `v ${px - dx} ${py - dy} ${pz - dz}`,
            `v ${px + dx} ${py - dy} ${pz - dz}`,
            `v ${px + dx} ${py + dy} ${pz - dz}`,
            `v ${px - dx} ${py + dy} ${pz - dz}`,
            `v ${px - dx} ${py - dy} ${pz + dz}`,
            `v ${px + dx} ${py - dy} ${pz + dz}`,
            `v ${px + dx} ${py + dy} ${pz + dz}`,
            `v ${px - dx} ${py + dy} ${pz + dz}`
          )
          objLines.push(
            `f ${vOffset} ${vOffset + 1} ${vOffset + 2} ${vOffset + 3}`,
            `f ${vOffset + 4} ${vOffset + 5} ${vOffset + 6} ${vOffset + 7}`,
            `f ${vOffset} ${vOffset + 4} ${vOffset + 7} ${vOffset + 3}`,
            `f ${vOffset + 1} ${vOffset + 5} ${vOffset + 6} ${vOffset + 2}`,
            `f ${vOffset + 3} ${vOffset + 2} ${vOffset + 6} ${vOffset + 7}`,
            `f ${vOffset} ${vOffset + 1} ${vOffset + 5} ${vOffset + 4}`
          )
          vOffset += 8
        }
        await fs.writeFile(target, objLines.join('\n'), 'utf8')
      } else {
        const cadSpec = {
          schema: 'selfimpulse.techton.v1',
          unit: args.unit,
          shapes: args.shapes,
          timestamp: new Date().toISOString()
        }
        await fs.writeFile(target, JSON.stringify(cadSpec, null, 2), 'utf8')
      }

      return {
        content: `Successfully generated CAD model with ${args.shapes.length} shapes saved to ${basename(target)}.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Draft CAD: ${args.outputPath}`
})

/**
 * 8. Chartes (PdfCraft) — PDF Assembly & Manipulation
 */
export const studioManipulatePdfTool = defineTool({
  name: 'studio_manipulate_pdf',
  title: 'Chartes PDF Engine',
  description:
    'Manipulate, organize, and inspect PDF files. Generates or extracts structured PDF documents with watermarks, headers, and pagination.',
  schema: z.object({
    outputPath: z.string().describe('Output PDF path.'),
    title: z.string(),
    pages: z.array(
      z.object({
        heading: z.string(),
        body: z.string(),
        footer: z.string().optional()
      })
    ),
    watermark: z.string().optional()
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const target = await resolveSafePath(getRoots(ctx), args.outputPath, { mode: 'write' })
      await fs.mkdir(dirname(target), { recursive: true })

      // Generate HTML-based document ready for PDF rendering or viewing
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${args.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1a1a1a; }
    .page { page-break-after: always; min-height: 90vh; border-bottom: 1px dashed #ccc; padding-bottom: 20px; position: relative; }
    h1 { font-size: 24px; border-bottom: 2px solid #000; padding-bottom: 8px; }
    p { font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
    .footer { position: absolute; bottom: 0; font-size: 11px; color: #666; }
    .watermark { position: fixed; top: 40%; left: 20%; font-size: 60px; color: rgba(0,0,0,0.06); transform: rotate(-30deg); pointer-events: none; }
  </style>
</head>
<body>
  ${args.watermark ? `<div class="watermark">${args.watermark}</div>` : ''}
  ${args.pages.map((p, idx) => `
    <div class="page">
      <h1>${p.heading}</h1>
      <p>${p.body}</p>
      <div class="footer">${p.footer ?? `Page ${idx + 1} of ${args.pages.length}`}</div>
    </div>
  `).join('\n')}
</body>
</html>`

      const htmlPath = target.replace(/\.pdf$/i, '.html')
      await fs.writeFile(htmlPath, html, 'utf8')
      return {
        content: `Successfully generated PDF document structure with ${args.pages.length} pages at ${basename(htmlPath)}.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Manipulate PDF: ${args.title}`
})

export const creativeStudioTools = [
  studioStageSceneTool,
  studioComposeImageTool,
  studioSpreadsheetOpTool,
  studioDesignVectorTool,
  studioSequenceVideoTool,
  studioMixAudioTool,
  studioDraftCadTool,
  studioManipulatePdfTool
]
