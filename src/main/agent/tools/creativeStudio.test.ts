import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  creativeStudioTools,
  studioStageSceneTool,
  studioComposeImageTool,
  studioSpreadsheetOpTool,
  studioDesignVectorTool,
  studioSequenceVideoTool,
  studioMixAudioTool,
  studioDraftCadTool,
  studioManipulatePdfTool
} from './creativeStudio'
import type { ToolContext } from './types'

describe('creativeStudioTools', () => {
  let tempDir: string
  let toolContext: ToolContext

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'creative-studio-test-'))
    toolContext = {
      workspace: tempDir,
      roots: [tempDir],
      task: {} as any,
      allowShell: true,
      addArtifact: async () => null,
      setBrowser: () => {},
      setPlan: () => {},
      toast: () => {}
    }
  })

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('exports all 8 dedicated built-in creative studio tools', () => {
    expect(creativeStudioTools).toHaveLength(8)
    const names = creativeStudioTools.map((t) => t.name)
    expect(names).toEqual([
      'studio_stage_scene',
      'studio_compose_image',
      'studio_spreadsheet_op',
      'studio_design_vector',
      'studio_sequence_video',
      'studio_mix_audio',
      'studio_draft_cad',
      'studio_manipulate_pdf'
    ])
  })

  it('studio_stage_scene stages a 3D scene and writes spec', async () => {
    const result = await studioStageSceneTool.execute(
      {
        outputPath: 'scenes/cyberpunk_shot1.scene.json',
        title: 'Cyberpunk Alleyway Shot 1',
        camera: {
          fov: 45,
          angle: 'low-angle',
          distance: 'medium',
          position: [0, 1.2, 2.5],
          target: [0, 1.5, 0]
        },
        actors: [
          {
            name: 'Hero',
            pose: 'standing in shadows',
            position: [0, 0, 0],
            facingAngle: 45
          }
        ],
        environment: {
          location: 'Cyberpunk alley in rain',
          lighting: 'Neon pink and cyan backlight',
          mood: 'noir tension'
        },
        depthLayers: [
          { layer: 'foreground', elements: ['neon wire dripping water'] },
          { layer: 'midground', elements: ['Hero standing'] },
          { layer: 'background', elements: ['Skyscraper silhouettes'] }
        ]
      },
      toolContext
    )

    expect(result.content).toContain('Successfully staged scene')
    const fullPath = join(tempDir, 'scenes', 'cyberpunk_shot1.scene.json')
    expect(existsSync(fullPath)).toBe(true)
    const data = JSON.parse(readFileSync(fullPath, 'utf8'))
    expect(data.title).toBe('Cyberpunk Alleyway Shot 1')
    expect(data.camera.angle).toBe('low-angle')
  })

  it('studio_compose_image composes an SVG / image layout', async () => {
    const result = await studioComposeImageTool.execute(
      {
        outputPath: 'images/poster.svg',
        width: 800,
        height: 600,
        background: '#111827',
        layers: [
          {
            id: 'l1',
            type: 'text',
            x: 100,
            y: 100,
            text: 'SelfImpulse Studio',
            fill: '#38bdf8',
            opacity: 1
          }
        ]
      },
      toolContext
    )

    expect(result.content).toContain('Successfully composed image')
    const fullPath = join(tempDir, 'images', 'poster.svg')
    expect(existsSync(fullPath)).toBe(true)
    const content = readFileSync(fullPath, 'utf8')
    expect(content).toContain('SelfImpulse Studio')
    expect(content).toContain('<svg')
  })

  it('studio_spreadsheet_op creates an Excel workbook using ExcelJS', async () => {
    const result = await studioSpreadsheetOpTool.execute(
      {
        filePath: 'data/finance.xlsx',
        sheetName: 'Q1 Budget',
        action: 'add_rows',
        rows: [
          ['Category', 'Allocated', 'Spent'],
          ['R&D', 50000, 32000],
          ['Marketing', 20000, 15000]
        ]
      },
      toolContext
    )

    expect(result.content).toContain('Successfully applied spreadsheet action')
    const fullPath = join(tempDir, 'data', 'finance.xlsx')
    expect(existsSync(fullPath)).toBe(true)
  })

  it('studio_design_vector generates vector graphic SVG', async () => {
    const result = await studioDesignVectorTool.execute(
      {
        outputPath: 'design/diagram.svg',
        viewBox: '0 0 500 500',
        title: 'Core Engine Diagram',
        svgBody: `
          <rect x="50" y="50" width="200" height="100" fill="#4f46e5" stroke="#818cf8" stroke-width="2" />
          <text x="150" y="105" fill="#ffffff">Core Engine</text>
        `
      },
      toolContext
    )

    expect(result.content).toContain('Successfully designed vector asset')
    const fullPath = join(tempDir, 'design', 'diagram.svg')
    expect(existsSync(fullPath)).toBe(true)
    const content = readFileSync(fullPath, 'utf8')
    expect(content).toContain('Core Engine')
    expect(content).toContain('rect')
  })

  it('studio_sequence_video generates multitrack video sequence timeline', async () => {
    const result = await studioSequenceVideoTool.execute(
      {
        outputPath: 'video/sequence.timeline.json',
        fps: 30,
        resolution: { width: 1920, height: 1080 },
        tracks: [
          {
            id: 'v1',
            name: 'Video Track 1',
            type: 'video',
            clips: [
              { id: 'c1', source: 'assets/intro.mp4', startFrame: 0, durationFrames: 150 },
              { id: 'c2', source: 'assets/demo.mp4', startFrame: 150, durationFrames: 450 }
            ]
          }
        ]
      },
      toolContext
    )

    expect(result.content).toContain('Successfully assembled video sequence')
    const fullPath = join(tempDir, 'video', 'sequence.timeline.json')
    expect(existsSync(fullPath)).toBe(true)
    const data = JSON.parse(readFileSync(fullPath, 'utf8'))
    expect(data.schema).toBe('selfimpulse.kinema.v1')
    expect(data.totalClips).toBe(2)
  })

  it('studio_mix_audio generates multitrack audio layout', async () => {
    const result = await studioMixAudioTool.execute(
      {
        outputPath: 'audio/master_mix.audio.json',
        sampleRate: 48000,
        channels: 2,
        tracks: [
          {
            id: 'a1',
            name: 'Voiceover',
            volume: 1.0,
            pan: 0,
            cues: [{ file: 'audio/vo1.wav', startTimeSeconds: 0, durationSeconds: 15 }]
          },
          {
            id: 'a2',
            name: 'Music Bed',
            volume: 0.35,
            pan: 0,
            cues: [{ file: 'audio/music.mp3', startTimeSeconds: 0, durationSeconds: 30 }]
          }
        ]
      },
      toolContext
    )

    expect(result.content).toContain('Successfully mixed audio project')
    const fullPath = join(tempDir, 'audio', 'master_mix.audio.json')
    expect(existsSync(fullPath)).toBe(true)
    const data = JSON.parse(readFileSync(fullPath, 'utf8'))
    expect(data.schema).toBe('selfimpulse.echo.v1')
  })

  it('studio_draft_cad generates CAD drafting geometry spec (OBJ/JSON)', async () => {
    const result = await studioDraftCadTool.execute(
      {
        outputPath: 'models/bracket.obj',
        format: 'obj',
        unit: 'mm',
        shapes: [
          {
            type: 'box',
            name: 'Mounting Bracket',
            position: [0, 0, 0],
            dimensions: { width: 100, height: 20, depth: 50 }
          }
        ]
      },
      toolContext
    )

    expect(result.content).toContain('Successfully generated CAD model')
    const fullPath = join(tempDir, 'models', 'bracket.obj')
    expect(existsSync(fullPath)).toBe(true)
    const content = readFileSync(fullPath, 'utf8')
    expect(content).toContain('v -50 -10 -25')
  })

  it('studio_manipulate_pdf creates structured print-ready document', async () => {
    const result = await studioManipulatePdfTool.execute(
      {
        outputPath: 'docs/report.pdf',
        title: 'Quarterly Summary',
        watermark: 'CONFIDENTIAL',
        pages: [
          {
            heading: 'Executive Summary',
            body: 'All metrics exceed targets.'
          }
        ]
      },
      toolContext
    )

    expect(result.content).toContain('Successfully generated PDF document structure')
    const fullPath = join(tempDir, 'docs', 'report.html')
    expect(existsSync(fullPath)).toBe(true)
    const content = readFileSync(fullPath, 'utf8')
    expect(content).toContain('Executive Summary')
    expect(content).toContain('CONFIDENTIAL')
  })
})
